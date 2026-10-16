use crate::core::{Account, Storage};
use std::sync::Mutex;
use tauri::{AppHandle, State};
pub mod antigravity;
pub mod buddy;
pub mod claude;
pub mod codex;
pub mod cursor;
pub mod gemini;
pub mod github_copilot;
pub mod grok;
pub mod import;
pub mod kiro;
pub mod machine;
pub mod provider;
pub mod qoder;
pub mod state_db;
pub mod trae;
pub mod updater;
pub mod windsurf;
pub mod zcode;
pub mod zed;

pub struct AppState {
    pub storage: Mutex<Storage>,
}

#[tauri::command]
pub fn get_accounts(_app: AppHandle, state: State<AppState>) -> Result<Vec<Account>, String> {
    let storage = state.storage.lock().unwrap();
    Ok(storage.accounts.clone())
}

#[tauri::command]
pub fn add_account(
    app: AppHandle,
    state: State<AppState>,
    account: Account,
) -> Result<Account, String> {
    use crate::utils::logger::log_info;

    log_info(&format!("[Storage] Adding account: {}", account.email));
    log_info(&format!(
        "[Storage] Platform data: {}",
        serde_json::to_string_pretty(&account.platform_data).unwrap_or_default()
    ));

    let mut storage = state.storage.lock().unwrap();
    storage.accounts.push(account.clone());
    storage.save(&app)?;

    log_info("[Storage] Account saved successfully");
    Ok(account)
}

#[tauri::command]
pub fn update_account(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    account: Account,
) -> Result<Account, String> {
    let mut storage = state.storage.lock().unwrap();

    if let Some(existing) = storage.accounts.iter_mut().find(|a| a.id == id) {
        *existing = account.clone();
        storage.save(&app)?;
        Ok(account)
    } else {
        Err("Account not found".to_string())
    }
}

#[tauri::command]
pub fn delete_account(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.accounts.retain(|a| a.id != id);
    storage.save(&app)?;
    Ok(())
}

#[tauri::command]
pub fn export_accounts(state: State<AppState>) -> Result<String, String> {
    let storage = state.storage.lock().unwrap();
    serde_json::to_string_pretty(&storage.accounts).map_err(|e| format!("Failed to export: {}", e))
}

#[tauri::command]
pub fn import_accounts(
    app: AppHandle,
    state: State<AppState>,
    json: String,
) -> Result<Vec<Account>, String> {
    let accounts: Vec<Account> =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse import data: {}", e))?;

    let mut storage = state.storage.lock().unwrap();
    storage.accounts.extend(accounts.clone());
    storage.save(&app)?;

    Ok(accounts)
}

/// Get log file path
#[tauri::command]
pub fn get_log_file_path() -> Result<String, String> {
    use crate::utils::logger::get_log_file_path;

    get_log_file_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Log file not initialized".to_string())
}
