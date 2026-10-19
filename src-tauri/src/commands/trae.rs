use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub const TRAE_STORAGE_PATH_CONFIG_KEY: &str = "trae_storage_path";

const TRAE_DEFAULT_AUTH_PROVIDER_ID: &str = "icube.cloudide";
const TRAE_STORAGE_AUTH_KEY_PREFIX: &str = "iCubeAuthInfo://";
const TRAE_STORAGE_SERVER_KEY_PREFIX: &str = "iCubeServerData://";
const TRAE_STORAGE_ENTITLEMENT_KEY_PREFIX: &str = "iCubeEntitlementInfo://";
const TRAE_STORAGE_AUTH_KEY: &str = "iCubeAuthInfo://icube.cloudide";
const TRAE_STORAGE_SERVER_KEY: &str = "iCubeServerData://icube.cloudide";
const TRAE_STORAGE_ENTITLEMENT_KEY: &str = "iCubeEntitlementInfo://icube.cloudide";
const TRAE_STORAGE_USERTAG_KEY: &str = "iCubeAuthInfo://usertag";

pub fn detect_trae_storage_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "APPDATA environment variable not found".to_string())?;
        return Ok(PathBuf::from(appdata)
            .join("Trae")
            .join("User")
            .join("globalStorage")
            .join("storage.json"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
        return Ok(home
            .join("Library")
            .join("Application Support")
            .join("Trae")
            .join("User")
            .join("globalStorage")
            .join("storage.json"));
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
        return Ok(home
            .join(".config")
            .join("Trae")
            .join("User")
            .join("globalStorage")
            .join("storage.json"));
    }

    #[allow(unreachable_code)]
    Err("Trae is not supported on this platform".to_string())
}

fn resolve_trae_storage_path() -> Result<PathBuf, String> {
    if let Some(configured_path) = crate::utils::config::get_config_string(TRAE_STORAGE_PATH_CONFIG_KEY)? {
        return Ok(PathBuf::from(configured_path));
    }

    detect_trae_storage_path()
}

fn parse_value_or_json_string(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    if value.is_object() || value.is_array() {
        return Some(value.clone());
    }

    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
}

fn storage_object_value(root: &Value, key: &str) -> Option<Value> {
    root.as_object()
        .and_then(|obj| parse_value_or_json_string(obj.get(key)))
}

fn extract_json_value(root: Option<&Value>, path: &[&str]) -> Option<Value> {
    let mut current = root?;
    for key in path {
        current = current.as_object()?.get(*key)?;
    }
    Some(current.clone())
}

fn pick_string(root: Option<&Value>, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(value) = extract_json_value(root, path) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            if let Some(number) = value.as_i64() {
                return Some(number.to_string());
            }
        }
    }
    None
}

fn pick_i64(root: Option<&Value>, paths: &[&[&str]]) -> Option<i64> {
    for path in paths {
        if let Some(value) = extract_json_value(root, path) {
            if let Some(number) = value.as_i64() {
                return Some(number);
            }
            if let Some(number) = value.as_u64() {
                if let Ok(parsed) = i64::try_from(number) {
                    return Some(parsed);
                }
            }
            if let Some(text) = value.as_str() {
                if let Ok(parsed) = text.trim().parse::<i64>() {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

fn normalize_email(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.contains('@'))
        .map(|text| text.to_lowercase())
}

fn build_auth_storage_key(provider_id: &str) -> String {
    format!("{}{}", TRAE_STORAGE_AUTH_KEY_PREFIX, provider_id)
}

fn build_server_storage_key(provider_id: &str) -> String {
    format!("{}{}", TRAE_STORAGE_SERVER_KEY_PREFIX, provider_id)
}

fn build_entitlement_storage_key(provider_id: &str) -> String {
    format!("{}{}", TRAE_STORAGE_ENTITLEMENT_KEY_PREFIX, provider_id)
}

fn provider_id_from_storage_key(key: &str, prefix: &str) -> Option<String> {
    key.strip_prefix(prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_storage_provider_id(root_obj: &Map<String, Value>) -> String {
    for key in root_obj.keys() {
        if let Some(provider_id) = provider_id_from_storage_key(key, TRAE_STORAGE_AUTH_KEY_PREFIX) {
            return provider_id;
        }
    }

    TRAE_DEFAULT_AUTH_PROVIDER_ID.to_string()
}

fn read_storage_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Err(format!("Trae storage file not found: {}", path.display()));
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read Trae storage '{}': {}", path.display(), error))?;

    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }

    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse Trae storage '{}': {}", path.display(), error))
}

fn write_storage_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create Trae storage directory: {}", error))?;
    }

    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize Trae storage: {}", error))?;

    crate::utils::common::write_atomic(path, &content)
        .map_err(|error| format!("Failed to write Trae storage '{}': {}", path.display(), error))
}

fn to_json_string_value(value: &Value) -> Result<Value, String> {
    serde_json::to_string(value)
        .map(Value::String)
        .map_err(|error| format!("Failed to serialize Trae storage entry: {}", error))
}

fn payload_from_storage_root(storage_root: &Value) -> Result<Value, String> {
    let root_obj = storage_root.as_object();
    let provider_id = root_obj
        .map(resolve_storage_provider_id)
        .unwrap_or_else(|| TRAE_DEFAULT_AUTH_PROVIDER_ID.to_string());

    let auth_storage_key = build_auth_storage_key(&provider_id);
    let server_storage_key = build_server_storage_key(&provider_id);
    let entitlement_storage_key = build_entitlement_storage_key(&provider_id);

    let auth_raw = storage_object_value(storage_root, &auth_storage_key)
        .or_else(|| storage_object_value(storage_root, TRAE_STORAGE_AUTH_KEY));
    let server_raw = storage_object_value(storage_root, &server_storage_key)
        .or_else(|| storage_object_value(storage_root, TRAE_STORAGE_SERVER_KEY));
    let entitlement_raw = storage_object_value(storage_root, &entitlement_storage_key)
        .or_else(|| storage_object_value(storage_root, TRAE_STORAGE_ENTITLEMENT_KEY));
    let usertag_raw = root_obj.and_then(|obj| obj.get(TRAE_STORAGE_USERTAG_KEY).cloned());

    let access_token = pick_string(
        auth_raw.as_ref(),
        &[
            &["accessToken"],
            &["access_token"],
            &["token"],
            &["data", "accessToken"],
            &["auth", "accessToken"],
        ],
    )
    .or_else(|| {
        pick_string(
            server_raw.as_ref(),
            &[&["accessToken"], &["access_token"], &["token"], &["data", "accessToken"]],
        )
    })
    .ok_or_else(|| "No Trae access token found in local storage".to_string())?;

    let refresh_token = pick_string(
        auth_raw.as_ref(),
        &[
            &["refreshToken"],
            &["refresh_token"],
            &["RefreshToken"],
            &["exchangeResponse", "Result", "RefreshToken"],
        ],
    );

    let email = normalize_email(
        pick_string(
            auth_raw.as_ref(),
            &[
                &["email"],
                &["account", "email"],
                &["account", "nonPlainTextEmail"],
                &["NonPlainTextEmail"],
                &["data", "email"],
            ],
        )
        .as_deref(),
    )
    .or_else(|| {
        normalize_email(
            pick_string(server_raw.as_ref(), &[&["email"], &["data", "email"]]).as_deref(),
        )
    })
    .unwrap_or_else(|| "trae-local".to_string());

    let user_id = pick_string(
        auth_raw.as_ref(),
        &[
            &["userId"],
            &["user_id"],
            &["uid"],
            &["id"],
            &["data", "userId"],
        ],
    )
    .or_else(|| pick_string(server_raw.as_ref(), &[&["userId"], &["uid"], &["id"]]));

    let nickname = pick_string(
        auth_raw.as_ref(),
        &[
            &["nickname"],
            &["name"],
            &["displayName"],
            &["account", "username"],
            &["data", "nickname"],
        ],
    )
    .or_else(|| pick_string(server_raw.as_ref(), &[&["nickname"], &["name"], &["displayName"]]));

    let token_type = pick_string(
        auth_raw.as_ref(),
        &[&["tokenType"], &["token_type"], &["TokenType"]],
    );
    let expires_at = pick_i64(
        auth_raw.as_ref(),
        &[
            &["expiresAt"],
            &["expiredAt"],
            &["expires_at"],
            &["TokenExpireAt"],
            &["exchangeResponse", "Result", "TokenExpireAt"],
        ],
    );
    let provider = pick_string(
        entitlement_raw.as_ref(),
        &[
            &["identityStr"],
            &["identity_str"],
            &["user_pay_identity_str"],
            &["data", "user_pay_identity_str"],
        ],
    )
    .unwrap_or_else(|| "Trae".to_string());

    let mut result = Map::new();
    result.insert("email".to_string(), json!(email));
    result.insert(
        "name".to_string(),
        json!(nickname.clone().unwrap_or_else(|| "Trae".to_string())),
    );
    result.insert("providerId".to_string(), json!(provider));
    result.insert("accessToken".to_string(), json!(access_token));
    result.insert("source".to_string(), json!("local"));
    result.insert(
        "localPath".to_string(),
        json!(resolve_trae_storage_path()?.to_string_lossy().to_string()),
    );

    if let Some(value) = refresh_token {
        result.insert("refreshToken".to_string(), json!(value));
    }
    if let Some(value) = token_type {
        result.insert("tokenType".to_string(), json!(value));
    }
    if let Some(value) = expires_at {
        result.insert("expiresAt".to_string(), json!(value));
    }
    if let Some(value) = user_id {
        result.insert("userId".to_string(), json!(value));
    }
    if let Some(value) = nickname {
        result.insert("nickname".to_string(), json!(value));
    }
    if let Some(value) = auth_raw {
        result.insert("traeAuthRaw".to_string(), value);
    }
    if let Some(value) = server_raw {
        result.insert("traeServerRaw".to_string(), value);
    }
    if let Some(value) = entitlement_raw {
        result.insert("traeEntitlementRaw".to_string(), value);
    }
    if let Some(value) = usertag_raw {
        result.insert("traeUserTagRaw".to_string(), value);
    }

    Ok(Value::Object(result))
}

fn resolve_storage_keys_for_inject(root_obj: &Map<String, Value>) -> (String, String, String) {
    let provider_id = resolve_storage_provider_id(root_obj);
    (
        build_auth_storage_key(&provider_id),
        build_server_storage_key(&provider_id),
        build_entitlement_storage_key(&provider_id),
    )
}

fn fallback_auth_raw(settings: &Value) -> Value {
    json!({
        "accessToken": settings.get("accessToken").and_then(Value::as_str).unwrap_or_default(),
        "refreshToken": settings.get("refreshToken").and_then(Value::as_str).unwrap_or_default(),
        "tokenType": settings.get("tokenType").and_then(Value::as_str).unwrap_or("Bearer"),
        "email": settings.get("email").and_then(Value::as_str).unwrap_or_default(),
        "userId": settings.get("userId").and_then(Value::as_str).unwrap_or_default(),
        "nickname": settings
            .get("nickname")
            .and_then(Value::as_str)
            .or_else(|| settings.get("name").and_then(Value::as_str))
            .unwrap_or_default(),
        "account": {
            "email": settings.get("email").and_then(Value::as_str).unwrap_or_default(),
            "username": settings
                .get("nickname")
                .and_then(Value::as_str)
                .or_else(|| settings.get("name").and_then(Value::as_str))
                .unwrap_or_default(),
        }
    })
}

fn fallback_entitlement_raw(settings: &Value) -> Value {
    json!({
        "identityStr": settings.get("providerId").and_then(Value::as_str).unwrap_or("Trae")
    })
}

#[tauri::command]
pub async fn trae_import_from_local(_app: AppHandle) -> Result<Value, String> {
    let storage_path = resolve_trae_storage_path()?;
    let storage_root = read_storage_json(&storage_path)?;
    payload_from_storage_root(&storage_root)
}

#[tauri::command]
pub async fn switch_trae_account(
    _app: AppHandle,
    settings: Option<String>,
) -> Result<(), String> {
    let settings_str = settings.ok_or_else(|| "Settings parameter is required".to_string())?;
    let settings_value: Value = serde_json::from_str(&settings_str)
        .map_err(|error| format!("Failed to parse settings JSON: {}", error))?;

    let storage_path = resolve_trae_storage_path()?;
    let mut root = if storage_path.exists() {
        read_storage_json(&storage_path)?
    } else {
        Value::Object(Map::new())
    };

    if !root.is_object() {
        root = Value::Object(Map::new());
    }

    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| "Invalid Trae storage root".to_string())?;
    let (auth_storage_key, server_storage_key, entitlement_storage_key) =
        resolve_storage_keys_for_inject(root_obj);

    let auth_raw = settings_value
        .get("traeAuthRaw")
        .cloned()
        .unwrap_or_else(|| fallback_auth_raw(&settings_value));
    let entitlement_raw = settings_value
        .get("traeEntitlementRaw")
        .cloned()
        .unwrap_or_else(|| fallback_entitlement_raw(&settings_value));

    root_obj.insert(auth_storage_key, to_json_string_value(&auth_raw)?);
    root_obj.insert(entitlement_storage_key, to_json_string_value(&entitlement_raw)?);

    if let Some(server_raw) = settings_value.get("traeServerRaw") {
        root_obj.insert(server_storage_key, to_json_string_value(server_raw)?);
    }
    if let Some(usertag_raw) = settings_value.get("traeUserTagRaw") {
        root_obj.insert(TRAE_STORAGE_USERTAG_KEY.to_string(), usertag_raw.clone());
    }

    write_storage_json(&storage_path, &root)
}
