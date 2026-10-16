//! 账号数据备份 / 恢复
//!
//! 备份产物是完整的 `Storage` 快照（账号 + 机器码 + 绑定关系），
//! 恢复支持「合并」与「覆盖」两种模式，覆盖前会自动留存回滚副本。

use crate::commands::AppState;
use crate::core::{Account, Storage};
use crate::utils::logger::{log_error, log_info};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub account_count: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub path: String,
    pub mode: String,
    /// 新增的账号数
    pub added: usize,
    /// 覆盖更新的账号数
    pub updated: usize,
    /// 跳过的非法条目数
    pub invalid: usize,
    /// 恢复后账号总数
    pub total: usize,
}

fn default_backup_file_name() -> String {
    format!(
        "lutra-credentials-backup-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// 解析备份文件，兼容两种格式：
/// 1. 完整快照 `{ "accounts": [...], "machine_id": ..., "account_machine_bindings": {...} }`
/// 2. 纯账号数组 `[ {...}, {...} ]`
fn parse_backup(content: &str) -> Result<Storage, String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("备份文件不是合法 JSON: {}", e))?;

    if value.is_array() {
        let accounts: Vec<Account> = serde_json::from_value(value)
            .map_err(|e| format!("备份文件中的账号数据无法解析: {}", e))?;
        return Ok(Storage {
            accounts,
            ..Storage::new()
        });
    }

    serde_json::from_value(value).map_err(|e| format!("备份文件结构无法识别: {}", e))
}

/// 解析用户指定的路径；为空时弹出系统文件选择框。
/// 返回 `None` 表示用户取消。
async fn resolve_target_path(
    app: &AppHandle,
    path: Option<String>,
    for_save: bool,
) -> Result<Option<PathBuf>, String> {
    if let Some(explicit) = path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        return Ok(Some(PathBuf::from(explicit)));
    }

    let dialog = app.dialog().file();
    let dialog = if for_save {
        dialog
            .set_title("导出账号备份")
            .set_file_name(default_backup_file_name())
    } else {
        dialog.set_title("选择备份文件")
    };
    let dialog = dialog.add_filter("JSON", &["json"]);

    let picked = if for_save {
        dialog.blocking_save_file()
    } else {
        dialog.blocking_pick_file()
    };

    match picked {
        Some(file_path) => Ok(Some(PathBuf::from(
            file_path.as_path().ok_or("无效的文件路径")?,
        ))),
        None => Ok(None),
    }
}

/// 导出完整数据快照到 JSON 文件。
#[tauri::command]
pub async fn backup_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<Option<BackupResult>, String> {
    let Some(target) = resolve_target_path(&app, path, true).await? else {
        return Ok(None);
    };

    let (payload, account_count) = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        (
            serde_json::to_string_pretty(&*storage)
                .map_err(|e| format!("序列化备份数据失败: {}", e))?,
            storage.accounts.len(),
        )
    };

    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {}", e))?;
        }
    }

    fs::write(&target, payload.as_bytes()).map_err(|e| format!("写入备份文件失败: {}", e))?;

    let result = BackupResult {
        path: target.to_string_lossy().to_string(),
        account_count,
        bytes: payload.len(),
    };

    log_info(&format!(
        "[Backup] Exported {} accounts to {}",
        result.account_count, result.path
    ));

    Ok(Some(result))
}

/// 从 JSON 备份恢复数据。
///
/// - `mode = "merge"`（默认）：按账号 id 合并，同 id 覆盖、其余追加；
/// - `mode = "replace"`：清空现有账号后用备份内容完全替换（会先写 `*.bak` 回滚副本）。
#[tauri::command]
pub async fn restore_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    mode: Option<String>,
) -> Result<Option<RestoreResult>, String> {
    let mode = match mode.as_deref() {
        Some("replace") => "replace",
        _ => "merge",
    }
    .to_string();

    let Some(source) = resolve_target_path(&app, path, false).await? else {
        return Ok(None);
    };

    let content = fs::read_to_string(&source).map_err(|e| format!("读取备份文件失败: {}", e))?;
    let incoming = parse_backup(&content)?;

    let source_path = source.to_string_lossy().to_string();

    // 覆盖模式属于破坏性操作，先留存当前数据副本
    if mode == "replace" {
        if let Ok(current) = crate::core::storage::current_storage_path(&app) {
            if current.exists() {
                let rollback = current.with_extension("json.bak");
                match fs::copy(&current, &rollback) {
                    Ok(_) => log_info(&format!(
                        "[Backup] Rollback copy written to {}",
                        rollback.display()
                    )),
                    Err(error) => {
                        log_error(&format!("[Backup] Failed to write rollback copy: {}", error))
                    }
                }
            }
        }
    }

    let (added, updated, invalid, total) = {
        let mut storage = state.storage.lock().map_err(|e| e.to_string())?;

        let mut added = 0usize;
        let mut updated = 0usize;
        let mut invalid = 0usize;

        if mode == "replace" {
            let mut accounts: Vec<Account> = Vec::with_capacity(incoming.accounts.len());
            for account in incoming.accounts {
                if account.id.trim().is_empty() {
                    invalid += 1;
                    continue;
                }
                accounts.push(account);
            }
            added = accounts.len();
            storage.accounts = accounts;
            if incoming.machine_id.is_some() {
                storage.machine_id = incoming.machine_id.clone();
            }
            if !incoming.account_machine_bindings.is_empty() {
                storage.account_machine_bindings = incoming.account_machine_bindings.clone();
            }
        } else {
            for account in incoming.accounts {
                if account.id.trim().is_empty() {
                    invalid += 1;
                    continue;
                }
                match storage
                    .accounts
                    .iter_mut()
                    .find(|existing| existing.id == account.id)
                {
                    Some(existing) => {
                        *existing = account;
                        updated += 1;
                    }
                    None => {
                        storage.accounts.push(account);
                        added += 1;
                    }
                }
            }

            let bindings: HashMap<String, String> = incoming.account_machine_bindings;
            for (account_id, machine_id) in bindings {
                storage
                    .account_machine_bindings
                    .entry(account_id)
                    .or_insert(machine_id);
            }
        }

        storage.save(&app)?;
        (added, updated, invalid, storage.accounts.len())
    };

    let result = RestoreResult {
        path: source_path,
        mode,
        added,
        updated,
        invalid,
        total,
    };

    log_info(&format!(
        "[Backup] Restored from {} (mode={}, added={}, updated={}, invalid={}, total={})",
        result.path, result.mode, result.added, result.updated, result.invalid, result.total
    ));

    Ok(Some(result))
}
