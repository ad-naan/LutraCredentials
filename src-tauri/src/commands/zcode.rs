use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use once_cell::sync::Lazy;
use rand::RngCore;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use url::Url;
use uuid::Uuid;

use crate::utils::logger::{log_info, log_warn};

const OAUTH_TIMEOUT_SECONDS: i64 = 300;
const ZCODE_TOKEN_URL: &str = "https://zcode.z.ai/api/v1/oauth/token";
const BILLING_BALANCE_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
const BIGMODEL_AUTHORIZE_URL: &str = "https://bigmodel.cn/login";
const BIGMODEL_USER_INFO_URL: &str = "https://open.bigmodel.cn/api/biz/customer/getCustomerInfo";
const BIGMODEL_REDIRECT_URI: &str = "zcode://oauth/callback";
const ZAI_AUTHORIZE_URL: &str = "https://chat.z.ai/api/oauth/authorize";
const ZAI_USER_INFO_URL: &str = "https://chat.z.ai/api/oauth/userinfo";
const ZAI_BUSINESS_LOGIN_URL: &str = "https://api.z.ai/api/auth/z/login";
const ZAI_REDIRECT_URI: &str = "zcode://zai-auth/callback";
const ZAI_CLIENT_ID: &str = "client_P8X5CMWmlaRO9gyO-KSqtg";

const CREDENTIALS_FILE: &str = "credentials.json";
const CONFIG_FILE: &str = "config.json";
const SETTINGS_FILE: &str = "setting.json";
const DEVICE_MID_FILE: &str = "zcode_device_mid";
const CREDENTIAL_PREFIX: &str = "enc:v1:";
const ACTIVE_PROVIDER_KEY: &str = "oauth:active_provider";
const ZCODE_JWT_KEY: &str = "zcodejwttoken";
const ZAI_API_KEY_PROVIDER_ID: &str = "builtin:zai";
const BIGMODEL_API_KEY_PROVIDER_ID: &str = "builtin:bigmodel";
const ZAI_API_BASE_URL: &str = "https://api.z.ai/api/anthropic";
const BIGMODEL_API_BASE_URL: &str = "https://open.bigmodel.cn/api/anthropic";
const DEFAULT_APP_VERSION: &str = "3.10.2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ZcodeOAuthStartResponse {
    pub login_id: String,
    pub provider: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval_seconds: u64,
    pub callback_url: String,
}

#[derive(Debug, Clone)]
struct PendingZcodeOAuth {
    login_id: String,
    provider: String,
    state: String,
    expires_at: i64,
    result: Option<Value>,
    error: Option<String>,
    processing: bool,
    cancelled: bool,
}

static PENDING_ZCODE_OAUTH: Lazy<Mutex<Option<PendingZcodeOAuth>>> = Lazy::new(|| Mutex::new(None));

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn normalize_provider(provider: &str) -> Result<&'static str, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "zai" => Ok("zai"),
        "bigmodel" => Ok("bigmodel"),
        _ => Err("Unsupported Zcode OAuth provider (expected zai or bigmodel)".to_string()),
    }
}

fn provider_display_name(provider: &str) -> &'static str {
    if provider == "bigmodel" {
        "BigModel"
    } else {
        "Z.ai"
    }
}

fn pick_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut current = value;
        let mut found = true;
        for key in *path {
            if let Some(next) = current.get(*key) {
                current = next;
            } else {
                found = false;
                break;
            }
        }
        if found {
            if let Some(text) = current.as_str().map(str::trim).filter(|t| !t.is_empty()) {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .and_then(|value| normalize_text(Some(value)))
}

// ---------------------------------------------------------------------------
// Credential encryption (enc:v1, AES-256-GCM with home-derived key)
// ---------------------------------------------------------------------------

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn fallback_credential_secret(platform: &str, home_dir: &Path, username: &str) -> String {
    format!(
        "zcode-credential-fallback:{}:{}:{}",
        platform,
        home_dir.to_string_lossy(),
        username
    )
}

fn credential_secret_for_home(home_dir: &Path) -> String {
    std::env::var("ZCODE_CREDENTIAL_SECRET")
        .ok()
        .filter(|secret| !secret.is_empty())
        .unwrap_or_else(|| fallback_credential_secret(platform_name(), home_dir, &username()))
}

fn credential_key(home_dir: &Path) -> [u8; 32] {
    Sha256::digest(credential_secret_for_home(home_dir).as_bytes()).into()
}

fn decode_component(value: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|error| format!("Failed to decode Zcode credential component: {}", error))
}

fn decrypt_credential(value: &str, home_dir: &Path) -> Result<String, String> {
    if !value.starts_with(CREDENTIAL_PREFIX) {
        return Ok(value.to_string());
    }
    let parts: Vec<&str> = value[CREDENTIAL_PREFIX.len()..].split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid Zcode credential ciphertext format".to_string());
    }
    let nonce = decode_component(parts[0])?;
    let tag = decode_component(parts[1])?;
    let mut encrypted = decode_component(parts[2])?;
    if nonce.len() != 12 || tag.len() != 16 {
        return Err("Invalid Zcode credential ciphertext parameters".to_string());
    }
    encrypted.extend_from_slice(&tag);
    let cipher =
        Aes256Gcm::new_from_slice(&credential_key(home_dir)).map_err(|_| {
            "Failed to initialize Zcode credential cipher".to_string()
        })?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce), encrypted.as_ref())
        .map_err(|_| {
            "Failed to decrypt Zcode credential (home/user differs from the writing environment)"
                .to_string()
        })?;
    String::from_utf8(plain).map_err(|error| format!("Zcode credential is not valid UTF-8: {}", error))
}

fn encrypt_credential(value: &str, home_dir: &Path) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(&credential_key(home_dir))
        .map_err(|_| "Failed to initialize Zcode credential cipher".to_string())?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let mut encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
        .map_err(|_| "Failed to encrypt Zcode credential".to_string())?;
    if encrypted.len() < 16 {
        return Err("Invalid Zcode credential encryption result".to_string());
    }
    let tag = encrypted.split_off(encrypted.len() - 16);
    Ok(format!(
        "{}{}.{}.{}",
        CREDENTIAL_PREFIX,
        URL_SAFE_NO_PAD.encode(nonce),
        URL_SAFE_NO_PAD.encode(tag),
        URL_SAFE_NO_PAD.encode(encrypted)
    ))
}

// ---------------------------------------------------------------------------
// Local Zcode files
// ---------------------------------------------------------------------------

fn read_json_map(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {}", path.display(), error))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} must be a JSON object", path.display()))
}

fn write_json_map_with_backup(path: &Path, values: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory {}: {}", parent.display(), error))?;
    }
    if path.exists() {
        let backup = path.with_extension(format!(
            "{}.bak",
            path.extension()
                .map(|ext| ext.to_string_lossy().to_string())
                .unwrap_or_default()
        ));
        if let Err(error) = std::fs::copy(path, &backup) {
            log_warn(format!(
                "[Zcode] Failed to back up {}: {}",
                path.display(),
                error
            ));
        }
    }
    let content = serde_json::to_string_pretty(&Value::Object(values.clone()))
        .map_err(|error| format!("Failed to serialize {}: {}", path.display(), error))?;
    std::fs::write(path, content)
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))
}

fn resolve_default_v2_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let default = home.join(".zcode/v2");
    let setting_path = default.join(SETTINGS_FILE);
    if let Ok(content) = std::fs::read_to_string(setting_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&content) {
            if let Some(base) = value
                .get("dataBaseDir")
                .and_then(Value::as_str)
                .and_then(|v| normalize_text(Some(v)))
            {
                return Ok(PathBuf::from(base).join(".zcode/v2"));
            }
        }
    }
    Ok(default)
}

fn default_credentials_path() -> Result<PathBuf, String> {
    Ok(resolve_default_v2_dir()?.join(CREDENTIALS_FILE))
}

fn default_config_path() -> Result<PathBuf, String> {
    Ok(resolve_default_v2_dir()?.join(CONFIG_FILE))
}

fn default_settings_path() -> Result<PathBuf, String> {
    Ok(resolve_default_v2_dir()?.join(SETTINGS_FILE))
}

fn ensure_object<'a>(map: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let value = map
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("object inserted above")
}

// ---------------------------------------------------------------------------
// Config JSON construction
// ---------------------------------------------------------------------------

fn build_oauth_config(
    provider: &str,
    access_token: String,
    refresh_token: Option<String>,
    zcode_jwt_token: String,
    expires_at: Option<i64>,
    user_info: Value,
    source: &str,
) -> Value {
    let user_id = pick_string(&user_info, &[&["user_id"], &["id"], &["customerNumber"], &["sub"]]);
    let email = pick_string(&user_info, &[&["email"]])
        .unwrap_or_else(|| "unknown@zcode.local".to_string());
    let display_name = pick_string(
        &user_info,
        &[
            &["name"],
            &["displayName"],
            &["username"],
            &["nickName"],
            &["customerName"],
        ],
    )
    .unwrap_or_else(|| provider_display_name(provider).to_string());

    let mut result = Map::new();
    result.insert("email".to_string(), json!(email));
    result.insert("name".to_string(), json!(display_name));
    result.insert(
        "providerId".to_string(),
        json!(format!("Zcode ({})", provider_display_name(provider))),
    );
    result.insert("authMode".to_string(), json!("oauth"));
    result.insert("provider".to_string(), json!(provider));
    result.insert("accessToken".to_string(), json!(access_token));
    if let Some(refresh) = refresh_token.as_deref() {
        result.insert("refreshToken".to_string(), json!(refresh));
    }
    result.insert("zcodeJwtToken".to_string(), json!(zcode_jwt_token));
    if let Some(expires) = expires_at {
        result.insert("expiresAt".to_string(), json!(expires));
    }
    if let Some(value) = user_id {
        result.insert("userId".to_string(), json!(value));
    }
    result.insert("userInfo".to_string(), user_info);
    result.insert("source".to_string(), json!(source));
    Value::Object(result)
}

fn build_api_key_config(provider: &str, api_key: &str, account_name: Option<&str>) -> Value {
    let suffix: String = api_key.chars().rev().take(4).collect();
    let name = normalize_text(account_name).unwrap_or_else(|| {
        format!("{} API Key ...{}", provider_display_name(provider), suffix)
    });
    let mut result = Map::new();
    result.insert("email".to_string(), json!("unknown@zcode.local"));
    result.insert("name".to_string(), json!(name));
    result.insert("providerId".to_string(), json!("API Key"));
    result.insert("authMode".to_string(), json!("api_key"));
    result.insert("provider".to_string(), json!(provider));
    result.insert("apiKey".to_string(), json!(api_key));
    result.insert("source".to_string(), json!("token"));
    Value::Object(result)
}

fn parse_settings(settings: Option<String>) -> Result<Value, String> {
    let settings = settings.ok_or_else(|| "Settings parameter is required".to_string())?;
    serde_json::from_str(&settings).map_err(|error| format!("Failed to parse settings JSON: {}", error))
}

// ---------------------------------------------------------------------------
// Billing / quota request (mimics the official Zcode client)
// ---------------------------------------------------------------------------

fn zcode_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        "linux" => "linux",
        _ => std::env::consts::OS,
    }
}

fn zcode_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        "arm" => "arm",
        _ => std::env::consts::ARCH,
    }
}

fn zcode_os_version() -> String {
    if let Ok(output) = std::process::Command::new("cmd")
        .args(["/c", "ver"])
        .stdin(std::process::Stdio::null())
        .output()
    {
        let value = crate::utils::encoding::decode_console_output(&output.stdout).trim().to_string();
        if output.status.success() && !value.is_empty() {
            return value;
        }
    }
    std::env::consts::OS.to_string()
}

fn zcode_locale() -> String {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .map(|value| {
            value
                .split('.')
                .next()
                .unwrap_or(value.as_str())
                .replace('_', "-")
        })
        .unwrap_or_else(|| "en-US".to_string())
}

fn zcode_device_mid() -> Result<String, String> {
    let data_dir = resolve_default_v2_dir()?;
    let telemetry_path = data_dir.join("telemetry-state.json");
    if let Ok(content) = std::fs::read_to_string(&telemetry_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&content) {
            if let Some(device_mid) = value
                .get("deviceMid")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value.trim()).ok())
            {
                return Ok(device_mid.to_string());
            }
        }
    }

    let path = data_dir.join(DEVICE_MID_FILE);
    if let Ok(value) = std::fs::read_to_string(&path) {
        if let Ok(uuid) = Uuid::parse_str(value.trim()) {
            return Ok(uuid.to_string());
        }
    }
    let value = Uuid::new_v4().to_string();
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create Zcode data directory: {}", error))?;
    std::fs::write(&path, &value)
        .map_err(|error| format!("Failed to persist Zcode device id: {}", error))?;
    Ok(value)
}

fn normalize_header_value(value: impl Into<String>) -> Option<HeaderValue> {
    HeaderValue::from_str(value.into().trim()).ok()
}

fn zcode_source_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    let values = [
        (USER_AGENT, format!("ZCode/{}", DEFAULT_APP_VERSION)),
        (
            HeaderName::from_static("http-referer"),
            "https://zcode.z.ai".to_string(),
        ),
        (
            HeaderName::from_static("x-zcode-app-version"),
            DEFAULT_APP_VERSION.to_string(),
        ),
        (
            HeaderName::from_static("x-title"),
            "Z Code@electron".to_string(),
        ),
        (
            HeaderName::from_static("x-platform"),
            format!("{}-{}", zcode_platform(), zcode_arch()),
        ),
        (
            HeaderName::from_static("x-release-channel"),
            if cfg!(debug_assertions) {
                "test".to_string()
            } else {
                "production".to_string()
            },
        ),
        (HeaderName::from_static("x-client-language"), zcode_locale()),
        (
            HeaderName::from_static("x-client-timezone"),
            std::env::var("TZ")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "UTC".to_string()),
        ),
        (
            HeaderName::from_static("x-os-category"),
            zcode_platform().to_string(),
        ),
        (HeaderName::from_static("x-os-version"), zcode_os_version()),
    ];
    for (name, value) in values {
        if let Some(value) = normalize_header_value(value) {
            headers.insert(name, value);
        }
    }
    if let Ok(device_mid) = zcode_device_mid() {
        if let Some(value) = normalize_header_value(device_mid) {
            headers.insert(HeaderName::from_static("x-device-mid"), value);
        }
    }
    if let Some(value) = normalize_header_value(Uuid::new_v4().to_string()) {
        headers.insert(HeaderName::from_static("x-request-id"), value);
    }
    headers
}

async fn fetch_billing_balance(zcode_jwt_token: &str) -> Result<Value, String> {
    let url = format!("{}?app_version={}", BILLING_BALANCE_URL, DEFAULT_APP_VERSION);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to build Zcode quota client: {}", error))?;
    let response = client
        .get(&url)
        .headers(zcode_source_headers())
        .bearer_auth(zcode_jwt_token)
        .send()
        .await
        .map_err(|error| format!("Failed to request Zcode quota: {}", error))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|payload| {
                payload
                    .get("msg")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        payload
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
            })
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| "no server error details".to_string());
        return Err(format!(
            "Failed to request Zcode quota: HTTP {} ({})",
            status.as_u16(),
            message
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Failed to parse Zcode quota response: {}", error))
}

fn number_of(value: Option<&Value>) -> f64 {
    value
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        })
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
}

fn apply_quota_to_config(config: &mut Value, payload: Value) -> Result<(), String> {
    if payload.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("Zcode quota endpoint returned an error")
            .to_string());
    }

    let data = payload.get("data").cloned().unwrap_or_else(|| json!({}));
    let plans = data
        .get("plans")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let balances = data
        .get("balances")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let plan_type = plans
        .iter()
        .find(|plan| plan.get("status").and_then(Value::as_str) == Some("active"))
        .or_else(|| plans.first())
        .and_then(|plan| value_string(plan, &["name", "plan_id"]));

    let quota_total: f64 = balances
        .iter()
        .map(|item| number_of(item.get("total_units")))
        .sum();
    let quota_used: f64 = balances
        .iter()
        .map(|item| number_of(item.get("used_units")))
        .sum();
    let quota_remaining: f64 = balances
        .iter()
        .map(|item| {
            number_of(
                item.get("remaining_units")
                    .or_else(|| item.get("available_units")),
            )
        })
        .sum();

    let object = config
        .as_object_mut()
        .ok_or_else(|| "Zcode config must be an object".to_string())?;
    if let Some(plan) = plan_type {
        object.insert("providerId".to_string(), json!(plan));
    }
    object.insert(
        "quota".to_string(),
        json!({
            "total": quota_total,
            "used": quota_used,
            "remaining": quota_remaining,
        }),
    );
    object.insert("subscription".to_string(), json!(plans));
    object.insert("quotaRaw".to_string(), json!(balances));
    Ok(())
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

fn generate_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn build_authorize_url(provider: &str, state: &str) -> Result<(String, String), String> {
    if provider == "zai" {
        let mut url = Url::parse(ZAI_AUTHORIZE_URL).map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair("redirect_uri", ZAI_REDIRECT_URI)
            .append_pair("response_type", "code")
            .append_pair("client_id", ZAI_CLIENT_ID)
            .append_pair("state", state);
        return Ok((url.to_string(), ZAI_REDIRECT_URI.to_string()));
    }

    let mut url = Url::parse(BIGMODEL_AUTHORIZE_URL).map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("redirect", BIGMODEL_REDIRECT_URI)
        .append_pair("appId", "zcode")
        .append_pair("state", state);
    Ok((url.to_string(), BIGMODEL_REDIRECT_URI.to_string()))
}

fn parse_callback_url(callback_url: &str, pending: &PendingZcodeOAuth) -> Result<String, String> {
    let url = Url::parse(callback_url.trim())
        .map_err(|error| format!("Invalid Zcode OAuth callback URL: {}", error))?;
    if url.scheme() != "zcode" {
        return Err("Zcode OAuth callback must use the zcode:// scheme".to_string());
    }
    let expected_host = if pending.provider == "zai" {
        "zai-auth"
    } else {
        "oauth"
    };
    if url.host_str() != Some(expected_host) || url.path() != "/callback" {
        return Err("Zcode OAuth callback does not match the login provider".to_string());
    }
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .ok_or_else(|| "Zcode OAuth callback is missing state".to_string())?;
    if state != pending.state {
        return Err("Zcode OAuth state mismatch or expired".to_string());
    }
    if let Some(error) = url
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned())
    {
        return Err(format!("Zcode OAuth authorization failed: {}", error));
    }
    url.query_pairs()
        .find(|(key, _)| key == "code" || key == "authCode")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Zcode OAuth callback is missing code/authCode".to_string())
}

async fn read_json_response(response: reqwest::Response, context: &str) -> Result<Value, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{} failed: HTTP {}", context, status.as_u16()));
    }
    serde_json::from_str(&text).map_err(|error| format!("Failed to parse {} response: {}", context, error))
}

struct OAuthTokenEnvelope {
    zcode_jwt_token: String,
    provider_access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    user_info: Value,
}

fn parse_token_envelope(
    provider: &str,
    token_response: &Value,
) -> Result<OAuthTokenEnvelope, String> {
    let code = token_response.get("code").and_then(Value::as_i64);
    let success = if provider == "zai" {
        code == Some(0)
    } else {
        code.is_none() || code == Some(0)
    };
    if !success {
        return Err(token_response
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("Zcode OAuth token exchange failed")
            .to_string());
    }

    let zcode_jwt_token = pick_string(token_response, &[&["data", "token"]])
        .ok_or_else(|| "Zcode OAuth response is missing data.token".to_string())?;
    if provider == "zai" {
        let provider_access_token = pick_string(
            token_response,
            &[
                &["data", "zai", "access_token"],
                &["data", "zai", "accessToken"],
            ],
        )
        .ok_or_else(|| "Z.ai OAuth response is missing access_token".to_string())?;
        return Ok(OAuthTokenEnvelope {
            zcode_jwt_token,
            provider_access_token,
            refresh_token: None,
            expires_in: token_response
                .pointer("/data/expires_in")
                .and_then(Value::as_i64),
            user_info: token_response
                .pointer("/data/user")
                .cloned()
                .unwrap_or_else(|| json!({})),
        });
    }

    let provider_access_token = pick_string(
        token_response,
        &[
            &["data", "bigmodel", "access_token"],
            &["data", "bigmodel", "accessToken"],
            &["data", "access_token"],
            &["data", "accessToken"],
        ],
    )
    .ok_or_else(|| "BigModel OAuth response is missing access_token".to_string())?;
    let refresh_token = pick_string(
        token_response,
        &[
            &["data", "bigmodel", "refresh_token"],
            &["data", "bigmodel", "refreshToken"],
        ],
    );
    Ok(OAuthTokenEnvelope {
        zcode_jwt_token,
        provider_access_token,
        refresh_token,
        expires_in: None,
        user_info: json!({}),
    })
}

fn parse_zai_business_token(response: &Value) -> Result<String, String> {
    let code_is_success = match response.get("code") {
        None | Some(Value::Null) => true,
        Some(Value::Number(code)) => code.as_i64().is_some_and(|code| code == 0 || code == 200),
        Some(Value::String(code)) => matches!(code.trim(), "0" | "200"),
        _ => false,
    };
    if !code_is_success || response.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(response
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("Z.ai business token exchange failed")
            .to_string());
    }
    pick_string(
        response,
        &[&["data", "access_token"], &["data", "accessToken"]],
    )
    .ok_or_else(|| "Z.ai business token response is missing access_token".to_string())
}

async fn exchange_callback(pending: &PendingZcodeOAuth, code: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to build Zcode OAuth client: {}", error))?;
    let redirect_uri = if pending.provider == "zai" {
        ZAI_REDIRECT_URI
    } else {
        BIGMODEL_REDIRECT_URI
    };
    let token_response = read_json_response(
        client
            .post(ZCODE_TOKEN_URL)
            .json(&json!({
                "provider": pending.provider,
                "code": code,
                "redirect_uri": redirect_uri,
                "state": pending.state,
            }))
            .send()
            .await
            .map_err(|error| format!("Failed to request Zcode OAuth token: {}", error))?,
        "Zcode OAuth token exchange",
    )
    .await?;
    let envelope = parse_token_envelope(&pending.provider, &token_response)?;
    let zcode_jwt_token = envelope.zcode_jwt_token;
    let (access_token, refresh_token, expires_at, mut user_info) = if pending.provider == "zai" {
        let business_response = read_json_response(
            client
                .post(ZAI_BUSINESS_LOGIN_URL)
                .json(&json!({ "token": envelope.provider_access_token }))
                .send()
                .await
                .map_err(|error| format!("Failed to request Z.ai business token: {}", error))?,
            "Z.ai business token exchange",
        )
        .await?;
        let access_token = parse_zai_business_token(&business_response)?;
        let expires_at = envelope.expires_in.map(|seconds| now_ts() + seconds);
        (access_token, None, expires_at, envelope.user_info)
    } else {
        (
            envelope.provider_access_token,
            envelope.refresh_token,
            None,
            envelope.user_info,
        )
    };

    if user_info.as_object().is_none_or(|value| value.is_empty()) {
        let request = if pending.provider == "zai" {
            client.get(ZAI_USER_INFO_URL).bearer_auth(&access_token)
        } else {
            client
                .get(BIGMODEL_USER_INFO_URL)
                .header(reqwest::header::AUTHORIZATION, &access_token)
        };
        if let Ok(response) = request.send().await {
            if let Ok(payload) = read_json_response(response, "Zcode user info").await {
                user_info = payload.get("data").cloned().unwrap_or(payload);
            }
        }
    }

    let mut config = build_oauth_config(
        &pending.provider,
        access_token,
        refresh_token,
        zcode_jwt_token,
        expires_at,
        user_info,
        "oauth",
    );
    if let Err(error) = refresh_config_quota(&mut config).await {
        log_warn(format!("[Zcode OAuth] Quota refresh failed after login: {}", error));
    }
    Ok(config)
}

async fn refresh_config_quota(config: &mut Value) -> Result<(), String> {
    let jwt = config
        .get("zcodeJwtToken")
        .and_then(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
        .ok_or_else(|| "Missing Zcode JWT token in settings".to_string())?;
    let payload = fetch_billing_balance(&jwt).await?;
    apply_quota_to_config(config, payload)
}

#[tauri::command]
pub fn zcode_oauth_login_start(provider: Option<String>) -> Result<ZcodeOAuthStartResponse, String> {
    let provider = normalize_provider(provider.as_deref().unwrap_or("zai"))?;
    let login_id = Uuid::new_v4().to_string();
    let state = generate_state();
    let (auth_url, callback_url) = build_authorize_url(provider, &state)?;
    *PENDING_ZCODE_OAUTH
        .lock()
        .map_err(|_| "Failed to acquire Zcode OAuth lock".to_string())? = Some(PendingZcodeOAuth {
        login_id: login_id.clone(),
        provider: provider.to_string(),
        state,
        expires_at: now_ts() + OAUTH_TIMEOUT_SECONDS,
        result: None,
        error: None,
        processing: false,
        cancelled: false,
    });
    log_info(&format!(
        "[Zcode OAuth] Login session created: provider={}",
        provider
    ));
    Ok(ZcodeOAuthStartResponse {
        login_id,
        provider: provider.to_string(),
        verification_uri: auth_url,
        expires_in: OAUTH_TIMEOUT_SECONDS,
        interval_seconds: 1,
        callback_url,
    })
}

fn get_pending(login_id: &str) -> Result<PendingZcodeOAuth, String> {
    PENDING_ZCODE_OAUTH
        .lock()
        .map_err(|_| "Failed to acquire Zcode OAuth lock".to_string())?
        .as_ref()
        .cloned()
        .filter(|pending| pending.login_id == login_id)
        .ok_or_else(|| "Zcode OAuth session not found or already finished".to_string())
}

#[tauri::command]
pub async fn zcode_oauth_submit_callback_url(
    _app: AppHandle,
    login_id: String,
    callback_url: String,
) -> Result<(), String> {
    let pending = get_pending(&login_id)?;
    if pending.expires_at <= now_ts() {
        return Err("Zcode OAuth login has expired".to_string());
    }
    let code = parse_callback_url(&callback_url, &pending)?;
    {
        let mut guard = PENDING_ZCODE_OAUTH
            .lock()
            .map_err(|_| "Failed to acquire Zcode OAuth lock".to_string())?;
        let current = guard
            .as_mut()
            .filter(|current| current.login_id == login_id)
            .ok_or_else(|| "Zcode OAuth session not found or already finished".to_string())?;
        if current.processing || current.result.is_some() {
            return Ok(());
        }
        current.processing = true;
    }
    let result = exchange_callback(&pending, &code).await;
    let mut guard = PENDING_ZCODE_OAUTH
        .lock()
        .map_err(|_| "Failed to acquire Zcode OAuth lock".to_string())?;
    if let Some(current) = guard
        .as_mut()
        .filter(|current| current.login_id == login_id)
    {
        current.processing = false;
        match result {
            Ok(config) => {
                current.error = None;
                current.result = Some(config);
            }
            Err(error) if current.result.is_none() => current.error = Some(error),
            Err(_) => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn zcode_oauth_login_complete(
    _app: AppHandle,
    login_id: String,
) -> Result<Value, String> {
    loop {
        let pending = get_pending(&login_id)?;
        if pending.cancelled {
            return Err("Zcode OAuth login cancelled".to_string());
        }
        if pending.expires_at <= now_ts() {
            zcode_oauth_login_cancel_impl(Some(&login_id));
            return Err("Zcode OAuth login timed out".to_string());
        }
        if let Some(error) = pending.error {
            zcode_oauth_login_cancel_impl(Some(&login_id));
            return Err(error);
        }
        if let Some(config) = pending.result {
            zcode_oauth_login_cancel_impl(Some(&login_id));
            return Ok(config);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn zcode_oauth_login_cancel_impl(login_id: Option<&str>) {
    if let Ok(mut guard) = PENDING_ZCODE_OAUTH.lock() {
        if login_id.is_none() || guard.as_ref().map(|p| p.login_id.as_str()) == login_id {
            *guard = None;
        }
    }
}

#[tauri::command]
pub fn zcode_oauth_login_cancel(login_id: Option<String>) -> Result<(), String> {
    zcode_oauth_login_cancel_impl(login_id.as_deref());
    Ok(())
}

// ---------------------------------------------------------------------------
// Local import
// ---------------------------------------------------------------------------

fn decrypted_value(
    values: &Map<String, Value>,
    name: &str,
    home: &Path,
) -> Result<Option<String>, String> {
    values
        .get(name)
        .and_then(Value::as_str)
        .map(|value| decrypt_credential(value, home))
        .transpose()
}

fn account_from_credentials_path(path: &Path) -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let values = read_json_map(path)?;
    let provider = decrypted_value(&values, ACTIVE_PROVIDER_KEY, &home)?
        .ok_or_else(|| "Local Zcode credentials have no active provider".to_string())?;
    let provider = normalize_provider(&provider)?;
    let access_token =
        decrypted_value(&values, &format!("oauth:{}:access_token", provider), &home)?
            .ok_or_else(|| "Local Zcode credentials have no access token".to_string())?;
    let refresh_token =
        decrypted_value(&values, &format!("oauth:{}:refresh_token", provider), &home)?;
    let zcode_jwt_token = decrypted_value(&values, ZCODE_JWT_KEY, &home)?
        .ok_or_else(|| "Local Zcode credentials have no zcode JWT".to_string())?;
    let user_info_text =
        decrypted_value(&values, &format!("oauth:{}:user_info", provider), &home)?;
    let user_info = user_info_text
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or_else(|| json!({}));
    Ok(build_oauth_config(
        provider,
        access_token,
        refresh_token,
        zcode_jwt_token,
        None,
        user_info,
        "local",
    ))
}

fn api_key_from_provider_config(root: &Map<String, Value>, provider: &str) -> Option<String> {
    let provider_id = if provider == "bigmodel" {
        BIGMODEL_API_KEY_PROVIDER_ID
    } else {
        ZAI_API_KEY_PROVIDER_ID
    };
    root.get("provider")?
        .get(provider_id)?
        .get("options")?
        .get("apiKey")?
        .as_str()
        .and_then(|value| normalize_text(Some(value)))
}

#[tauri::command]
pub fn zcode_import_from_local() -> Result<Value, String> {
    let credentials_path = default_credentials_path()?;
    if credentials_path.exists() {
        match account_from_credentials_path(&credentials_path) {
            Ok(config) => return Ok(config),
            Err(error) => log_warn(format!(
                "[Zcode Import] Failed to read local OAuth credentials: {}",
                error
            )),
        }
    }

    let config_path = default_config_path()?;
    if config_path.exists() {
        let root = read_json_map(&config_path)?;
        for provider in ["zai", "bigmodel"] {
            if let Some(api_key) = api_key_from_provider_config(&root, provider) {
                return Ok(build_api_key_config(provider, &api_key, None));
            }
        }
    }

    Err("No importable Zcode OAuth credentials or API keys found".to_string())
}

// ---------------------------------------------------------------------------
// Refresh (also backs token import for API-key accounts)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn refresh_zcode_token(_app: AppHandle, settings: Option<String>) -> Result<Value, String> {
    let mut config = parse_settings(settings)?;

    // Token-import path: a bare access token with no authMode resolves as an API key.
    if config.get("authMode").and_then(Value::as_str).is_none() {
        let api_key = config
            .get("accessToken")
            .or_else(|| config.get("apiKey"))
            .and_then(Value::as_str)
            .and_then(|value| normalize_text(Some(value)))
            .ok_or_else(|| "Missing Zcode API key or access token in settings".to_string())?;
        if api_key.chars().any(char::is_whitespace) {
            return Err("Zcode API key must not contain whitespace".to_string());
        }
        let provider_hint = config
            .get("provider")
            .or_else(|| config.get("providerId"))
            .and_then(Value::as_str)
            .unwrap_or("zai");
        let provider = if provider_hint.to_ascii_lowercase().contains("bigmodel") {
            "bigmodel"
        } else {
            "zai"
        };
        let account_name = config.get("name").and_then(Value::as_str).map(str::to_string);
        return Ok(build_api_key_config(provider, &api_key, account_name.as_deref()));
    }

    let auth_mode = config
        .get("authMode")
        .and_then(Value::as_str)
        .unwrap_or("oauth")
        .to_string();

    if auth_mode == "api_key" {
        // API-key accounts carry no remote quota; return as-is.
        return Ok(config);
    }

    if let Err(error) = refresh_config_quota(&mut config).await {
        log_warn(format!("[Zcode Refresh] Quota refresh failed: {}", error));
    }
    Ok(config)
}

// ---------------------------------------------------------------------------
// Switch / inject into local Zcode files
// ---------------------------------------------------------------------------

fn default_api_key_models() -> Value {
    json!({
        "GLM-5.2": {
            "limit": { "context": 1_000_000 },
            "modalities": { "input": ["text"], "output": ["text"] }
        },
        "GLM-5-Turbo": {
            "name": "glm-5-turbo",
            "reasoning": {
                "enabled": true,
                "variants": ["enabled", "off"],
                "defaultVariant": "enabled"
            },
            "limit": { "context": 200_000, "output": 64_000 },
            "modalities": { "input": ["text"], "output": ["text"] }
        }
    })
}

fn write_api_key_to_config_path(provider: &str, api_key: &str, path: &Path) -> Result<(), String> {
    let (provider_id, display_name, base_url) = if provider == "bigmodel" {
        (
            BIGMODEL_API_KEY_PROVIDER_ID,
            "Bigmodel - API Key",
            BIGMODEL_API_BASE_URL,
        )
    } else {
        (ZAI_API_KEY_PROVIDER_ID, "Z.ai - API Key", ZAI_API_BASE_URL)
    };
    let mut root = read_json_map(path)?;
    let providers = ensure_object(&mut root, "provider");
    let provider_value = providers
        .entry(provider_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !provider_value.is_object() {
        *provider_value = Value::Object(Map::new());
    }
    let provider_config = provider_value.as_object_mut().expect("object inserted above");
    provider_config.insert("name".to_string(), Value::String(display_name.to_string()));
    provider_config.insert("kind".to_string(), Value::String("anthropic".to_string()));
    provider_config.insert("enabled".to_string(), Value::Bool(true));
    provider_config.insert("source".to_string(), Value::String("custom".to_string()));
    provider_config.insert("updatedAt".to_string(), Value::Number(now_ms().into()));
    provider_config.remove("systemDisabledReason");
    if !provider_config.get("models").is_some_and(Value::is_object) {
        provider_config.insert("models".to_string(), default_api_key_models());
    }
    let options = ensure_object(provider_config, "options");
    options.insert("apiKey".to_string(), Value::String(api_key.to_string()));
    options.insert("baseURL".to_string(), Value::String(base_url.to_string()));
    write_json_map_with_backup(path, &root)
}

fn write_auth_mode_to_settings_path(
    provider: &str,
    api_key_mode: bool,
    path: &Path,
) -> Result<(), String> {
    let provider = normalize_provider(provider)?;
    let mut root = read_json_map(path)?;
    root.insert(
        "providerFamilyDomain".to_string(),
        Value::String(provider.to_string()),
    );
    root.insert(
        "providerFamilyDomainUpdatedAt".to_string(),
        Value::Number(now_ms().into()),
    );
    root.insert("providerFamilyDomainMigrated".to_string(), Value::Bool(true));
    let family_modes = ensure_object(&mut root, "modelProviderFamilyModes");
    family_modes.insert(
        provider.to_string(),
        Value::String(if api_key_mode { "apiKey" } else { "oauth" }.to_string()),
    );
    write_json_map_with_backup(path, &root)
}

fn write_oauth_to_credentials_path(
    provider: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    zcode_jwt_token: &str,
    user_info: &Value,
    path: &Path,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let mut values = read_json_map(path)?;
    for provider in ["zai", "bigmodel"] {
        for suffix in ["access_token", "refresh_token", "user_info"] {
            values.remove(&format!("oauth:{}:{}", provider, suffix));
        }
    }
    let provider = normalize_provider(provider)?;
    let mut put = |key: String, value: &str| -> Result<(), String> {
        values.insert(key, Value::String(encrypt_credential(value, &home)?));
        Ok(())
    };
    put(ACTIVE_PROVIDER_KEY.to_string(), provider)?;
    put(
        format!("oauth:{}:access_token", provider),
        access_token,
    )?;
    if let Some(refresh) = normalize_text(refresh_token) {
        put(format!("oauth:{}:refresh_token", provider), &refresh)?;
    }
    put(
        format!("oauth:{}:user_info", provider),
        &serde_json::to_string(user_info)
            .map_err(|error| format!("Failed to serialize Zcode user info: {}", error))?,
    )?;
    put(ZCODE_JWT_KEY.to_string(), zcode_jwt_token)?;
    write_json_map_with_backup(path, &values)
}

#[tauri::command]
pub fn switch_zcode_account(_app: AppHandle, settings: Option<String>) -> Result<(), String> {
    let config = parse_settings(settings)?;
    let provider = normalize_provider(
        config
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("zai"),
    )?;
    let auth_mode = config
        .get("authMode")
        .and_then(Value::as_str)
        .unwrap_or("oauth")
        .to_string();

    if auth_mode == "api_key" {
        let api_key = config
            .get("apiKey")
            .or_else(|| config.get("accessToken"))
            .and_then(Value::as_str)
            .and_then(|value| normalize_text(Some(value)))
            .ok_or_else(|| "Zcode API-key account is missing its API key".to_string())?;
        write_api_key_to_config_path(provider, &api_key, &default_config_path()?)?;
        write_auth_mode_to_settings_path(provider, true, &default_settings_path()?)?;
    } else {
        let access_token = config
            .get("accessToken")
            .and_then(Value::as_str)
            .and_then(|value| normalize_text(Some(value)))
            .ok_or_else(|| "Zcode OAuth account is missing its access token".to_string())?;
        let zcode_jwt_token = config
            .get("zcodeJwtToken")
            .and_then(Value::as_str)
            .and_then(|value| normalize_text(Some(value)))
            .ok_or_else(|| "Zcode OAuth account is missing its JWT token".to_string())?;
        let refresh_token = config
            .get("refreshToken")
            .and_then(Value::as_str)
            .and_then(|value| normalize_text(Some(value)));
        let user_info = config.get("userInfo").cloned().unwrap_or_else(|| {
            json!({
                "email": config.get("email").and_then(Value::as_str),
                "name": config.get("name").and_then(Value::as_str),
            })
        });
        write_oauth_to_credentials_path(
            provider,
            &access_token,
            refresh_token.as_deref(),
            &zcode_jwt_token,
            &user_info,
            &default_credentials_path()?,
        )?;
        write_auth_mode_to_settings_path(provider, false, &default_settings_path()?)?;
    }

    log_info(&format!("[Zcode Switch] Injected {} account", provider));
    Ok(())
}


