//! 统一日志系统
//!
//! 提供统一的日志输出接口，同时输出到控制台和文件

use chrono::Local;
use once_cell::sync::Lazy;
use std::fmt::Display;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// 日志级别
#[allow(dead_code)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

/// ANSI 颜色代码
struct Colors;

impl Colors {
    const RESET: &'static str = "\x1b[0m";

    // 日志级别颜色
    const INFO: &'static str = "\x1b[36m"; // 青色 (Cyan)
    const WARN: &'static str = "\x1b[33m"; // 黄色 (Yellow)
    const ERROR: &'static str = "\x1b[31m"; // 红色 (Red)
    const DEBUG: &'static str = "\x1b[35m"; // 紫色 (Magenta)

    // 时间戳颜色
    const TIMESTAMP: &'static str = "\x1b[90m"; // 灰色 (Bright Black)
}

/// 最大日志消息长度（字符数）
const MAX_LOG_LENGTH: usize = 500;

/// 最大日志文件大小（字节）- 10MB
const MAX_LOG_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// 全局日志文件路径
static LOG_FILE_PATH: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// 初始化日志系统
pub fn init_logger(app: &tauri::AppHandle) -> Result<(), String> {
    let log_dir = get_log_dir(app)?;

    // 确保日志目录存在
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
    }

    // 日志文件路径
    let log_file = log_dir.join("app.log");

    // 保存到全局变量
    if let Ok(mut path) = LOG_FILE_PATH.lock() {
        *path = Some(log_file.clone());
    }

    // 写入启动日志
    write_to_file(
        &log_file,
        "INFO",
        &format!(
            "=== Application started at {} ===",
            Local::now().format("%Y-%m-%d %H:%M:%S")
        ),
    );
    write_to_file(
        &log_file,
        "INFO",
        &format!("Log file: {}", log_file.display()),
    );

    Ok(())
}

/// 获取日志目录
///
/// 跟随应用标识符（com.lutra.credentials），不再硬编码旧品牌目录。
fn get_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    app.path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get app log directory: {}", e))
}

/// 截断长字符串
fn truncate_message(message: &str) -> String {
    if message.len() <= MAX_LOG_LENGTH {
        message.to_string()
    } else {
        format!(
            "{}... [truncated, total {} chars]",
            &message[..MAX_LOG_LENGTH],
            message.len()
        )
    }
}

/// 获取日志级别对应的颜色
fn get_level_color(level: &str) -> &'static str {
    match level {
        "INFO" => Colors::INFO,
        "WARN" => Colors::WARN,
        "ERROR" => Colors::ERROR,
        "DEBUG" => Colors::DEBUG,
        _ => Colors::RESET,
    }
}

/// 检查并轮转日志文件
fn check_and_rotate_log(path: &PathBuf) {
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_LOG_FILE_SIZE {
            // 轮转日志：app.log -> app.log.1
            let rotated_path = path.with_extension("log.1");
            let _ = fs::rename(path, rotated_path);
        }
    }
}

/// 写入日志到文件
fn write_to_file(path: &PathBuf, level: &str, message: &str) {
    // 检查文件大小并轮转
    check_and_rotate_log(path);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        let truncated = truncate_message(message);
        let _ = writeln!(file, "[{}] [{}] {}", timestamp, level, truncated);
    }
}

/// 写入日志（同时输出到控制台和文件）
fn log_message<T: Display>(level: &str, message: T, to_stderr: bool) {
    let msg = message.to_string();
    let truncated = truncate_message(&msg);
    let timestamp = Local::now().format("%H:%M:%S");

    // 获取颜色
    let level_color = get_level_color(level);

    // 格式化带颜色的控制台输出
    let colored_output = format!(
        "{}[{}]{} {}{:<5}{} {}",
        Colors::TIMESTAMP,
        timestamp,
        Colors::RESET,
        level_color,
        level,
        Colors::RESET,
        truncated
    );

    // 输出到控制台
    if to_stderr {
        eprintln!("{}", colored_output);
    } else {
        println!("{}", colored_output);
    }

    // 输出到文件（不带颜色）
    if let Ok(path_guard) = LOG_FILE_PATH.lock() {
        if let Some(log_file) = path_guard.as_ref() {
            write_to_file(log_file, level, &msg);
        }
    }
}

/// 输出信息日志
pub fn log_info<T: Display>(message: T) {
    log_message("INFO", message, false);
}

/// 输出警告日志
pub fn log_warn<T: Display>(message: T) {
    log_message("WARN", message, false);
}

/// 输出错误日志
pub fn log_error<T: Display>(message: T) {
    log_message("ERROR", message, true);
}

/// 输出调试日志
#[allow(dead_code)]
pub fn log_debug<T: Display>(message: T) {
    log_message("DEBUG", message, false);
}

/// 获取日志文件路径（用于前端查询）
pub fn get_log_file_path() -> Option<PathBuf> {
    LOG_FILE_PATH.lock().ok()?.clone()
}
