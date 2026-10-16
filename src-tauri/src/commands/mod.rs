use crate::core::{Account, Storage};
use std::sync::Mutex;
use tauri::{AppHandle, State};
pub mod antigravity;
pub mod backup;
pub mod buddy;
pub mod claude;
pub mod codex;
pub mod cursor;
pub mod gemini;
pub mod github_copilot;
pub mod grok;
pub mod import;
pub mod kiro;
pub mod logs;
pub mod machine;
pub mod provider;
pub mod proxy_cmd;
pub mod qoder;
pub mod speedtest;
pub mod state_db;
pub mod trae;
pub mod updater;
pub mod usage;
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


