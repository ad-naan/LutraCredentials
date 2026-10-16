//! Codex (ChatGPT) 官方 OAuth
//!
//! 采用 Device Code + 服务端 PKCE 流程（与官方 Codex CLI 一致）：
//! 1. `start_device_auth` 获取 device_auth_id + user_code，用户在
//!    https://auth.openai.com/codex/device 完成授权
//! 2. `poll_device_token` 轮询（403/404 = 待授权），成功后服务端返回
//!    authorization_code + code_verifier
//! 3. `exchange_code` 换取 id_token / access_token / refresh_token
//! 4. 切换时写 `~/.codex/auth.json` 托管格式 `{auth_mode:"chatgpt", tokens, last_refresh}`

use crate::utils::logger::{log_info, log_warn};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
pub const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_EXCHANGE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const ACCOUNT_CHECK_URL: &str = "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";

const DEFAULT_POLL_INTERVAL_SECS: u64 = 5;

/// 设备授权启动信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthSession {
    pub device_auth_id: String,
    pub user_code: String,
    pub verification_url: String,
    pub interval: u64,
}

/// 单次轮询结果
///
/// `status` 为变体名（snake_case）；`Authorized` 的字段按前端 `PollResult` 约定序列化为 camelCase。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DevicePollStatus {
    /// 用户尚未完成授权，继续轮询
    Pending,
    /// 授权完成，携带交换所需的 code + verifier
    #[serde(rename_all = "camelCase")]
    Authorized {
        authorization_code: String,
        code_verifier: String,
    },
}

/// OAuth Token 集合
///
/// 序列化为 snake_case，与前端 `CodexOAuthData` 及落盘数据保持一致。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OAuthTokens {
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    /// id_token 中解析出的账号信息
    pub email: Option<String>,
    pub account_id: Option<String>,
}

/// 订阅/账号检查结果
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountCheck {
    pub plan: Option<String>,
    pub email: Option<String>,
    pub account_id: Option<String>,
}

fn get_client() -> &'static reqwest::Client {
    crate::utils::http::get_client()
}

/// 启动设备授权
pub async fn start_device_auth() -> Result<DeviceAuthSession, String> {
    let client = get_client();

    let response = client
        .post(DEVICE_USER_CODE_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .map_err(|e| format!("Device auth request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read device auth response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Device auth request failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse device auth response: {}", e))?;

    let device_auth_id = payload
        .get("device_auth_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let user_code = payload
        .get("user_code")
        .or_else(|| payload.get("usercode"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    if device_auth_id.is_empty() || user_code.is_empty() {
        return Err("Device auth response missing device_auth_id or user_code".to_string());
    }

    let interval = payload
        .get("interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_POLL_INTERVAL_SECS)
        .max(1);

    Ok(DeviceAuthSession {
        device_auth_id,
        user_code,
        verification_url: DEVICE_VERIFICATION_URL.to_string(),
        interval,
    })
}

/// 轮询设备授权状态（每次调用只发起一次请求，由前端按 interval 调用）
pub async fn poll_device_token(device_auth_id: &str, user_code: &str) -> Result<DevicePollStatus, String> {
    let client = get_client();

    let response = client
        .post(DEVICE_TOKEN_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "device_auth_id": device_auth_id,
            "user_code": user_code,
        }))
        .send()
        .await
        .map_err(|e| format!("Device token poll failed: {}", e))?;

    let status = response.status();

    // 403/404 = 等待用户授权；410 = 过期
    if status.as_u16() == 403 || status.as_u16() == 404 {
        return Ok(DevicePollStatus::Pending);
    }
    if status.as_u16() == 410 {
        return Err("Device authorization expired, please restart login".to_string());
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Device token poll failed: HTTP {} - {}", status, body));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read device token response: {}", e))?;
    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse device token response: {}", e))?;

    let code = payload
        .get("authorization_code")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let verifier = payload
        .get("code_verifier")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    if code.is_empty() || verifier.is_empty() {
        return Err("Device token response missing authorization_code or code_verifier".to_string());
    }

    Ok(DevicePollStatus::Authorized {
        authorization_code: code,
        code_verifier: verifier,
    })
}

/// 解析 JWT payload（不校验签名，仅本地读取声明）
fn decode_jwt_payload(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload_b64 = parts.next()?;
    let payload_bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    serde_json::from_slice(&payload_bytes).ok()
}

fn extract_identity(id_token: &str) -> (Option<String>, Option<String>) {
    let Some(payload) = decode_jwt_payload(id_token) else {
        return (None, None);
    };

    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let account_id = payload
        .get("https://api.openai.com/auth")
        .and_then(|auth| {
            auth.get("chatgpt_account_id")
                .or_else(|| auth.get("account_id"))
                .or_else(|| auth.get("user_id"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string);

    (email, account_id)
}

/// 用授权码换取 token，并解析出账号身份
pub async fn exchange_code(authorization_code: &str, code_verifier: &str) -> Result<OAuthTokens, String> {
    let client = get_client();

    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", authorization_code),
            ("redirect_uri", DEVICE_EXCHANGE_REDIRECT_URI),
            ("client_id", CLIENT_ID),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read token response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Token exchange failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse token response: {}", e))?;

    let id_token = payload
        .get("id_token")
        .and_then(|v| v.as_str())
        .ok_or("Token response missing id_token")?
        .to_string();
    let access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Token response missing access_token")?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let (email, account_id) = extract_identity(&id_token);
    log_info("[Codex OAuth] Token exchange successful");

    Ok(OAuthTokens {
        id_token,
        access_token,
        refresh_token,
        email,
        account_id,
    })
}

/// 使用 refresh_token 刷新（响应可能轮换 refresh_token / 省略 id_token）
pub async fn refresh_tokens(
    refresh_token: &str,
    current_id_token: Option<&str>,
) -> Result<OAuthTokens, String> {
    let client = get_client();

    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/json")
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read refresh response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Token refresh failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Refresh response missing access_token")?
        .to_string();

    // 刷新响应可能省略 id_token：保留旧值
    let id_token = payload
        .get("id_token")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| current_id_token.map(str::to_string))
        .ok_or("Refresh response missing id_token")?;

    let new_refresh_token = payload
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| refresh_token.to_string());

    let (email, account_id) = extract_identity(&id_token);
    log_info("[Codex OAuth] Token refreshed");

    Ok(OAuthTokens {
        id_token,
        access_token,
        refresh_token: new_refresh_token,
        email,
        account_id,
    })
}

/// 查询账号订阅状态（accounts/check）
pub async fn check_account(access_token: &str, account_id: Option<&str>) -> Result<AccountCheck, String> {
    let client = get_client();

    let mut request = client
        .get(ACCOUNT_CHECK_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json");

    if let Some(account_id) = account_id.filter(|id| !id.trim().is_empty()) {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Account check request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read account check response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Account check failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse account check response: {}", e))?;

    // 响应结构：{ "accounts": { "<account_id>": { "account": { "plan_type": ... }, "email": ... } } }
    let mut result = AccountCheck::default();

    if let Some(accounts) = payload.get("accounts").and_then(|v| v.as_object()) {
        for (_id, info) in accounts {
            if result.plan.is_some() {
                break;
            }
            result.plan = info
                .pointer("/account/plan_type")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if result.email.is_none() {
                result.email = info
                    .get("email")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            if result.account_id.is_none() {
                result.account_id = info
                    .pointer("/account/account_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
        }
    }

    if result.plan.is_none() {
        log_warn("[Codex OAuth] Account check response has no recognizable plan");
    }

    Ok(result)
}

/// 构造 `~/.codex/auth.json` 托管格式内容
pub fn build_managed_auth_json(tokens: &OAuthTokens) -> Value {
    let now = chrono::Utc::now();
    json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": tokens.id_token,
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "account_id": tokens.account_id,
        },
        "last_refresh": now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
    })
}
