use crate::utils::common::{write_atomic, write_atomic_bytes};
use crate::utils::logger::{log_error, log_info};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

/// Get Gemini config directory
fn get_gemini_config_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    Ok(home_dir.join(".gemini"))
}

/// Get Gemini .env file path
fn get_gemini_env_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_gemini_config_dir(app)?.join(".env"))
}

/// Get Gemini config.json file path
fn get_gemini_config_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_gemini_config_dir(app)?.join("config.json"))
}

/// Get Gemini settings.json file path
fn get_gemini_settings_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_gemini_config_dir(app)?.join("settings.json"))
}

/// Parse .env format text to HashMap
fn parse_env_text(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for line in text.lines() {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Parse KEY=VALUE
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            // Validate key (not empty, only alphanumeric and underscore)
            if !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_') {
                map.insert(key.to_string(), value.to_string());
            }
        }
    }

    map
}

/// Serialize HashMap to .env format
fn serialize_env_text(map: &HashMap<String, String>) -> String {
    let mut lines = Vec::new();

    // Sort keys for stable output
    let mut keys: Vec<_> = map.keys().collect();
    keys.sort();

    for key in keys {
        if let Some(value) = map.get(key) {
            lines.push(format!("{}={}", key, value));
        }
    }

    lines.join("\n")
}

/// Write Gemini .env file
fn write_gemini_env(app: &AppHandle, env: &Value) -> Result<(), String> {
    let env_path = get_gemini_env_path(app)?;

    // Ensure config directory exists
    if let Some(parent) = env_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create .gemini directory: {}", e))?;
            log_info(&format!("Created directory: {}", parent.display()));
        }
    }

    // Convert JSON object to HashMap
    let mut env_map = HashMap::new();
    if let Some(env_obj) = env.as_object() {
        for (key, value) in env_obj {
            if let Some(val_str) = value.as_str() {
                env_map.insert(key.clone(), val_str.to_string());
            }
        }
    }

    // Serialize to .env format
    let env_content = serialize_env_text(&env_map);

    // Write to file
    write_atomic(&env_path, &env_content).map_err(|e| format!("Failed to write .env: {}", e))?;

    log_info(&format!(
        "Successfully updated Gemini .env at: {}",
        env_path.display()
    ));
    Ok(())
}

/// Write Gemini config.json file
fn write_gemini_config_json(app: &AppHandle, config: &Value) -> Result<(), String> {
    let config_path = get_gemini_config_json_path(app)?;

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create .gemini directory: {}", e))?;
        }
    }

    // Write config to file
    let config_str = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config.json: {}", e))?;

    write_atomic(&config_path, &config_str)
        .map_err(|e| format!("Failed to write config.json: {}", e))?;

    log_info(&format!(
        "Successfully updated Gemini config.json at: {}",
        config_path.display()
    ));
    Ok(())
}

/// Write Gemini settings.json file
fn write_gemini_settings_json(app: &AppHandle, settings: &Value) -> Result<(), String> {
    let settings_path = get_gemini_settings_json_path(app)?;

    // Ensure config directory exists
    if let Some(parent) = settings_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create .gemini directory: {}", e))?;
        }
    }

    // Write settings to file
    let settings_str = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;

    write_atomic(&settings_path, &settings_str)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    log_info(&format!(
        "Successfully updated Gemini settings.json at: {}",
        settings_path.display()
    ));
    Ok(())
}

/// Atomic write: write .env, config.json, and settings.json, rollback on failure
fn write_gemini_config_atomic(
    app: &AppHandle,
    env: &Value,
    config: &Value,
    settings: &Value,
) -> Result<(), String> {
    let env_path = get_gemini_env_path(app)?;
    let config_path = get_gemini_config_json_path(app)?;
    let settings_path = get_gemini_settings_json_path(app)?;

    // Read old content for rollback
    let old_env = if env_path.exists() {
        Some(fs::read(&env_path).map_err(|e| format!("Failed to read old .env: {}", e))?)
    } else {
        None
    };
    let old_config = if config_path.exists() {
        Some(fs::read(&config_path).map_err(|e| format!("Failed to read old config.json: {}", e))?)
    } else {
        None
    };
    let old_settings = if settings_path.exists() {
        Some(
            fs::read(&settings_path)
                .map_err(|e| format!("Failed to read old settings.json: {}", e))?,
        )
    } else {
        None
    };

    // Step 1: Write .env
    if let Err(e) = write_gemini_env(app, env) {
        log_error(&format!("Failed to write .env: {}", e));
        return Err(e);
    }

    // Step 2: Write config.json (rollback .env on failure)
    if let Err(e) = write_gemini_config_json(app, config) {
        log_error(&format!(
            "Failed to write config.json: {}, rolling back .env",
            e
        ));

        // Rollback .env
        if let Some(bytes) = old_env {
            let _ = write_atomic_bytes(&env_path, &bytes);
        } else {
            let _ = fs::remove_file(&env_path);
        }

        return Err(e);
    }

    // Step 3: Write settings.json (rollback .env and config.json on failure)
    if let Err(e) = write_gemini_settings_json(app, settings) {
        log_error(&format!(
            "Failed to write settings.json: {}, rolling back .env and config.json",
            e
        ));

        // Rollback .env
        if let Some(bytes) = old_env {
            let _ = write_atomic_bytes(&env_path, &bytes);
        } else {
            let _ = fs::remove_file(&env_path);
        }

        // Rollback config.json
        if let Some(bytes) = old_config {
            let _ = write_atomic_bytes(&config_path, &bytes);
        } else {
            let _ = fs::remove_file(&config_path);
        }

        return Err(e);
    }

    // Success - clean up is not needed as we've successfully written all files
    let _ = old_env;
    let _ = old_config;
    let _ = old_settings;

    Ok(())
}

/// Switch Gemini account by updating config files with settings
#[tauri::command]
pub async fn switch_gemini_account(app: AppHandle, settings: Option<String>) -> Result<(), String> {
    log_info("Switching Gemini account...");

    // Parse settings JSON
    let settings_str = settings.ok_or_else(|| "Settings parameter is required".to_string())?;
    let settings_value: Value = serde_json::from_str(&settings_str)
        .map_err(|e| format!("Failed to parse settings JSON: {}", e))?;

    // Extract env, config, and settings objects
    let env = settings_value
        .get("env")
        .ok_or_else(|| "Missing 'env' object in settings".to_string())?;

    let config = settings_value
        .get("config")
        .ok_or_else(|| "Missing 'config' object in settings".to_string())?;

    let settings = settings_value
        .get("settings")
        .ok_or_else(|| "Missing 'settings' object in settings".to_string())?;

    log_info("Updating Gemini configuration files...");

    // Write all files atomically
    write_gemini_config_atomic(&app, env, config, settings)?;

    log_info("Gemini account switched successfully");
    Ok(())
}

/// Get current Gemini configuration
#[tauri::command]
pub async fn get_gemini_config(app: AppHandle) -> Result<Value, String> {
    let mut result = serde_json::Map::new();

    // Read .env
    let env_path = get_gemini_env_path(&app)?;
    if env_path.exists() {
        let content =
            fs::read_to_string(&env_path).map_err(|e| format!("Failed to read .env: {}", e))?;

        let env_map = parse_env_text(&content);

        // Convert HashMap to JSON object
        let mut env_obj = serde_json::Map::new();
        for (key, value) in env_map {
            env_obj.insert(key, json!(value));
        }

        result.insert("env".to_string(), Value::Object(env_obj));
    } else {
        result.insert("env".to_string(), json!({}));
    }

    // Read config.json
    let config_path = get_gemini_config_json_path(&app)?;
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.json: {}", e))?;

        let config: Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config.json: {}", e))?;

        result.insert("config".to_string(), config);
    } else {
        result.insert("config".to_string(), json!({}));
    }

    // Read settings.json
    let settings_path = get_gemini_settings_json_path(&app)?;
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;

        let settings: Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

        result.insert("settings".to_string(), settings);
    } else {
        result.insert("settings".to_string(), json!({}));
    }

    Ok(Value::Object(result))
}

/// Get Gemini platform version
pub fn get_gemini_version() -> Option<String> {
    use crate::utils::encoding::decode_console_output;
    use crate::utils::logger::{log_debug, log_info};
    use std::process::Command;

    log_debug("Checking Gemini version");

    // 尝试直接执行命令获取版本
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", "gemini --version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = {
        Command::new("sh")
            .arg("-c")
            .arg("gemini --version")
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = decode_console_output(&out.stdout).trim().to_string();
            let stderr = decode_console_output(&out.stderr).trim().to_string();

            log_info(&format!(
                "Gemini command executed - status: {}, stdout: '{}', stderr: '{}'",
                out.status, stdout, stderr
            ));

            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if !raw.is_empty() {
                    let version = extract_version(raw);
                    log_debug(&format!("Gemini version extracted: {}", version));
                    return Some(version);
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                log_info(&format!("Gemini command failed: {}", err));
            }
        }
        Err(e) => {
            log_info(&format!("Failed to execute gemini command: {}", e));
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
