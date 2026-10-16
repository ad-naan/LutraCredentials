use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use once_cell::sync::Lazy;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use uuid::Uuid;

use crate::utils::logger::{log_info, log_warn};

const OIDC_ISSUER: &str = "https://auth.x.ai";
const OIDC_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const OIDC_SCOPE: &str = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write";
const DEFAULT_TOKEN_ENDPOINT: &str = "https://auth.x.ai/oauth2/token";
const DISCOVERY_URL: &str = "https://auth.x.ai/.well-known/openid-configuration";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const CLI_USER_URL: &str = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";

const DEFAULT_INTERVAL_SECONDS: u64 = 5;
const MAX_LOGIN_SECONDS: i64 = 30 * 60;
const MAX_CONSECUTIVE_POLL_TRANSPORT_ERRORS: u8 = 3;
const CLIENT_VERSION_FALLBACK: &str = "1.0.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GrokOAuthStartResponse {
    pub login_id: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub user_code: String,
    pub expires_in: i64,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone)]
struct PendingGrokLogin {
    login_id: String,
    device_code: String,
    token_endpoint: String,
    userinfo_endpoint: Option<String>,
    expires_at: i64,
    interval_seconds: u64,
    cancelled: bool,
}

#[derive(Debug, Deserialize)]
struct DiscoveryResponse {
    device_authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    userinfo_endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: i64,
    #[serde(default)]
    interval: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GrokTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

static PENDING_GROK_LOGIN: Lazy<Mutex<Option<PendingGrokLogin>>> = Lazy::new(|| Mutex::new(None));

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to build Grok HTTP client: {}", error))
}

fn validate_xai_endpoint(raw: &str, field: &str) -> Result<String, String> {
    let parsed = url::Url::parse(raw.trim())
        .map_err(|error| format!("Invalid Grok {} URL: {}", field, error))?;
    if parsed.scheme() != "https" {
        return Err(format!("Grok {} must use HTTPS", field));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "x.ai" && !host.ends_with(".x.ai") {
        return Err(format!("Grok {} is not on the x.ai domain", field));
    }
    Ok(parsed.to_string())
}

fn grok_home_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".grok"))
}

fn grok_auth_path() -> Result<PathBuf, String> {
    Ok(grok_home_dir()?.join("auth.json"))
}

/// Detect the installed Grok CLI version so quota requests look like the official client.
fn detect_client_version() -> String {
    let auth_path = grok_auth_path().ok();
    let _ = auth_path;
    let mut command = std::process::Command::new("grok");
    command.arg("--version").stdin(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    if let Ok(output) = command.output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(version) = parse_client_version(&text) {
                return version;
            }
        }
    }
    CLIENT_VERSION_FALLBACK.to_string()
}

fn parse_client_version(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .map(|part| part.trim_start_matches(['v', 'V']))
        .find(|part| {
            !part.is_empty()
                && part.chars().next().is_some_and(|ch| ch.is_ascii_digit())
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '+' | '_'))
        })
        .map(str::to_string)
}

fn decode_jwt_claims(token: Option<&str>) -> Value {
    let Some(token) = token else {
        return json!({});
    };
    let Some(payload) = token.split('.').nth(1) else {
        return json!({});
    };
    URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or_else(|| json!({}))
}

fn claim_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .and_then(|text| normalize_text(Some(text)))
    })
}

fn merge_claims(primary: Value, fallback: Value) -> Value {
    let mut result = fallback.as_object().cloned().unwrap_or_default();
    if let Some(object) = primary.as_object() {
        for (key, value) in object {
            result.insert(key.clone(), value.clone());
        }
    }
    Value::Object(result)
}

async fn discover(client: &reqwest::Client) -> Result<DiscoveryResponse, String> {
    let response = client
        .get(DISCOVERY_URL)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Failed to request Grok OAuth discovery: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Grok OAuth discovery response: {}", error))?;
    if !status.is_success() {
        return Err(format!("Grok OAuth discovery returned {}", status.as_u16()));
    }
    let mut result: DiscoveryResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse Grok OAuth discovery: {}", error))?;
    result.device_authorization_endpoint = validate_xai_endpoint(
        &result.device_authorization_endpoint,
        "device_authorization_endpoint",
    )?;
    result.token_endpoint = validate_xai_endpoint(&result.token_endpoint, "token_endpoint")?;
    result.userinfo_endpoint = result
        .userinfo_endpoint
        .as_deref()
        .map(|url| validate_xai_endpoint(url, "userinfo_endpoint"))
        .transpose()?;
    Ok(result)
}

enum PollResult {
    Pending,
    SlowDown,
    TransportFailure(String),
    Complete(GrokTokenResponse),
}

async fn poll_token_once(
    client: &reqwest::Client,
    state: &PendingGrokLogin,
) -> Result<PollResult, String> {
    let response = match client
        .post(&state.token_endpoint)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .form(&[
            ("grant_type", DEVICE_GRANT_TYPE),
            ("device_code", state.device_code.as_str()),
            ("client_id", OIDC_CLIENT_ID),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Ok(PollResult::TransportFailure(format!(
                "Failed to poll Grok OAuth token: {}",
                error
            )))
        }
    };

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Grok OAuth token response: {}", error))?;
    if status.is_success() {
        let token: GrokTokenResponse = serde_json::from_str(&body)
            .map_err(|error| format!("Failed to parse Grok OAuth token response: {}", error))?;
        if token.access_token.trim().is_empty() {
            return Err("Grok OAuth returned an empty access_token".to_string());
        }
        return Ok(PollResult::Complete(token));
    }

    let error: TokenErrorResponse = serde_json::from_str(&body).unwrap_or(TokenErrorResponse {
        error: None,
        error_description: None,
    });
    match error.error.as_deref() {
        Some("authorization_pending") => Ok(PollResult::Pending),
        Some("slow_down") => Ok(PollResult::SlowDown),
        Some("access_denied") => Err("Grok OAuth authorization was denied".to_string()),
        Some("expired_token") => Err("Grok OAuth device code has expired".to_string()),
        Some(code) => Err(format!(
            "Grok OAuth failed: {}{}",
            code,
            error
                .error_description
                .as_deref()
                .map(|value| format!(" ({})", value))
                .unwrap_or_default()
        )),
        None => Err(format!("Grok OAuth token endpoint returned {}", status.as_u16())),
    }
}

fn pending_login(login_id: &str) -> Result<PendingGrokLogin, String> {
    let state = PENDING_GROK_LOGIN
        .lock()
        .map_err(|_| "Failed to acquire Grok OAuth lock".to_string())?
        .clone()
        .ok_or_else(|| "No pending Grok OAuth login found, please start again".to_string())?;
    if state.login_id != login_id {
        return Err("Grok OAuth login_id mismatch, please start again".to_string());
    }
    if state.cancelled {
        return Err("Grok OAuth login cancelled".to_string());
    }
    if now_ts() >= state.expires_at {
        return Err("Grok OAuth login timed out, please retry".to_string());
    }
    Ok(state)
}

fn cli_proxy_get(client: &reqwest::Client, url: &str, access_token: &str) -> reqwest::RequestBuilder {
    let client_version = detect_client_version();
    client
        .get(url)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(ACCEPT, "application/json")
        .header("x-xai-token-auth", "xai-grok-cli")
        .header("x-grok-cli-version", &client_version)
        .header("x-grok-client-version", &client_version)
        .header("x-grok-client-surface", "grok-cli")
        .header(USER_AGENT, format!("grok-cli/{}", client_version))
}

async fn fetch_userinfo(
    client: &reqwest::Client,
    endpoint: &str,
    access_token: &str,
) -> Option<Value> {
    let response = client
        .get(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

async fn fetch_cli_json(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
) -> Option<Value> {
    let response = cli_proxy_get(client, url, access_token).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

fn build_auth_raw(
    token: &GrokTokenResponse,
    claims: &Value,
    expires_at: Option<i64>,
) -> Value {
    let email = claim_text(claims, &["email", "preferred_username"])
        .unwrap_or_else(|| "unknown@grok.local".to_string());
    let create_time = chrono::Utc::now().to_rfc3339();
    let expires_at_text = expires_at
        .and_then(|value| chrono::DateTime::from_timestamp(value, 0))
        .map(|value| value.to_rfc3339());
    json!({
        "key": token.access_token,
        "auth_mode": "oidc",
        "create_time": create_time,
        "user_id": claim_text(claims, &["user_id", "uid"])
            .or_else(|| claim_text(claims, &["principal_id", "sub"])),
        "email": email,
        "first_name": claim_text(claims, &["first_name", "given_name"]),
        "last_name": claim_text(claims, &["last_name", "family_name"]),
        "principal_type": claim_text(claims, &["principal_type"]).or_else(|| Some("User".to_string())),
        "principal_id": claim_text(claims, &["principal_id", "sub"]),
        "team_id": claim_text(claims, &["team_id"]),
        "coding_data_retention_opt_out": claims
            .get("coding_data_retention_opt_out")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        "refresh_token": token.refresh_token,
        "expires_at": expires_at_text,
        "oidc_issuer": OIDC_ISSUER,
        "oidc_client_id": OIDC_CLIENT_ID,
    })
}

fn claims_of_auth_raw(auth_raw: &Value) -> Value {
    let mut claims = Map::new();
    for key in [
        "email",
        "user_id",
        "principal_id",
        "principal_type",
        "first_name",
        "last_name",
        "team_id",
    ] {
        if let Some(value) = auth_raw.get(key).filter(|value| !value.is_null()) {
            claims.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(claims)
}

fn display_name(claims: &Value) -> String {
    let first = claim_text(claims, &["first_name", "given_name"]);
    let last = claim_text(claims, &["last_name", "family_name"]);
    let joined = [first, last]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    if joined.is_empty() {
        claim_text(claims, &["name", "preferred_username", "email"])
            .unwrap_or_else(|| "Grok".to_string())
    } else {
        joined
    }
}

fn build_config(
    auth_raw: Value,
    user_info: Option<Value>,
    billing: Option<Value>,
    source: &str,
) -> Value {
    let claims = claims_of_auth_raw(&auth_raw);
    let email = claim_text(&claims, &["email"]).unwrap_or_else(|| "unknown@grok.local".to_string());
    let name = display_name(&claims);
    let mut result = Map::new();
    result.insert("email".to_string(), json!(email));
    result.insert("name".to_string(), json!(name));
    result.insert("providerId".to_string(), json!("Grok"));
    result.insert("authMode".to_string(), json!("oidc"));
    if let Some(token) = auth_raw.get("key").and_then(Value::as_str) {
        result.insert("accessToken".to_string(), json!(token));
    }
    if let Some(token) = auth_raw.get("refresh_token").and_then(Value::as_str) {
        result.insert("refreshToken".to_string(), json!(token));
    }
    if let Some(expires) = auth_raw.get("expires_at").and_then(Value::as_str) {
        result.insert("expiresAt".to_string(), json!(expires));
    }
    result.insert("source".to_string(), json!(source));
    result.insert("authRaw".to_string(), auth_raw);
    if let Some(value) = user_info {
        result.insert("userInfo".to_string(), value);
    }
    if let Some(value) = billing {
        result.insert("billing".to_string(), value);
    }
    Value::Object(result)
}

fn parse_settings(settings: Option<String>) -> Result<Value, String> {
    let settings = settings.ok_or_else(|| "Settings parameter is required".to_string())?;
    serde_json::from_str(&settings).map_err(|error| format!("Failed to parse settings JSON: {}", error))
}

async fn refresh_tokens(
    client: &reqwest::Client,
    refresh_token: &str,
) -> Result<GrokTokenResponse, String> {
    let response = client
        .post(DEFAULT_TOKEN_ENDPOINT)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", OIDC_CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|error| format!("Failed to refresh Grok token: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Grok token refresh response: {}", error))?;
    if !status.is_success() {
        let parsed: TokenErrorResponse = serde_json::from_str(&body).unwrap_or(TokenErrorResponse {
            error: None,
            error_description: None,
        });
        return Err(format!(
            "Failed to refresh Grok token: {}{}",
            parsed.error.unwrap_or_else(|| status.as_u16().to_string()),
            parsed
                .error_description
                .as_deref()
                .map(|value| format!(" ({})", value))
                .unwrap_or_default()
        ));
    }
    let token: GrokTokenResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse Grok token refresh response: {}", error))?;
    if token.access_token.trim().is_empty() {
        return Err("Grok token refresh returned an empty access_token".to_string());
    }
    Ok(token)
}

#[tauri::command]
pub async fn grok_oauth_login_start() -> Result<GrokOAuthStartResponse, String> {
    let client = http_client()?;
    let discovery = discover(&client).await?;
    let response = client
        .post(&discovery.device_authorization_endpoint)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .form(&[("client_id", OIDC_CLIENT_ID), ("scope", OIDC_SCOPE)])
        .send()
        .await
        .map_err(|error| format!("Failed to start Grok device flow: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Grok device flow response: {}", error))?;
    if !status.is_success() {
        return Err(format!("Grok device flow returned {}", status.as_u16()));
    }
    let device: DeviceCodeResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse Grok device flow response: {}", error))?;
    if device.device_code.trim().is_empty()
        || device.user_code.trim().is_empty()
        || device.verification_uri.trim().is_empty()
    {
        return Err("Grok device flow response is missing required fields".to_string());
    }

    let verification_uri = validate_xai_endpoint(&device.verification_uri, "verification_uri")?;
    let verification_uri_complete = if let Some(complete) = device.verification_uri_complete.as_deref() {
        validate_xai_endpoint(complete, "verification_uri_complete")?
    } else {
        let mut url = url::Url::parse(&verification_uri)
            .map_err(|error| format!("Invalid Grok verification URL: {}", error))?;
        url.query_pairs_mut()
            .append_pair("user_code", &device.user_code);
        url.to_string()
    };

    let expires_in = device.expires_in.clamp(1, MAX_LOGIN_SECONDS);
    let interval_seconds = device
        .interval
        .unwrap_or(DEFAULT_INTERVAL_SECONDS)
        .max(DEFAULT_INTERVAL_SECONDS);
    let login_id = Uuid::new_v4().to_string();

    *PENDING_GROK_LOGIN
        .lock()
        .map_err(|_| "Failed to acquire Grok OAuth lock".to_string())? = Some(PendingGrokLogin {
        login_id: login_id.clone(),
        device_code: device.device_code,
        token_endpoint: discovery.token_endpoint,
        userinfo_endpoint: discovery.userinfo_endpoint,
        expires_at: now_ts() + expires_in,
        interval_seconds,
        cancelled: false,
    });

    log_info("[Grok OAuth] Device flow started");
    Ok(GrokOAuthStartResponse {
        login_id,
        verification_uri,
        verification_uri_complete,
        user_code: device.user_code,
        expires_in,
        interval_seconds,
    })
}

#[tauri::command]
pub async fn grok_oauth_login_complete(
    _app: AppHandle,
    login_id: String,
) -> Result<Value, String> {
    let client = http_client()?;
    let mut interval = pending_login(&login_id)?.interval_seconds;
    let mut consecutive_transport_errors = 0_u8;

    loop {
        let state = pending_login(&login_id)?;
        match poll_token_once(&client, &state).await? {
            PollResult::Pending => consecutive_transport_errors = 0,
            PollResult::SlowDown => {
                consecutive_transport_errors = 0;
                interval = interval.saturating_add(DEFAULT_INTERVAL_SECONDS);
            }
            PollResult::TransportFailure(error) => {
                consecutive_transport_errors = consecutive_transport_errors.saturating_add(1);
                log_warn(format!(
                    "[Grok OAuth] Token poll transport failure ({}/{}): {}",
                    consecutive_transport_errors, MAX_CONSECUTIVE_POLL_TRANSPORT_ERRORS, error
                ));
                if consecutive_transport_errors >= MAX_CONSECUTIVE_POLL_TRANSPORT_ERRORS {
                    return Err(error);
                }
            }
            PollResult::Complete(token) => {
                pending_login(&login_id)?;
                let id_claims = decode_jwt_claims(token.id_token.as_deref());
                let access_claims = decode_jwt_claims(Some(&token.access_token));
                let userinfo = match state.userinfo_endpoint.as_deref() {
                    Some(endpoint) => fetch_userinfo(&client, endpoint, &token.access_token).await,
                    None => None,
                }
                .unwrap_or_else(|| json!({}));
                pending_login(&login_id)?;
                let claims = merge_claims(userinfo.clone(), merge_claims(id_claims, access_claims));
                let expires_at = token
                    .expires_in
                    .filter(|seconds| *seconds > 0)
                    .map(|seconds| now_ts() + seconds);
                let auth_raw = build_auth_raw(&token, &claims, expires_at);
                let user_info = fetch_cli_json(&client, CLI_USER_URL, &token.access_token).await;
                let billing = fetch_cli_json(&client, BILLING_URL, &token.access_token).await;

                if let Ok(mut pending) = PENDING_GROK_LOGIN.lock() {
                    if pending
                        .as_ref()
                        .map(|state| state.login_id == login_id)
                        .unwrap_or(false)
                    {
                        *pending = None;
                    }
                }

                return Ok(build_config(auth_raw, user_info, billing, "oauth"));
            }
        }
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

#[tauri::command]
pub fn grok_oauth_login_cancel(login_id: Option<String>) -> Result<(), String> {
    let mut pending = PENDING_GROK_LOGIN
        .lock()
        .map_err(|_| "Failed to acquire Grok OAuth lock".to_string())?;
    match (pending.as_ref(), login_id.as_deref().map(str::trim)) {
        (Some(_), None) => *pending = None,
        (Some(state), Some(id)) if !id.is_empty() && state.login_id == id => *pending = None,
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn grok_import_from_local() -> Result<Value, String> {
    let auth_path = grok_auth_path()?;
    if !auth_path.exists() {
        return Err("No local Grok CLI login found (~/.grok/auth.json missing)".to_string());
    }
    let content = std::fs::read_to_string(&auth_path)
        .map_err(|error| format!("Failed to read local Grok auth.json: {}", error))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse local Grok auth.json: {}", error))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Local Grok auth.json must be an object".to_string())?
        .clone();
    if object
        .get("key")
        .and_then(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
        .is_none()
    {
        return Err("Local Grok auth.json has no \"key\" (access token) field".to_string());
    }
    Ok(build_config(Value::Object(object), None, None, "local"))
}

#[tauri::command]
pub async fn refresh_grok_token(_app: AppHandle, settings: Option<String>) -> Result<Value, String> {
    let mut config = parse_settings(settings)?;
    let client = http_client()?;

    let refresh_token = config
        .get("refreshToken")
        .or_else(|| config.get("refresh_token"))
        .and_then(Value::as_str)
        .and_then(|value| normalize_text(Some(value)));

    if let Some(refresh_token) = refresh_token {
        match refresh_tokens(&client, &refresh_token).await {
            Ok(token) => {
                let expires_at = token
                    .expires_in
                    .filter(|seconds| *seconds > 0)
                    .map(|seconds| now_ts() + seconds);
                let claims = claims_of_auth_raw(config.get("authRaw").unwrap_or(&json!({})));
                let new_auth_raw = build_auth_raw(&token, &claims, expires_at);
                if let Some(object) = config.as_object_mut() {
                    object.insert("authRaw".to_string(), new_auth_raw.clone());
                    object.insert(
                        "accessToken".to_string(),
                        json!(token.access_token),
                    );
                    if let Some(new_refresh) = token.refresh_token.as_deref() {
                        object.insert("refreshToken".to_string(), json!(new_refresh));
                    }
                    if let Some(expires) = new_auth_raw.get("expires_at").and_then(Value::as_str) {
                        object.insert("expiresAt".to_string(), json!(expires));
                    }
                }
            }
            Err(error) => {
                log_warn(format!("[Grok Refresh] Token refresh failed, keeping cached tokens: {}", error));
            }
        }
    }

    let access_token = config
        .get("accessToken")
        .or_else(|| config.get("authRaw").and_then(|raw| raw.get("key")))
        .and_then(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
        .ok_or_else(|| "Missing Grok access token in settings".to_string())?;

    let user_info = fetch_cli_json(&client, CLI_USER_URL, &access_token).await;
    let billing = fetch_cli_json(&client, BILLING_URL, &access_token).await;

    if let Some(object) = config.as_object_mut() {
        if let Some(value) = user_info {
            object.insert("userInfo".to_string(), value);
        }
        if let Some(value) = billing {
            object.insert("billing".to_string(), value);
        }
    }

    Ok(config)
}

#[tauri::command]
pub fn switch_grok_account(
    _app: AppHandle,
    settings: Option<String>,
) -> Result<(), String> {
    let config = parse_settings(settings)?;
    let auth_raw = config.get("authRaw").cloned().unwrap_or_else(|| {
        json!({
            "key": config.get("accessToken").and_then(Value::as_str),
            "auth_mode": "oidc",
            "email": config.get("email").and_then(Value::as_str),
            "refresh_token": config.get("refreshToken").and_then(Value::as_str),
            "expires_at": config.get("expiresAt").and_then(Value::as_str),
            "oidc_issuer": OIDC_ISSUER,
            "oidc_client_id": OIDC_CLIENT_ID,
        })
    });
    if auth_raw
        .get("key")
        .and_then(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
        .is_none()
    {
        return Err("Grok account has no access token, cannot switch".to_string());
    }

    let home = grok_home_dir()?;
    std::fs::create_dir_all(&home)
        .map_err(|error| format!("Failed to create Grok home directory: {}", error))?;
    let auth_path = home.join("auth.json");

    if auth_path.exists() {
        let backup_path = home.join("auth.json.bak");
        if let Err(error) = std::fs::copy(&auth_path, &backup_path) {
            log_warn(format!("[Grok Switch] Failed to back up auth.json: {}", error));
        }
    }

    let content = serde_json::to_string_pretty(&auth_raw)
        .map_err(|error| format!("Failed to serialize Grok auth.json: {}", error))?;
    std::fs::write(&auth_path, content)
        .map_err(|error| format!("Failed to write Grok auth.json: {}", error))?;
    log_info(&format!(
        "[Grok Switch] Synced official login to {}",
        auth_path.display()
    ));
    Ok(())
}
