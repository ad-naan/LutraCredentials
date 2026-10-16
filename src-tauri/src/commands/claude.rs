use crate::core::claude_oauth;
use crate::utils::logger::log_info;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::PathBuf;

/// Get Claude config file path
/// Can be overridden by CLAUDE_CONFIG_PATH environment variable
fn get_claude_config_path() -> Result<PathBuf, String> {
    // Check for environment variable override
    if let Ok(env_path) = env::var("CLAUDE_CONFIG_PATH") {
        log_info(&format!(
            "Using Claude config path from environment: {}",
            env_path
        ));
        return Ok(PathBuf::from(env_path));
    }

    // Default path
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let config_path = home_dir.join(".claude").join("settings.json");
    Ok(config_path)
}

/// Claude 配置目录（~/.claude 或 CLAUDE_CONFIG_PATH 所在目录）
fn get_claude_config_dir() -> Result<PathBuf, String> {
    let config_path = get_claude_config_path()?;
    Ok(config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or(config_path))
}

/// Atomic write helper
fn write_atomic(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| format!("write tmp failed: {}", e))?;
    fs::rename(tmp, path).map_err(|e| format!("rename failed: {}", e))?;
    Ok(())
}

/// Switch Claude account by updating environment variables and config file
#[tauri::command]
pub async fn switch_claude_account(settings: Option<String>) -> Result<(), String> {
    use crate::utils::logger::log_warn;

    log_info("Switching Claude account...");

    // Update Claude config file
    let config_path = get_claude_config_path()?;

    // Backfill: Read current config before overwriting (if exists)
    if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(current_content) => {
                log_info("Current config backed up (backfill logic can be implemented here)");
                // Note: In full implementation, you would save this to the current active account
                // before switching. For now, we just log it.
                let _ = current_content; // Suppress unused warning
            }
            Err(e) => {
                log_warn(&format!(
                    "Failed to read current config for backfill: {}",
                    e
                ));
            }
        }
    }

    // Ensure .claude directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
            log_info(&format!("Created directory: {}", parent.display()));
        }
    }

    // Parse settings from parameter
    let config: Value = if let Some(settings_str) = settings {
        serde_json::from_str(&settings_str)
            .map_err(|e| format!("Failed to parse settings JSON: {}", e))?
    } else {
        return Err("Settings parameter is required".to_string());
    };

    // Write config to file (atomic)
    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    write_atomic(&config_path, &config_str)?;

    log_info(&format!(
        "Successfully updated Claude config at: {}",
        config_path.display()
    ));

    Ok(())
}

/// Get current Claude configuration
#[tauri::command]
pub async fn get_claude_config() -> Result<Value, String> {
    let config_path = get_claude_config_path()?;

    if !config_path.exists() {
        return Ok(json!({}));
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let config: Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config)
}

/// Verify Claude API Key
#[tauri::command]
pub async fn verify_claude_api_key(api_key: String, base_url: String) -> Result<Value, String> {
    use crate::utils::logger::log_info;

    log_info("Verifying Claude API key...");

    let client = reqwest::Client::new();

    // 去掉结尾的 /
    let clean_base = base_url.trim_end_matches('/');

    // 拼接完整 URL
    let url = format!("{}/v1/messages", clean_base);

    let response = client
        .post(&url)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": "claude-3-haiku-20240307",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 10
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if status.is_success() {
        log_info("API key verification successful");
        Ok(json!({
            "valid": true,
            "message": "API key is valid"
        }))
    } else {
        log_info(&format!("API key verification failed: {}", status));

        let error_msg = if let Ok(error_json) = serde_json::from_str::<Value>(&body) {
            error_json["error"]["message"]
                .as_str()
                .unwrap_or("Invalid API key")
                .to_string()
        } else {
            "Invalid API key".to_string()
        };

        Ok(json!({
            "valid": false,
            "message": error_msg
        }))
    }
}

/// Get Claude platform version
pub fn get_claude_version() -> Option<String> {
    use crate::utils::logger::{log_debug, log_info};
    use std::process::Command;

    log_debug("Checking Claude version");

    // 尝试直接执行命令获取版本
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", "claude --version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = {
        Command::new("sh")
            .arg("-c")
            .arg("claude --version")
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

            log_info(&format!(
                "Claude command executed - status: {}, stdout: '{}', stderr: '{}'",
                out.status, stdout, stderr
            ));

            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if !raw.is_empty() {
                    let version = extract_version(raw);
                    log_debug(&format!("Claude version extracted: {}", version));
                    return Some(version);
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                log_info(&format!("Claude command failed: {}", err));
            }
        }
        Err(e) => {
            log_info(&format!("Failed to execute claude command: {}", e));
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

// =============================
// Claude 官方 OAuth（订阅账号）
// =============================

/// 生成 OAuth 授权链接（含 PKCE 会话信息）
#[tauri::command]
pub fn claude_oauth_start() -> claude_oauth::OAuthSession {
    log_info("[Claude OAuth] Authorization URL generated");
    claude_oauth::build_authorize_url()
}

/// 用授权码换取 token，并附带账号资料
#[tauri::command]
pub async fn claude_oauth_exchange(
    code: String,
    state: String,
    code_verifier: String,
) -> Result<Value, String> {
    let tokens = claude_oauth::exchange_code(code.trim(), &state, &code_verifier).await?;
    let profile = claude_oauth::fetch_profile(&tokens.access_token)
        .await
        .unwrap_or(claude_oauth::OAuthProfile {
            email: None,
            name: None,
            account_uuid: None,
        });

    log_info("[Claude OAuth] Login completed");

    Ok(json!({
        "tokens": tokens,
        "profile": profile,
    }))
}

/// 刷新 OAuth token
#[tauri::command]
pub async fn claude_oauth_refresh(refresh_token: String) -> Result<claude_oauth::OAuthTokens, String> {
    claude_oauth::refresh_tokens(refresh_token.trim()).await
}

/// 查询订阅用量（5 小时 / 7 天窗口）
#[tauri::command]
pub async fn claude_oauth_usage(access_token: String) -> Result<claude_oauth::OAuthUsage, String> {
    claude_oauth::fetch_usage(access_token.trim()).await
}

/// 切换到 OAuth 账号：写 .credentials.json 并清理 settings.json 的 API Key 环境变量
#[tauri::command]
pub async fn claude_oauth_switch(credentials: String) -> Result<(), String> {
    log_info("[Claude OAuth] Switching to OAuth account...");

    let tokens: claude_oauth::OAuthTokens = serde_json::from_str(&credentials)
        .map_err(|e| format!("Failed to parse OAuth credentials: {}", e))?;

    let config_dir = get_claude_config_dir()?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    // 1. 写入 .credentials.json
    let credentials_path = config_dir.join(".credentials.json");
    let credentials_str = serde_json::to_string_pretty(&claude_oauth::build_credentials_file(&tokens))
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    write_atomic(&credentials_path, &credentials_str)?;

    // 2. 清理 settings.json 中会覆盖 OAuth 的 env 变量
    let settings_path = get_claude_config_path()?;
    if settings_path.exists() {
        if let Ok(content) = fs::read_to_string(&settings_path) {
            if let Ok(mut settings) = serde_json::from_str::<Value>(&content) {
                claude_oauth::sanitize_settings_env(&mut settings);
                let sanitized = serde_json::to_string_pretty(&settings)
                    .map_err(|e| format!("Failed to serialize settings: {}", e))?;
                write_atomic(&settings_path, &sanitized)?;
            }
        }
    }

    log_info(&format!(
        "[Claude OAuth] Credentials written to {}",
        credentials_path.display()
    ));

    Ok(())
}
