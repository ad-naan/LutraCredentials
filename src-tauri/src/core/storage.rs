use serde::{Deserialize, Serialize};

use crate::utils::common::write_atomic;
use crate::utils::logger::{log_debug, log_info};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{sleep, Duration};

// 防抖保存状态
struct DebounceSaveState {
    pending: bool,
    last_save_time: std::time::Instant,
}

impl DebounceSaveState {
    fn new() -> Self {
        Self {
            pending: false,
            last_save_time: std::time::Instant::now(),
        }
    }
}

// 全局防抖状态
static DEBOUNCE_STATE: once_cell::sync::Lazy<Arc<TokioMutex<DebounceSaveState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(TokioMutex::new(DebounceSaveState::new())));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub platform: String,
    pub name: Option<String>,
    pub email: String,
    pub avatar: Option<String>,
    pub is_active: bool,
    pub last_used_at: i64,
    pub created_at: i64,
    pub platform_data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Storage {
    pub accounts: Vec<Account>,
    pub machine_id: Option<String>,
    pub account_machine_bindings: std::collections::HashMap<String, String>,
}

impl Storage {
    pub fn new() -> Self {
        Self {
            accounts: Vec::new(),
            machine_id: None,
            account_machine_bindings: std::collections::HashMap::new(),
        }
    }

    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = get_storage_path(app)?;

        if !path.exists() {
            log_info(&format!(
                "Storage file not found, creating new: {}",
                path.display()
            ));
            return Ok(Self::new());
        }

        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read storage: {}", e))?;

        let storage: Storage = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse storage: {}", e))?;

        log_info(&format!(
            "Loaded {} accounts from {}",
            storage.accounts.len(),
            path.display()
        ));
        Ok(storage)
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = get_storage_path(app)?;

        // Ensure directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize storage: {}", e))?;

        write_atomic(&path, &content).map_err(|e| format!("Failed to write storage: {}", e))?;

        log_info(&format!(
            "Saved {} accounts to {}",
            self.accounts.len(),
            path.display()
        ));
        Ok(())
    }

    /// 防抖保存 - 300ms 内的多次修改只触发一次写入
    ///
    /// 使用场景：批量操作、频繁更新
    #[allow(dead_code)]
    pub async fn save_debounced(&self, app: AppHandle) -> Result<(), String> {
        const DEBOUNCE_MS: u64 = 300;

        let state = DEBOUNCE_STATE.clone();
        let storage_clone = self.clone();

        // 标记有待保存的更改
        {
            let mut guard = state.lock().await;
            guard.pending = true;
            log_debug("Storage save debounced - waiting...");
        }

        // 等待防抖时间
        sleep(Duration::from_millis(DEBOUNCE_MS)).await;

        // 检查是否仍需保存
        let should_save = {
            let mut guard = state.lock().await;
            if guard.pending {
                guard.pending = false;
                guard.last_save_time = std::time::Instant::now();
                true
            } else {
                false
            }
        };

        if should_save {
            log_debug("Executing debounced save");
            storage_clone.save(&app)?;
        }

        Ok(())
    }
}

// Global configuration state for custom path
pub struct StorageConfig {
    pub custom_path: std::sync::Mutex<Option<PathBuf>>,
}

/// 获取配置文件路径
fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_dir.join("config.json"))
}

/// 从配置文件加载自定义路径
fn load_custom_path_from_config(app: &AppHandle) -> Option<PathBuf> {
    let config_path = get_config_path(app).ok()?;

    if !config_path.exists() {
        return None;
    }

    let content = fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;

    config
        .get("storage_path")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
}

/// 保存自定义路径到配置文件
fn save_custom_path_to_config(app: &AppHandle, path: Option<&PathBuf>) -> Result<(), String> {
    let config_path = get_config_path(app)?;

    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let mut config = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(path) = path {
        config["storage_path"] = serde_json::json!(path.to_string_lossy().to_string());
    } else {
        // Remove storage_path key if path is None
        if let Some(obj) = config.as_object_mut() {
            obj.remove("storage_path");
        }
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    write_atomic(&config_path, &content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn get_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Check if custom path is set in state
    if let Some(state) = app.try_state::<StorageConfig>() {
        if let Ok(custom_path) = state.custom_path.lock() {
            if let Some(path) = &*custom_path {
                return Ok(path.clone());
            }
        }
    }

    // Try to load from config file
    if let Some(path) = load_custom_path_from_config(app) {
        // Update state with loaded path
        if let Some(state) = app.try_state::<StorageConfig>() {
            if let Ok(mut custom_path) = state.custom_path.lock() {
                *custom_path = Some(path.clone());
            }
        }
        return Ok(path);
    }

    // Default path
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_dir.join("accounts.json"))
}

#[tauri::command]
pub fn set_storage_path(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, StorageConfig>,
) -> Result<(), String> {
    let path_buf = if path.is_empty() {
        // Empty path means reset to default
        None
    } else {
        let pb = PathBuf::from(&path);

        // Validate path
        if let Some(parent) = pb.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
        }

        Some(pb)
    };

    // Save to config file first
    save_custom_path_to_config(&app, path_buf.as_ref())?;

    // Update state (释放锁在这个作用域结束时)
    {
        let mut custom_path = state.custom_path.lock().map_err(|e| e.to_string())?;
        *custom_path = path_buf.clone();
    } // 锁在这里被释放

    // Save current storage to new location (现在可以安全调用 save，因为锁已释放)
    if let Some(app_state) = app.try_state::<crate::commands::AppState>() {
        let storage = app_state.storage.lock().map_err(|e| e.to_string())?;
        storage.save(&app)?;
    }

    log_info(&format!("Storage path updated to: {:?}", path_buf));
    Ok(())
}

#[tauri::command]
pub fn get_current_storage_path(app: AppHandle) -> Result<String, String> {
    let path = get_storage_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// 当前生效的存储文件路径（供备份 / 回滚等场景复用）
pub fn current_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    get_storage_path(app)
}

#[tauri::command]
pub async fn select_storage_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .set_title("Select Storage Directory")
        .blocking_pick_folder();

    if let Some(folder_path) = result {
        // FilePath 需要转换为 PathBuf
        let folder_path_buf = PathBuf::from(folder_path.as_path().ok_or("Invalid path")?);
        let storage_path = folder_path_buf.join("accounts.json");
        Ok(Some(storage_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}
