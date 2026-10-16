use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
// use std::collections::HashMap; // removed

const OIDC_BASE_URL: &str = "https://oidc.us-east-1.amazonaws.com";
const START_URL: &str = "https://view.awsapps.com/start";
const REGION: &str = "us-east-1";

// User Agent matching Kiro's implementation
const CLI_USER_AGENT: &str =
    "aws-cli/2.15.0 Python/3.11.6 Windows/10 exe/AMD64 prompt/off command/codecatalyst.login";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KiroTokenData {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub region: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
struct ClientRegistrationResponse {
    clientId: String,
    clientSecret: String,
    clientIdIssuedAt: i64,
    clientSecretExpiresAt: i64,
}

// ... imports
use std::sync::Mutex;
use tokio::sync::mpsc::Sender;

// ... existing structs

pub struct DeepLinkState {
    pub sender: Mutex<Option<Sender<String>>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct DeviceAuthResponse {
    pub deviceCode: String,
    pub userCode: String,
    pub verificationUri: String,
    pub verificationUriComplete: Option<String>,
    pub expiresIn: i64,
    pub interval: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
struct TokenResponse {
    #[serde(alias = "access_token")]
    accessToken: String,
    #[serde(alias = "refresh_token")]
    refreshToken: Option<String>,
    #[serde(alias = "expires_in")]
    expiresIn: i64,
    #[serde(alias = "token_type")]
    tokenType: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ErrorResponse {
    error: String,
    error_description: Option<String>,
}

// 获取全局 HTTP 客户端（使用通用工具）
fn get_client() -> &'static Client {
    crate::utils::http::get_client()
}

pub async fn register_client() -> Result<(String, String), String> {
    let client = get_client();
    let url = format!("{}/client/register", OIDC_BASE_URL);

    let payload = serde_json::json!({
        "clientName": "LutraCredentials",
        "clientType": "public",
        "scopes": [
            "codewhisperer:analysis",
            "codewhisperer:completions",
            "codewhisperer:conversations",
            "codewhisperer:taskassist",
            "codewhisperer:transformations"
        ],
        "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
        "issuerUrl": START_URL
    });

    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Register failed: {}", res.status()));
    }

    let data: ClientRegistrationResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok((data.clientId, data.clientSecret))
}

pub async fn start_device_authorization(
    client_id: &str,
    client_secret: &str,
) -> Result<DeviceAuthResponse, String> {
    let client = get_client();
    let url = format!("{}/device_authorization", OIDC_BASE_URL);

    let payload = serde_json::json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "startUrl": START_URL
    });

    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Device auth failed: {}", res.status()));
    }

    let data: DeviceAuthResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

pub async fn poll_token(
    client_id: &str,
    client_secret: &str,
    device_code: &str,
    _interval_secs: u64,
) -> Result<KiroTokenData, String> {
    let client = get_client();
    let url = format!("{}/token", OIDC_BASE_URL);

    // Poll loop needs to be handled by caller or we loop once here?
    // Since this is an async function called from command, we can loop here with sleep.
    // But we need timeout.

    // In actual implementation (command wrapper), we might want to call this ONCE per interval.
    // But for simplicity, let's just make a single request function check_token_status.

    let payload = serde_json::json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "grantType": "urn:ietf:params:oauth:grant-type:device_code",
        "deviceCode": device_code
    });

    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let data: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
        return Ok(KiroTokenData {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            client_id: Some(client_id.to_string()),
            client_secret: Some(client_secret.to_string()),
            region: REGION.to_string(),
        });
    }

    // Handle errors (pending, slow_down)
    let status = res.status();
    let err_text = res.text().await.unwrap_or_default();
    // Try parse json error
    if let Ok(json_err) = serde_json::from_str::<ErrorResponse>(&err_text) {
        if json_err.error == "authorization_pending" {
            return Err("pending".to_string());
        }
        if json_err.error == "slow_down" {
            return Err("slow_down".to_string());
        }
        return Err(format!("Auth error: {}", json_err.error));
    }

    Err(format!("HTTP Error {}: {}", status, err_text))
}

pub async fn refresh_token(
    refresh_token: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<KiroTokenData, String> {
    use crate::utils::logger::{log_error, log_info};

    let client = get_client();
    let url = format!("{}/token", OIDC_BASE_URL);

    let payload = serde_json::json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "grantType": "refresh_token",
        "refreshToken": refresh_token
    });

    log_info("Refreshing Kiro token...");

    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    if !status.is_success() {
        let error_text = res.text().await.unwrap_or_default();
        log_error(&format!("Refresh failed: {} - {}", status, error_text));
        return Err(format!("Refresh failed: {} - {}", status, error_text));
    }

    // 先获取原始文本，用于调试
    let response_text = res.text().await.map_err(|e| e.to_string())?;
    log_info(&format!(
        "Token response (first 200 chars): {}",
        &response_text[..200.min(response_text.len())]
    ));

    // 尝试解析 JSON
    let data: TokenResponse = serde_json::from_str(&response_text).map_err(|e| {
        log_error(&format!("Failed to parse token response: {}", e));
        log_error(&format!("Response body: {}", response_text));
        format!("解析响应失败: {}. 请检查 Token 格式是否正确", e)
    })?;

    log_info("Token refreshed successfully");

    Ok(KiroTokenData {
        access_token: data.accessToken,
        refresh_token: data.refreshToken.or(Some(refresh_token.to_string())),
        expires_in: data.expiresIn,
        client_id: Some(client_id.to_string()),
        client_secret: Some(client_secret.to_string()),
        region: REGION.to_string(),
    })
}

// === Quota / Usage Logic ===

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroQuotaData {
    pub subscription_type: Option<String>,
    pub subscription_title: Option<String>,
    pub total_limit: f64,
    pub current_usage: f64,
    pub percent_used: f64,
    pub days_remaining: Option<i64>,
    pub email: Option<String>,
    pub user_id: Option<String>,
}

pub async fn get_usage_limits(access_token: &str) -> Result<KiroQuotaData, String> {
    use crate::utils::logger::{log_info, log_warn};

    // 新版 Kiro 桌面客户端使用 q.<region>.amazonaws.com；旧端点作为回退
    let candidate_urls = [
        "https://q.us-east-1.amazonaws.com/getUsageLimits",
        "https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits",
        "https://us-east-1.codewhisperer.aws.amazon.com/getUsageLimits",
    ];

    let client = get_client();

    let params = [
        ("origin", "AI_EDITOR"),
        ("resourceType", "AGENTIC_REQUEST"),
        ("isEmailRequired", "true"),
    ];

    // 依次尝试候选端点，返回第一个成功的响应
    let mut res = None;
    for url in candidate_urls {
        log_info(&format!("[Kiro] Fetching usage limits from: {}", url));
        let result = client
            .get(url)
            .query(&params)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "application/json")
            .header("User-Agent", CLI_USER_AGENT)
            .header("x-amz-user-agent", CLI_USER_AGENT)
            .send()
            .await;

        match result {
            Ok(response) if response.status().is_success() => {
                res = Some(response);
                break;
            }
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                log_warn(&format!("[Kiro] Endpoint {} failed: {} - {}", url, status, text));
            }
            Err(e) => {
                log_warn(&format!("[Kiro] Endpoint {} request error: {}", url, e));
            }
        }
    }

    let res = res.ok_or_else(|| "Usage API failed: all endpoints unavailable".to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    log_info(&format!(
        "[Kiro] Usage API response: {}",
        serde_json::to_string_pretty(&json).unwrap_or_default()
    ));

    // Parse the complex response structure manually to extract key metrics
    // Refer to Kiro's parsing logic (lines 2045-2067 in index.ts)

    // Default values
    let mut total_limit = 0.0;
    let mut current_usage = 0.0;

    if let Some(breakdown_list) = json.get("usageBreakdownList").and_then(|v| v.as_array()) {
        for item in breakdown_list {
            let resource_type = item
                .get("resourceType")
                .or(item.get("type"))
                .and_then(|v| v.as_str());
            if resource_type == Some("CREDIT") {
                // Base
                total_limit += item
                    .get("usageLimitWithPrecision")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                current_usage += item
                    .get("currentUsageWithPrecision")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);

                // Free Trial
                if let Some(ft) = item.get("freeTrialInfo") {
                    if ft.get("freeTrialStatus").and_then(|v| v.as_str()) == Some("ACTIVE") {
                        total_limit += ft
                            .get("usageLimitWithPrecision")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        current_usage += ft
                            .get("currentUsageWithPrecision")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                    }
                }

                // Bonuses
                if let Some(bonuses) = item.get("bonuses").and_then(|v| v.as_array()) {
                    for b in bonuses {
                        if b.get("status").and_then(|v| v.as_str()) == Some("ACTIVE") {
                            total_limit += b
                                .get("usageLimitWithPrecision")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            current_usage += b
                                .get("currentUsageWithPrecision")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                        }
                    }
                }
            }
        }
    }

    let sub_title = json
        .pointer("/subscriptionInfo/subscriptionTitle")
        .and_then(|v| v.as_str())
        .unwrap_or("Free")
        .to_string();

    let sub_type = if sub_title.to_uppercase().contains("PRO") {
        "Pro".to_string()
    } else {
        "Free".to_string()
    };

    let mut days_remaining = None;
    if let Some(reset_date_str) = json.get("nextDateReset").and_then(|v| v.as_str()) {
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(reset_date_str) {
            let now = chrono::Utc::now();
            let duration = date.with_timezone(&chrono::Utc) - now;
            days_remaining = Some(duration.num_days());
        }
    } else if let Some(reset_ts) = json.get("nextDateReset").and_then(|v| v.as_i64()) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let diff = reset_ts - now;
        days_remaining = Some(diff / 86400);
    }

    // Parse User Info
    let email = json
        .pointer("/userInfo/email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let user_id = json
        .pointer("/userInfo/userId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    log_info(&format!(
        "[Kiro] Parsed usage data - Email: {:?}, Limit: {}, Current: {}",
        email, total_limit, current_usage
    ));

    Ok(KiroQuotaData {
        subscription_type: Some(sub_type),
        subscription_title: Some(sub_title),
        total_limit,
        current_usage,
        percent_used: if total_limit > 0.0 {
            current_usage / total_limit
        } else {
            0.0
        },
        days_remaining,
        email,
        user_id,
    })
}
