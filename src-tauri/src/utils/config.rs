//! 应用配置管理
//!
//! 管理应用级别的配置，如 Antigravity 可执行文件路径和启动参数
//! 配置文件保存在与账户数据相同的目录：{storage_dir}/config.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 应用配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// Antigravity 可执行文件路径（自动检测或用户手动配置）
    pub antigravity_executable: Option<String>,

    /// Antigravity 启动参数（可选）
    pub antigravity_args: Option<Vec<String>>,
}

impl AppConfig {
    /// 创建新的配置实例
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::default()
    }
}

/// 获取配置文件路径
/// 从 accounts.json 的目录获取配置文件路径
fn get_config_path() -> Result<PathBuf, String> {
    // 读取 storage.rs 中保存的账户数据路径
    // 账户数据路径格式：{storage_dir}/accounts.json
    // 配置文件路径格式：{storage_dir}/config.json

    let accounts_path = if cfg!(debug_assertions) {
        // 开发模式：使用项目根目录下的 config 文件夹
        let current = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;

        // 如果当前目录是 src-tauri，回到上一级
        let root = if current.ends_with("src-tauri") {
            current
                .parent()
                .ok_or("Failed to get parent directory")?
                .to_path_buf()
        } else {
            current
        };

        root.join("config").join("accounts.json")
    } else {
        // 生产模式：使用系统应用数据目录
        #[cfg(target_os = "windows")]
        let data_dir = dirs::data_dir();

        #[cfg(not(target_os = "windows"))]
        let data_dir = dirs::data_dir();

        data_dir
            .ok_or("Failed to get data directory")?
            .join(env!("CARGO_PKG_NAME"))
            .join("accounts.json")
    };

    // 获取账户数据所在的目录
    let storage_dir = accounts_path
        .parent()
        .ok_or("Failed to get storage directory")?;

    // 确保目录存在
    if !storage_dir.exists() {
        fs::create_dir_all(&storage_dir)
            .map_err(|e| format!("Failed to create storage directory: {}", e))?;
    }

    let config_path = storage_dir.join("config.json");

    // 添加日志输出配置文件路径
    use crate::utils::logger::log_info;
    log_info(&format!("Config file path: {}", config_path.display()));

    Ok(config_path)
}

/// 加载完整配置文件
fn load_full_config() -> Result<serde_json::Value, String> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
}

/// 保存完整配置文件
fn save_full_config(config: &serde_json::Value) -> Result<(), String> {
    let config_path = get_config_path()?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    crate::utils::common::write_atomic(&config_path, &content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(())
}

/// 加载应用配置
pub fn load_app_config() -> Result<AppConfig, String> {
    let full_config = load_full_config()?;

    // 从完整配置中提取 Antigravity 配置
    let antigravity_executable = full_config
        .get("antigravity_executable")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let antigravity_args = full_config
        .get("antigravity_args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });

    Ok(AppConfig {
        antigravity_executable,
        antigravity_args,
    })
}

/// 保存应用配置
pub fn save_app_config(config: &AppConfig) -> Result<(), String> {
    let mut full_config = load_full_config()?;

    // 更新 Antigravity 配置
    if let Some(ref path) = config.antigravity_executable {
        full_config["antigravity_executable"] = serde_json::json!(path);
    } else {
        if let Some(obj) = full_config.as_object_mut() {
            obj.remove("antigravity_executable");
        }
    }

    if let Some(ref args) = config.antigravity_args {
        full_config["antigravity_args"] = serde_json::json!(args);
    } else {
        if let Some(obj) = full_config.as_object_mut() {
            obj.remove("antigravity_args");
        }
    }

    save_full_config(&full_config)
}

pub fn get_config_string(key: &str) -> Result<Option<String>, String> {
    let full_config = load_full_config()?;
    Ok(full_config
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string()))
}

pub fn set_config_string(key: &str, value: Option<String>) -> Result<(), String> {
    let mut full_config = load_full_config()?;

    if let Some(current) = value.filter(|current| !current.trim().is_empty()) {
        full_config[key] = serde_json::json!(current);
    } else if let Some(object) = full_config.as_object_mut() {
        object.remove(key);
    }

    save_full_config(&full_config)
}

/// 更新 Antigravity 可执行文件路径
pub fn update_antigravity_path(path: String) -> Result<(), String> {
    set_config_string("antigravity_executable", Some(path))
}

/// 更新 Antigravity 启动参数
#[allow(dead_code)]
pub fn update_antigravity_args(args: Vec<String>) -> Result<(), String> {
    let mut config = load_app_config()?;
    config.antigravity_args = Some(args);
    save_app_config(&config)
}
