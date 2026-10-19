use crate::utils::common::write_atomic;
use crate::utils::logger::{log_error, log_info};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

fn get_codex_config_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    Ok(home_dir.join(".codex"))
}

fn get_codex_config_toml_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_codex_config_dir(app)?.join("config.toml"))
}

fn get_codex_auth_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_codex_config_dir(app)?.join("auth.json"))
}

/// Convert JSON config to TOML format
fn config_to_toml(config: &Value) -> Result<String, String> {
    let mut toml_lines = Vec::new();

    // Top-level fields
    if let Some(model_provider) = config.get("model_provider").and_then(|v| v.as_str()) {
        toml_lines.push(format!("model_provider = \"{}\"", model_provider));
    }
    if let Some(model) = config.get("model").and_then(|v| v.as_str()) {
        toml_lines.push(format!("model = \"{}\"", model));
    }
    if let Some(effort) = config
        .get("model_reasoning_effort")
        .and_then(|v| v.as_str())
    {
        toml_lines.push(format!("model_reasoning_effort = \"{}\"", effort));
    }
    if let Some(disable) = config
        .get("disable_response_storage")
        .and_then(|v| v.as_bool())
    {
        toml_lines.push(format!("disable_response_storage = {}", disable));
    }

    // model_providers section
    if let Some(providers) = config.get("model_providers").and_then(|v| v.as_object()) {
        for (key, provider) in providers {
            toml_lines.push(String::new()); // Empty line
            toml_lines.push(format!("[model_providers.{}]", key));

            if let Some(provider_obj) = provider.as_object() {
                if let Some(name) = provider_obj.get("name").and_then(|v| v.as_str()) {
                    toml_lines.push(format!("name = \"{}\"", name));
                }
                if let Some(base_url) = provider_obj.get("base_url").and_then(|v| v.as_str()) {
                    toml_lines.push(format!("base_url = \"{}\"", base_url));
                }
                if let Some(wire_api) = provider_obj.get("wire_api").and_then(|v| v.as_str()) {
                    toml_lines.push(format!("wire_api = \"{}\"", wire_api));
                }
                if let Some(requires_auth) = provider_obj
                    .get("requires_openai_auth")
                    .and_then(|v| v.as_bool())
                {
                    toml_lines.push(format!("requires_openai_auth = {}", requires_auth));
                }
            }
        }
    }

    Ok(toml_lines.join("\n"))
}

/// Write Codex config.toml file
fn write_config_toml(app: &AppHandle, config: &Value) -> Result<(), String> {
    let config_path = get_codex_config_toml_path(app)?;

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
            log_info(&format!("Created directory: {}", parent.display()));
        }
    }

    // Convert config to TOML
    let toml_content = config_to_toml(config)?;

    // Write config to file
    write_atomic(&config_path, &toml_content)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log_info(&format!(
        "Successfully updated Codex config.toml at: {}",
        config_path.display()
    ));
    Ok(())
}

/// Write Codex auth.json file
fn write_auth_json(app: &AppHandle, auth: &Value) -> Result<(), String> {
    let auth_path = get_codex_auth_json_path(app)?;

    // Ensure config directory exists
    if let Some(parent) = auth_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
    }

    // Write auth to file
    let auth_str = serde_json::to_string_pretty(auth)
        .map_err(|e| format!("Failed to serialize auth.json: {}", e))?;

    write_atomic(&auth_path, &auth_str).map_err(|e| format!("Failed to write auth.json: {}", e))?;

    log_info(&format!(
        "Successfully updated Codex auth.json at: {}",
        auth_path.display()
    ));
    Ok(())
}

/// Atomic write: write both auth.json and config.toml, rollback on failure
fn write_codex_config_atomic(app: &AppHandle, auth: &Value, config: &Value) -> Result<(), String> {
    let auth_path = get_codex_auth_json_path(app)?;
    let config_path = get_codex_config_toml_path(app)?;

    // Read old content for rollback
    let old_auth = if auth_path.exists() {
        Some(fs::read(&auth_path).map_err(|e| format!("Failed to read old auth.json: {}", e))?)
    } else {
        None
    };
    let old_config = if config_path.exists() {
        Some(fs::read(&config_path).map_err(|e| format!("Failed to read old config.toml: {}", e))?)
    } else {
        None
    };

    // Step 1: Write auth.json
    if let Err(e) = write_auth_json(app, auth) {
        log_error(&format!("Failed to write auth.json: {}", e));
        return Err(e);
    }

    // Step 2: Write config.toml (rollback auth.json on failure)
    if let Err(e) = write_config_toml(app, config) {
        log_error(&format!(
            "Failed to write config.toml: {}, rolling back auth.json",
            e
        ));

        // Rollback auth.json
        if let Some(bytes) = old_auth {
            let _ = crate::utils::common::write_atomic_bytes(&auth_path, &bytes);
        } else {
            let _ = fs::remove_file(&auth_path);
        }

        return Err(e);
    }

    // Success - clean up is not needed as we've successfully written both files
    let _ = old_auth;
    let _ = old_config;

    Ok(())
}

/// Switch Codex account by updating active status and config files
#[tauri::command]
pub async fn switch_codex_account(app: AppHandle, settings: Option<String>) -> Result<(), String> {
    log_info("Switching Codex account...");

    // Parse settings JSON
    let settings_str = settings.ok_or_else(|| "Settings parameter is required".to_string())?;
    let settings_value: Value = serde_json::from_str(&settings_str)
        .map_err(|e| format!("Failed to parse settings JSON: {}", e))?;

    // Extract auth and config objects
    let auth = settings_value
        .get("auth")
        .ok_or_else(|| "Missing 'auth' object in settings".to_string())?;

    let config = settings_value
        .get("config")
        .ok_or_else(|| "Missing 'config' object in settings".to_string())?;

    log_info("Updating Codex configuration files...");

    // Write both files atomically
    write_codex_config_atomic(&app, auth, config)?;

    log_info("Codex account switched successfully");
    Ok(())
}

// =============================
// Codex 官方 OAuth（ChatGPT 订阅账号）
// =============================

/// 启动设备授权，返回 user_code 与验证页链接
#[tauri::command]
pub async fn codex_oauth_start() -> Result<crate::core::codex_oauth::DeviceAuthSession, String> {
    let session = crate::core::codex_oauth::start_device_auth().await?;
    log_info("[Codex OAuth] Device authorization started");
    Ok(session)
}

/// 轮询设备授权状态（前端按 interval 调用）
#[tauri::command]
pub async fn codex_oauth_poll(
    device_auth_id: String,
    user_code: String,
) -> Result<crate::core::codex_oauth::DevicePollStatus, String> {
    crate::core::codex_oauth::poll_device_token(&device_auth_id, &user_code).await
}

/// 用授权码完成登录
#[tauri::command]
pub async fn codex_oauth_complete(
    authorization_code: String,
    code_verifier: String,
) -> Result<crate::core::codex_oauth::OAuthTokens, String> {
    crate::core::codex_oauth::exchange_code(authorization_code.trim(), code_verifier.trim()).await
}

/// 刷新 OAuth token
#[tauri::command]
pub async fn codex_oauth_refresh(
    refresh_token: String,
    id_token: Option<String>,
) -> Result<crate::core::codex_oauth::OAuthTokens, String> {
    crate::core::codex_oauth::refresh_tokens(refresh_token.trim(), id_token.as_deref()).await
}

/// 查询账号订阅状态
#[tauri::command]
pub async fn codex_check_quota(
    access_token: String,
    account_id: Option<String>,
) -> Result<crate::core::codex_oauth::AccountCheck, String> {
    crate::core::codex_oauth::check_account(access_token.trim(), account_id.as_deref()).await
}

/// 切换到 OAuth 账号：以托管格式写 auth.json（不改动 config.toml）
#[tauri::command]
pub async fn codex_oauth_switch(app: AppHandle, credentials: String) -> Result<(), String> {
    log_info("[Codex OAuth] Switching to OAuth account...");

    let tokens: crate::core::codex_oauth::OAuthTokens = serde_json::from_str(&credentials)
        .map_err(|e| format!("Failed to parse OAuth credentials: {}", e))?;

    let auth = crate::core::codex_oauth::build_managed_auth_json(&tokens);
    write_auth_json(&app, &auth)?;

    log_info("[Codex OAuth] auth.json written (managed chatgpt mode)");
    Ok(())
}

/// Get current Codex configuration
#[tauri::command]
pub async fn get_codex_config(app: AppHandle) -> Result<Value, String> {
    let mut result = serde_json::Map::new();

    // Read auth.json
    let auth_path = get_codex_auth_json_path(&app)?;
    if auth_path.exists() {
        let content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("Failed to read auth.json: {}", e))?;

        let auth: Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse auth.json: {}", e))?;

        result.insert("auth".to_string(), auth);
    } else {
        result.insert("auth".to_string(), json!({}));
    }

    // Read config.toml
    let config_path = get_codex_config_toml_path(&app)?;
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?;

        // Parse TOML to JSON
        let config_toml: toml::Value =
            toml::from_str(&content).map_err(|e| format!("Failed to parse config.toml: {}", e))?;

        let config_json = serde_json::to_value(config_toml)
            .map_err(|e| format!("Failed to convert TOML to JSON: {}", e))?;

        result.insert("config".to_string(), config_json);
    } else {
        result.insert("config".to_string(), json!({}));
    }

    Ok(Value::Object(result))
}

/// Get Codex platform version
pub fn get_codex_version() -> Option<String> {
    use crate::utils::encoding::decode_console_output;
    use crate::utils::logger::{log_debug, log_info};
    use std::process::Command;

    log_debug("Checking Codex version");

    // 尝试直接执行命令获取版本
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", "codex --version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = { Command::new("sh").arg("-c").arg("codex --version").output() };

    match output {
        Ok(out) => {
            let stdout = decode_console_output(&out.stdout).trim().to_string();
            let stderr = decode_console_output(&out.stderr).trim().to_string();

            log_info(&format!(
                "Codex command executed - status: {}, stdout: '{}', stderr: '{}'",
                out.status, stdout, stderr
            ));

            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if !raw.is_empty() {
                    let version = extract_version(raw);
                    log_debug(&format!("Codex version extracted: {}", version));
                    return Some(version);
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                log_info(&format!("Codex command failed: {}", err));
            }
        }
        Err(e) => {
            log_info(&format!("Failed to execute codex command: {}", e));
        }
    }

    None
}

/// 从版本输出中提取纯版本号
fn extract_version(raw: &str) -> String {
    use once_cell::sync::Lazy;
    use regex::Regex;

    static VERSION_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\d+\.\d+\.\d+(-[\w.]+)?").expect("Invalid version regex"));

    VERSION_RE
        .find(raw)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| raw.to_string())
}
