//! Antigravity 平台命令
//!
//! 处理 Google OAuth、Token 验证、配额刷新等

use crate::utils::common::{calculate_expiry_timestamp, generate_account_id};
use crate::utils::logger::{log_info, log_warn};
use base64::{engine::general_purpose, Engine as _};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::command;

/// OAuth URL 响应
#[derive(Serialize)]
#[allow(dead_code)]
pub struct OAuthUrlResponse {
    pub url: String,
    pub state: String,
}

/// 账号数据（简化版，用于返回给前端）
#[derive(Serialize)]
pub struct AntigravityAccountData {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub refresh_token: String,
}

/// 扫描到的 Token
#[derive(Serialize)]
pub struct FoundToken {
    pub source: String,
    pub token: String,
}

use crate::core::oauth;
use crate::core::oauth_server;
use crate::core::quota;
use crate::utils::paths;
use tauri::AppHandle;

// ... keep existing structs ...

/// 准备 OAuth URL
#[command]
pub async fn antigravity_prepare_oauth_url(app: AppHandle) -> Result<String, String> {
    // 使用自动服务器，启动本地监听并在 localhost 接收回调
    oauth_server::ensure_oauth_flow_prepared(Some(app)).await
}

/// 完成 OAuth 登录
#[command]
pub async fn antigravity_complete_oauth(
    app: AppHandle,
    code: String,
) -> Result<AntigravityAccountData, String> {
    // 如果 code 为空，说明是自动回调，直接完成流程
    // 如果 code 不为空，说明是手动输入，需要先提交
    if !code.is_empty() {
        oauth_server::submit_oauth_code(code).await?;
    }

    // 完成 Token 交换
    let token_res = oauth_server::complete_oauth_flow(Some(app)).await?;

    // Get User Info
    let user_info = oauth::get_user_info(&token_res.access_token).await?;

    // Create Account Data
    Ok(AntigravityAccountData {
        id: generate_account_id(),
        email: user_info.email.clone(),
        name: user_info.get_display_name(),
        refresh_token: token_res.refresh_token.unwrap_or_default(),
    })
}

/// 通过 Refresh Token 添加账号
#[command]
pub async fn antigravity_add_by_token(
    refresh_token: String,
) -> Result<AntigravityAccountData, String> {
    // 简单验证格式
    if !refresh_token.starts_with("1//") && !refresh_token.contains(".") {
        // rough check
    }

    // 尝试刷新 Token 以验证有效性
    let token_res = oauth::refresh_access_token(&refresh_token).await?;

    // 获取用户信息
    let user_info = oauth::get_user_info(&token_res.access_token).await?;
    let name = user_info.get_display_name();

    Ok(AntigravityAccountData {
        id: generate_account_id(),
        email: user_info.email,
        name,
        refresh_token,
    })
}

/// 刷新 Access Token
#[derive(Serialize)]
pub struct TokenRefreshResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

#[command]
pub async fn antigravity_refresh_token(
    refresh_token: String,
) -> Result<TokenRefreshResponse, String> {
    let token_res = oauth::refresh_access_token(&refresh_token).await?;

    Ok(TokenRefreshResponse {
        access_token: token_res.access_token,
        expires_in: token_res.expires_in,
        token_type: token_res.token_type,
    })
}

/// 获取配额信息
#[command]
pub async fn antigravity_get_quota(access_token: String) -> Result<quota::QuotaData, String> {
    let (data, _err) = quota::fetch_quota(&access_token, None).await?;
    Ok(data)
}
/// 自动扫描数据库
#[command]
pub fn antigravity_scan_databases() -> Result<Vec<FoundToken>, String> {
    let mut tokens = Vec::new();

    // 使用通用工具获取所有可能的路径
    let all_paths = paths::get_ide_database_paths();

    log_info(&format!(
        "Scanning {} possible database paths",
        all_paths.len()
    ));

    for path in all_paths {
        if path.exists() {
            match extract_token_from_db(&path) {
                Ok(token) => {
                    let source = path
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    log_info(&format!("Token extracted from: {}", source));
                    tokens.push(FoundToken { source, token });
                }
                Err(_) => {}
            }
        }
    }

    log_info(&format!("Total tokens found: {}", tokens.len()));
    Ok(tokens)
}

/// 从数据库中提取 refresh token（使用原项目的方法）
fn extract_token_from_db(db_path: &PathBuf) -> Result<String, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    // 读取特定的 key: jetskiStateSync.agentManagerInitState
    let current_data: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["jetskiStateSync.agentManagerInitState"],
            |row| row.get(0),
        )
        .map_err(|_| {
            "Login state data not found (jetskiStateSync.agentManagerInitState)".to_string()
        })?;

    // Base64 解码
    let blob = general_purpose::STANDARD
        .decode(&current_data)
        .map_err(|e| format!("Base64 decoding failed: {}", e))?;

    // 1. 查找 oauthTokenInfo (Field 6)
    let oauth_data = find_protobuf_field(&blob, 6)
        .map_err(|e| format!("Protobuf parsing failed: {}", e))?
        .ok_or("OAuth data not found (Field 6)")?;

    // 2. 提取 refresh_token (Field 3)
    let refresh_bytes = find_protobuf_field(&oauth_data, 3)
        .map_err(|e| format!("OAuth data parsing failed: {}", e))?
        .ok_or("Refresh Token not found (Field 3)")?;

    String::from_utf8(refresh_bytes).map_err(|_| "Refresh Token is not UTF-8 encoded".to_string())
}

/// 读取 Protobuf Varint
fn read_varint(data: &[u8], offset: usize) -> Result<(u64, usize), String> {
    let mut result = 0u64;
    let mut shift = 0;
    let mut pos = offset;

    loop {
        if pos >= data.len() {
            return Err("incomplete_data".to_string());
        }
        let byte = data[pos];
        result |= ((byte & 0x7F) as u64) << shift;
        pos += 1;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }

    Ok((result, pos))
}

/// 跳过 Protobuf 字段
fn skip_field(data: &[u8], offset: usize, wire_type: u8) -> Result<usize, String> {
    match wire_type {
        0 => {
            // Varint
            let (_, new_offset) = read_varint(data, offset)?;
            Ok(new_offset)
        }
        1 => {
            // 64-bit
            Ok(offset + 8)
        }
        2 => {
            // Length-delimited
            let (length, content_offset) = read_varint(data, offset)?;
            Ok(content_offset + length as usize)
        }
        5 => {
            // 32-bit
            Ok(offset + 4)
        }
        _ => Err(format!("unknown_wire_type: {}", wire_type)),
    }
}

/// 查找指定的 Protobuf 字段内容（仅限 Length-Delimited）
fn find_protobuf_field(data: &[u8], target_field: u32) -> Result<Option<Vec<u8>>, String> {
    let mut offset = 0;

    while offset < data.len() {
        let (tag, new_offset) = match read_varint(data, offset) {
            Ok(v) => v,
            Err(_) => break, // 数据不完整，停止
        };

        let wire_type = (tag & 7) as u8;
        let field_num = (tag >> 3) as u32;

        if field_num == target_field && wire_type == 2 {
            let (length, content_offset) = read_varint(data, new_offset)?;
            return Ok(Some(
                data[content_offset..content_offset + length as usize].to_vec(),
            ));
        }

        // 跳过字段
        offset = skip_field(data, new_offset, wire_type)?;
    }

    Ok(None)
}

/// 选择数据库文件
///
/// 注意：此功能需要 tauri-plugin-dialog，当前返回 None 让前端使用手动输入
/// 选择数据库文件
#[command]
pub async fn select_db_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .add_filter("VSCDB", &["vscdb"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    Ok(result.map(|path| path.to_string()))
}

/// 切换账号（完整实现）
///
/// 包含以下步骤：
/// 1. 验证账号存在
/// 2. 刷新 Token 确保有效
/// 3. 关闭 Antigravity IDE 进程
/// 4. 注入 Token 到数据库
/// 5. 重启 Antigravity IDE
#[command]
pub async fn antigravity_switch_account(
    account_id: String,
    refresh_token: String,
    email: String,
) -> Result<TokenRefreshResponse, String> {
    log_info(&format!(
        "Switching account: {} ({})",
        email,
        &account_id[..8]
    ));

    // 1. 刷新 Token 确保有效
    let token_res = oauth::refresh_access_token(&refresh_token).await?;

    // 2. 关闭 Antigravity IDE 进程（并保存路径）
    if crate::utils::process::is_antigravity_running() {
        log_info("Closing Antigravity IDE");
        crate::utils::process::close_antigravity(20)?;
    }

    // 3. 注入 Token 到数据库
    let db_path = crate::utils::db_inject::get_db_path()?;

    // 备份数据库
    let backup_path = db_path.with_extension("vscdb.backup");
    if let Err(e) = std::fs::copy(&db_path, &backup_path) {
        log_warn(&format!("Failed to backup database: {}", e));
    }

    // 计算过期时间戳（毫秒）
    let expiry_timestamp = calculate_expiry_timestamp(token_res.expires_in);

    // 注入 Token
    crate::utils::db_inject::inject_token(
        &db_path,
        &token_res.access_token,
        &refresh_token,
        expiry_timestamp,
        &email,
    )?;

    // 4. 重启 Antigravity IDE
    log_info("Starting Antigravity IDE");
    crate::utils::process::start_antigravity()?;

    log_info("Account switch completed");

    // 返回新的 Token 信息，前端会更新账号状态
    Ok(TokenRefreshResponse {
        access_token: token_res.access_token,
        expires_in: token_res.expires_in,
        token_type: token_res.token_type,
    })
}

/// Get Antigravity platform version
pub fn get_antigravity_version() -> Option<String> {
    use crate::utils::encoding::decode_console_output;
    use crate::utils::logger::{log_debug, log_info};
    use std::process::Command;

    log_debug("Checking Antigravity version");

    let exe_path = crate::utils::process::get_antigravity_executable_path()?
        .to_string_lossy()
        .to_string();

    // 尝试执行 antigravity --version
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", &format!("\"{}\" --version", exe_path)])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = {
        Command::new("sh")
            .arg("-c")
            .arg(format!("'{}' --version", exe_path))
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = decode_console_output(&out.stdout).trim().to_string();
            let stderr = decode_console_output(&out.stderr).trim().to_string();

            log_info(&format!(
                "Antigravity command executed - status: {}, stdout: '{}', stderr: '{}'",
                out.status, stdout, stderr
            ));

            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if !raw.is_empty() {
                    let version = extract_version(raw);
                    log_debug(&format!("Antigravity version extracted: {}", version));
                    return Some(version);
                }
            } else {
                // 尝试使用 -v 参数
                log_info("Trying with -v flag");

                #[cfg(target_os = "windows")]
                let output_v = {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;

                    Command::new("cmd")
                        .args(["/C", &format!("\"{}\" -v", exe_path)])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output()
                };

                #[cfg(not(target_os = "windows"))]
                let output_v = {
                    Command::new("sh")
                        .arg("-c")
                        .arg(format!("'{}' -v", exe_path))
                        .output()
                };

                if let Ok(out_v) = output_v {
                    let stdout_v = decode_console_output(&out_v.stdout).trim().to_string();
                    let stderr_v = decode_console_output(&out_v.stderr).trim().to_string();

                    log_info(&format!(
                        "Antigravity -v command executed - status: {}, stdout: '{}', stderr: '{}'",
                        out_v.status, stdout_v, stderr_v
                    ));

                    if out_v.status.success() {
                        let raw_v = if stdout_v.is_empty() {
                            &stderr_v
                        } else {
                            &stdout_v
                        };
                        if !raw_v.is_empty() {
                            let version = extract_version(raw_v);
                            log_debug(&format!("Antigravity version extracted (-v): {}", version));
                            return Some(version);
                        }
                    }
                }

                let err = if stderr.is_empty() { stdout } else { stderr };
                log_info(&format!("Antigravity command failed: {}", err));
            }
        }
        Err(e) => {
            log_info(&format!("Failed to execute antigravity command: {}", e));
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
