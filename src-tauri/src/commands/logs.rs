//! 运行日志查询与维护（供前端日志查看器使用）

use crate::utils::logger;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

/// 默认返回的尾部行数
const DEFAULT_TAIL_LINES: usize = 500;
/// 允许请求的最大行数
const MAX_TAIL_LINES: usize = 5000;
/// 单次读取的最大字节数，避免超大日志卡住界面
const MAX_READ_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub path: String,
    pub directory: String,
    pub lines: Vec<String>,
    pub total_lines: usize,
    /// 是否因为行数上限而只返回了尾部片段
    pub truncated: bool,
    pub size_bytes: u64,
}

fn resolve_log_file() -> Result<PathBuf, String> {
    logger::get_log_file_path().ok_or_else(|| "日志系统尚未初始化".to_string())
}

fn log_directory(path: &PathBuf) -> String {
    path.parent()
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 读取日志文件尾部内容
#[tauri::command]
pub fn read_log_tail(max_lines: Option<usize>) -> Result<LogChunk, String> {
    let path = resolve_log_file()?;
    let limit = max_lines.unwrap_or(DEFAULT_TAIL_LINES).clamp(1, MAX_TAIL_LINES);
    let directory = log_directory(&path);

    if !path.exists() {
        return Ok(LogChunk {
            path: path.to_string_lossy().to_string(),
            directory,
            lines: Vec::new(),
            total_lines: 0,
            truncated: false,
            size_bytes: 0,
        });
    }

    let size_bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let seeked = size_bytes > MAX_READ_BYTES;

    let mut file = File::open(&path).map_err(|e| format!("打开日志文件失败: {}", e))?;
    if seeked {
        file.seek(SeekFrom::End(-(MAX_READ_BYTES as i64)))
            .map_err(|e| format!("定位日志末尾失败: {}", e))?;
    }

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("读取日志文件失败: {}", e))?;
    let content = String::from_utf8_lossy(&buffer);

    let mut all: Vec<String> = content.lines().map(|line| line.to_string()).collect();
    // 从文件中间开始读取时，首行可能是被截断的半行
    if seeked && all.len() > 1 {
        all.remove(0);
    }

    let total_lines = all.len();
    let truncated = total_lines > limit;
    let lines = if truncated {
        all[total_lines - limit..].to_vec()
    } else {
        all
    };

    Ok(LogChunk {
        path: path.to_string_lossy().to_string(),
        directory,
        lines,
        total_lines,
        truncated,
        size_bytes,
    })
}

/// 日志目录（即使目录尚未创建也会返回预期路径）
#[tauri::command]
pub fn get_log_directory() -> Result<String, String> {
    Ok(log_directory(&resolve_log_file()?))
}

/// 在系统文件管理器中打开日志目录
#[tauri::command]
pub fn open_log_directory() -> Result<String, String> {
    let directory = log_directory(&resolve_log_file()?);
    if directory.is_empty() {
        return Err("无法定位日志目录".to_string());
    }

    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer").arg(&directory).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&directory).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&directory).spawn();

    spawned.map_err(|e| format!("打开日志目录失败: {}", e))?;

    Ok(directory)
}

/// 清空当前日志文件
#[tauri::command]
pub fn clear_log_file() -> Result<(), String> {
    let path = resolve_log_file()?;

    if path.exists() {
        fs::write(&path, b"").map_err(|e| format!("清空日志失败: {}", e))?;
    }

    logger::log_info("[Logs] Log file cleared");
    Ok(())
}
