//! Claude 官方 OAuth（Claude Code 订阅账号）
//!
//! 授权流程采用手动复制授权码方式（与 Claude Code CLI 一致）：
//! 1. `build_authorize_url` 生成授权链接（PKCE S256）
//! 2. 用户在浏览器完成授权后，将页面展示的授权码粘贴回应用
//! 3. `exchange_code` 换取 access_token / refresh_token
//! 4. 凭据写入 `~/.claude/.credentials.json`，由 Claude Code 直接读取

use crate::utils::logger::log_warn;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL: &str = "https://claude.com/cai/oauth/authorize";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const MANUAL_REDIRECT_URL: &str = "https://platform.claude.com/oauth/code/callback";
const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER: &str = "oauth-2025-04-20";

const SCOPES: [&str; 6] = [
    "org:create_api_key",
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
];

const USER_AGENT: &str = "lutra-credentials";

/// OAuth 登录会话凭据（state + code_verifier 由前端在登录期间持有）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSession {
    pub state: String,
    pub code_verifier: String,
    pub url: String,
}

/// OAuth Token 响应
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub scopes: Vec<String>,
}

/// 账号资料
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthProfile {
    pub email: Option<String>,
    pub name: Option<String>,
    pub account_uuid: Option<String>,
}

/// 订阅用量（api.anthropic.com/api/oauth/usage 解析结果）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OAuthUsage {
    pub five_hour_percentage: Option<i32>,
    pub five_hour_reset_time: Option<String>,
    pub seven_day_percentage: Option<i32>,
    pub seven_day_reset_time: Option<String>,
}

fn random_url_token(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// 生成授权 URL 与配套的 PKCE 会话信息
pub fn build_authorize_url() -> OAuthSession {
    let state = random_url_token(32);
    let code_verifier = random_url_token(32);
    let code_challenge = pkce_challenge(&code_verifier);

    let mut url = url::Url::parse(AUTHORIZE_URL).expect("Invalid authorize URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("client_id", CLIENT_ID);
        pairs.append_pair("response_type", "code");
        pairs.append_pair("redirect_uri", MANUAL_REDIRECT_URL);
        pairs.append_pair("scope", &SCOPES.join(" "));
        pairs.append_pair("state", &state);
        pairs.append_pair("code_challenge", &code_challenge);
        pairs.append_pair("code_challenge_method", "S256");
    }

    OAuthSession {
        state,
        code_verifier,
        url: url.to_string(),
    }
}

/// 将 token 响应规整为 OAuthTokens（expires_at 换算为毫秒时间戳）
fn parse_tokens(payload: &Value) -> Result<OAuthTokens, String> {
    let access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Token response missing access_token")?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or("Token response missing refresh_token")?
        .to_string();
    let expires_in = payload.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    let scopes = payload
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().map(str::to_string).collect())
        .unwrap_or_else(|| SCOPES.iter().map(|s| s.to_string()).collect());

    Ok(OAuthTokens {
        access_token,
        refresh_token,
        expires_at: chrono::Utc::now().timestamp_millis() + expires_in * 1000,
        scopes,
    })
}

/// 用授权码换取 token
pub async fn exchange_code(code: &str, state: &str, code_verifier: &str) -> Result<OAuthTokens, String> {
    let client = crate::utils::http::get_client();

    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&json!({
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "redirect_uri": MANUAL_REDIRECT_URL,
            "code_verifier": code_verifier,
            "state": state,
        }))
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
    parse_tokens(&payload)
}

/// 使用 refresh_token 刷新凭据
pub async fn refresh_tokens(refresh_token: &str) -> Result<OAuthTokens, String> {
    let client = crate::utils::http::get_client();

    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
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
    parse_tokens(&payload)
}

/// 获取账号资料（邮箱、显示名）
pub async fn fetch_profile(access_token: &str) -> Result<OAuthProfile, String> {
    let client = crate::utils::http::get_client();

    let response = client
        .get(PROFILE_URL)
        .bearer_auth(access_token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Profile request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read profile response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Profile request failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse profile response: {}", e))?;

    Ok(OAuthProfile {
        email: payload
            .get("email")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        name: payload
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        account_uuid: payload
            .get("account_uuid")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

/// 查询订阅用量（5 小时窗口 / 7 天窗口）
pub async fn fetch_usage(access_token: &str) -> Result<OAuthUsage, String> {
    let client = crate::utils::http::get_client();

    let response = client
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", BETA_HEADER)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Usage request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read usage response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Usage request failed: HTTP {} - {}", status, body));
    }

    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse usage response: {}", e))?;

    let percentage = |window: &str| -> Option<i32> {
        payload
            .get(window)
            .and_then(|w| w.get("utilization"))
            .and_then(|v| v.as_f64())
            .map(|f| (f.clamp(0.0, 1.0) * 100.0) as i32)
    };
    let reset_time = |window: &str| -> Option<String> {
        payload
            .get(window)
            .and_then(|w| w.get("resets_at"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };

    if payload.get("five_hour").is_none() && payload.get("seven_day").is_none() {
        log_warn("[Claude] Usage response contains no known windows");
    }

    Ok(OAuthUsage {
        five_hour_percentage: percentage("five_hour"),
        five_hour_reset_time: reset_time("five_hour"),
        seven_day_percentage: percentage("seven_day"),
        seven_day_reset_time: reset_time("seven_day"),
    })
}

/// 构造 `~/.claude/.credentials.json` 的内容
pub fn build_credentials_file(tokens: &OAuthTokens) -> Value {
    json!({
        "claudeAiOauth": {
            "accessToken": tokens.access_token,
            "refreshToken": tokens.refresh_token,
            "expiresAt": tokens.expires_at,
            "scopes": tokens.scopes,
        }
    })
}

/// 写入凭据后同步清理 settings.json 中的 API Key 环境变量，
/// 避免 env 配置覆盖 OAuth 凭据
pub fn sanitize_settings_env(settings: &mut Value) {
    const API_ENV_KEYS: [&str; 5] = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_CUSTOM_HEADERS",
        "ANTHROPIC_MODEL",
    ];

    if let Some(env) = settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        for key in API_ENV_KEYS {
            env.remove(key);
        }
        if env.is_empty() {
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("env");
            }
        }
    }
}
