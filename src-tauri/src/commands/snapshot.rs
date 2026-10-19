//! 切号前配置快照与回滚
//!
//! 一键切号会直接改写第三方工具的本地配置文件（auth.json / settings.json 等）。
//! 在每次切号前，把目标平台涉及的配置文件复制到应用数据目录下的
//! `snapshots/<platform>/<id>/` 中留档；用户可在设置页查看快照并一键恢复，
//! 也可以在切号失败 / 配置写坏时手动回滚到切换前的状态。
//!
//! 仅覆盖「文件型配置」平台（claude / codex / gemini / kiro / grok / zcode / trae）；
//! 写系统钥匙串（zed）或外部 SQLite（cursor / windsurf / copilot / codebuddy 等）
//! 的平台不适用文件快照，返回空列表静默跳过。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::utils::common::write_atomic_bytes;
use crate::utils::logger::{log_error, log_info};

/// 每个平台保留的最近快照数量，超出部分自动清理最旧的
const MAX_SNAPSHOTS_PER_PLATFORM: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSnapshot {
    pub id: String,
    pub platform: String,
    /// 创建时间（毫秒时间戳）
    pub created_at: i64,
    /// 快照包含的配置文件原始绝对路径（按索引对应 files/0..n）
    pub files: Vec<String>,
}

/// 平台 → 切号会改写的本地配置文件列表（只保留当前存在的文件）
fn platform_config_files(platform: &str) -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let files: Vec<PathBuf> = match platform {
        "claude" => vec![
            home.join(".claude").join("settings.json"),
            home.join(".claude").join(".credentials.json"),
        ],
        "codex" => vec![
            home.join(".codex").join("auth.json"),
            home.join(".codex").join("config.toml"),
        ],
        "gemini" => vec![
            home.join(".gemini").join(".env"),
            home.join(".gemini").join("config.json"),
            home.join(".gemini").join("settings.json"),
        ],
        "kiro" => vec![home.join(".aws").join("sso").join("cache").join("kiro-auth-token.json")],
        "grok" => vec![crate::commands::grok::grok_home_dir()?.join("auth.json")],
        "zcode" => vec![
            crate::commands::zcode::default_config_path()?,
            crate::commands::zcode::default_settings_path()?,
        ],
        "trae" => vec![crate::commands::trae::resolve_trae_storage_path()?],
        _ => vec![],
    };
    Ok(files.into_iter().filter(|path| path.is_file()).collect())
}

fn snapshots_root(app: &AppHandle, platform: &str) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    Ok(data_dir.join("snapshots").join(platform))
}

/// 校验快照 id / 平台名，防止路径穿越
fn validate_segment(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
        || value.contains(':')
    {
        return Err(format!("非法的快照标识: {}", value));
    }
    Ok(())
}

fn read_snapshot_meta(platform_dir: &PathBuf, id: &str) -> Option<ConfigSnapshot> {
    let meta_path = platform_dir.join(id).join("snapshot.json");
    let content = fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 按创建时间倒序列出某个平台目录下的全部快照
fn list_platform_snapshots(platform_dir: &PathBuf) -> Vec<ConfigSnapshot> {
    let mut snapshots: Vec<ConfigSnapshot> = fs::read_dir(platform_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.path().is_dir())
                .filter_map(|entry| read_snapshot_meta(platform_dir, &entry.file_name().to_string_lossy()))
                .collect()
        })
        .unwrap_or_default();
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    snapshots
}

/// 超出保留上限时删除最旧的快照
fn prune_snapshots(platform_dir: &PathBuf) {
    let snapshots = list_platform_snapshots(platform_dir);
    if snapshots.len() <= MAX_SNAPSHOTS_PER_PLATFORM {
        return;
    }
    for snapshot in snapshots.iter().skip(MAX_SNAPSHOTS_PER_PLATFORM) {
        let dir = platform_dir.join(&snapshot.id);
        if let Err(error) = fs::remove_dir_all(&dir) {
            log_error(&format!(
                "[Snapshot] 清理过期快照失败 {}: {}",
                dir.display(),
                error
            ));
        }
    }
}

/// 切号前调用：为指定平台创建当前配置文件快照。
/// 平台不支持文件快照或当前没有任何可备份文件时返回 `None`（非错误）。
#[tauri::command]
pub fn create_switch_snapshot(
    app: AppHandle,
    platform: String,
) -> Result<Option<ConfigSnapshot>, String> {
    validate_segment(&platform)?;
    let files = platform_config_files(&platform)?;
    if files.is_empty() {
        return Ok(None);
    }

    let platform_dir = snapshots_root(&app, &platform)?;
    let created_at = chrono::Utc::now().timestamp_millis();
    let id = format!("{}-{}", created_at, uuid::Uuid::new_v4().simple());
    let snapshot_dir = platform_dir.join(&id);
    fs::create_dir_all(snapshot_dir.join("files"))
        .map_err(|e| format!("创建快照目录失败: {}", e))?;

    let mut stored_files = Vec::with_capacity(files.len());
    for (index, path) in files.iter().enumerate() {
        let target = snapshot_dir.join("files").join(index.to_string());
        fs::copy(path, &target)
            .map_err(|e| format!("复制配置文件失败 {}: {}", path.display(), e))?;
        stored_files.push(path.to_string_lossy().to_string());
    }

    let snapshot = ConfigSnapshot {
        id,
        platform,
        created_at,
        files: stored_files,
    };

    let meta_path = snapshot_dir.join("snapshot.json");
    let meta = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("序列化快照元数据失败: {}", e))?;
    write_atomic_bytes(&meta_path, meta.as_bytes())?;

    prune_snapshots(&platform_dir);
    log_info(&format!(
        "[Snapshot] 已为 {} 创建切号前快照（{} 个文件）: {}",
        snapshot.platform,
        snapshot.files.len(),
        snapshot_dir.display()
    ));

    Ok(Some(snapshot))
}

/// 列出快照。`platform = None` 时列出全部平台。
#[tauri::command]
pub fn list_switch_snapshots(
    app: AppHandle,
    platform: Option<String>,
) -> Result<Vec<ConfigSnapshot>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let root = data_dir.join("snapshots");

    let platform_dirs: Vec<PathBuf> = match &platform {
        Some(name) => {
            validate_segment(name)?;
            vec![root.join(name)]
        }
        None => fs::read_dir(&root)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .filter(|path| path.is_dir())
                    .collect()
            })
            .unwrap_or_default(),
    };

    let mut snapshots: Vec<ConfigSnapshot> = platform_dirs
        .iter()
        .flat_map(list_platform_snapshots)
        .collect();
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(snapshots)
}

/// 把指定快照里的配置文件原子写回原路径
#[tauri::command]
pub fn restore_switch_snapshot(app: AppHandle, platform: String, id: String) -> Result<(), String> {
    validate_segment(&platform)?;
    validate_segment(&id)?;

    let platform_dir = snapshots_root(&app, &platform)?;
    let snapshot_dir = platform_dir.join(&id);
    let snapshot = read_snapshot_meta(&platform_dir, &id)
        .ok_or_else(|| format!("快照不存在: {}", id))?;

    for (index, original) in snapshot.files.iter().enumerate() {
        let source = snapshot_dir.join("files").join(index.to_string());
        let bytes = fs::read(&source)
            .map_err(|e| format!("读取快照文件失败 {}: {}", source.display(), e))?;
        let target = PathBuf::from(original);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目标目录失败 {}: {}", parent.display(), e))?;
        }
        write_atomic_bytes(&target, &bytes)
            .map_err(|e| format!("恢复配置文件失败 {}: {}", target.display(), e))?;
    }

    log_info(&format!(
        "[Snapshot] 已恢复 {} 的快照 {}（{} 个文件）",
        platform,
        id,
        snapshot.files.len()
    ));
    Ok(())
}

/// 删除单个快照
#[tauri::command]
pub fn delete_switch_snapshot(app: AppHandle, platform: String, id: String) -> Result<(), String> {
    validate_segment(&platform)?;
    validate_segment(&id)?;

    let dir = snapshots_root(&app, &platform)?.join(&id);
    if !dir.is_dir() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除快照失败 {}: {}", dir.display(), e))?;
    Ok(())
}

/// 清空快照。`platform = None` 时清空全部平台。
#[tauri::command]
pub fn clear_switch_snapshots(app: AppHandle, platform: Option<String>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let root = data_dir.join("snapshots");

    match &platform {
        Some(name) => {
            validate_segment(name)?;
            let dir = root.join(name);
            if dir.is_dir() {
                fs::remove_dir_all(&dir).map_err(|e| format!("清空快照失败 {}: {}", dir.display(), e))?;
            }
        }
        None => {
            if root.is_dir() {
                fs::remove_dir_all(&root).map_err(|e| format!("清空快照失败 {}: {}", root.display(), e))?;
            }
        }
    }
    Ok(())
}
