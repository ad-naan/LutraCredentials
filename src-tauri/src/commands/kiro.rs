use crate::core::kiro as core_kiro;
use crate::utils::common::{extract_username_from_email, generate_account_id};
use serde::Serialize;
use tauri::{command, AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthResult {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>, // 携带 user_code 的完整 URL
    pub expires_in: i64,
    pub interval: i64,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountData {
    pub completed: bool,
    pub account: Option<KiroAccount>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccount {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub expires_in: i64,
    pub quota: core_kiro::KiroQuotaData,
}

/// 启动设备授权流程
#[command]
pub async fn kiro_start_device_auth() -> Result<DeviceAuthResult, String> {
    // 1. 注册客户端
    let (client_id, client_secret) = core_kiro::register_client().await?;

    // 2. 启动设备授权
    let auth_res = core_kiro::start_device_authorization(&client_id, &client_secret).await?;

    // 3. 构建完整的验证 URL (携带 user_code 参数)
    let verification_uri_complete = format!(
        "{}?user_code={}",
        auth_res.verificationUri, auth_res.userCode
    );

    Ok(DeviceAuthResult {
        device_code: auth_res.deviceCode,
        user_code: auth_res.userCode,
        verification_uri: auth_res.verificationUri,
        verification_uri_complete: Some(verification_uri_complete),
        expires_in: auth_res.expiresIn,
        interval: auth_res.interval,
        client_id,
        client_secret,
    })
}

/// 轮询 Token 并获取完整账号信息
#[command]
pub async fn kiro_poll_token(
    device_code: String,
    client_id: String,
    client_secret: String,
) -> Result<KiroAccountData, String> {
    // 进行一次检查
    // Poll Token
    let token_res = match core_kiro::poll_token(&client_id, &client_secret, &device_code, 5).await {
        Ok(t) => t,
        Err(e) => {
            if e == "pending" || e == "slow_down" {
                return Ok(KiroAccountData {
                    completed: false,
                    account: None,
                    error: None,
                });
            }
            return Ok(KiroAccountData {
                completed: false,
                account: None,
                error: Some(e),
            });
        }
    };

    // 获取配额和用户信息
    let quota_res = core_kiro::get_usage_limits(&token_res.access_token)
        .await
        .map_err(|e| format!("Failed to fetch user info: {}", e))?;

    let email = quota_res
        .email
        .clone()
        .unwrap_or("unknown@example.com".to_string());
    let name = extract_username_from_email(&email);

    Ok(KiroAccountData {
        completed: true,
        account: Some(KiroAccount {
            id: generate_account_id(),
            email,
            name,
            access_token: token_res.access_token,
            refresh_token: token_res.refresh_token,
            client_id: token_res.client_id,
            client_secret: token_res.client_secret,
            expires_in: token_res.expires_in,
            quota: quota_res,
        }),
        error: None,
    })
}

/// 检查配额
#[command]
pub async fn kiro_check_quota(access_token: String) -> Result<core_kiro::KiroQuotaData, String> {
    core_kiro::get_usage_limits(&access_token).await
}

/// 刷新 Token
#[command]
pub async fn kiro_refresh_token(
    refresh_token: String,
    client_id: String,
    client_secret: String,
) -> Result<core_kiro::KiroTokenData, String> {
    core_kiro::refresh_token(&refresh_token, &client_id, &client_secret).await
}

// 模拟取消 (实际逻辑由前端停止轮询)
#[command]
pub fn kiro_cancel_auth() -> Result<(), String> {
    Ok(())
}

/// 导入 SSO Token
#[command]
pub async fn kiro_import_sso_token(token: String) -> Result<KiroAccount, String> {
    // 验证 Token (通过获取配额)
    let quota_res = core_kiro::get_usage_limits(&token)
        .await
        .map_err(|e| format!("Invalid SSO Token: {}", e))?;

    let email = quota_res
        .email
        .clone()
        .unwrap_or("imported@example.com".to_string());
    let name = extract_username_from_email(&email);

    Ok(KiroAccount {
        id: generate_account_id(),
        email,
        name,
        access_token: token,
        refresh_token: None, // SSO Token 通常没有 Refresh Token 或者是在外部管理
        client_id: None,
        client_secret: None,
        expires_in: 0, // 未知过期时间
        quota: quota_res,
    })
}

/// 验证 OIDC 凭证并导入
#[command]
pub async fn kiro_verify_credentials(
    credentials: serde_json::Value,
) -> Result<KiroAccount, String> {
    use crate::utils::logger::log_info;

    log_info(&format!(
        "[OIDC Import] Received credentials: {}",
        serde_json::to_string(&credentials).unwrap_or_default()
    ));

    // 支持 camelCase 和 snake_case 两种格式
    let client_id = credentials
        .get("clientId")
        .or(credentials.get("client_id"))
        .and_then(|v| v.as_str())
        .ok_or("缺少 clientId 字段")?;

    let client_secret = credentials
        .get("clientSecret")
        .or(credentials.get("client_secret"))
        .and_then(|v| v.as_str())
        .ok_or("缺少 clientSecret 字段")?;

    let refresh_token = credentials
        .get("refreshToken")
        .or(credentials.get("refresh_token"))
        .and_then(|v| v.as_str())
        .ok_or("缺少 refreshToken 字段")?;

    log_info(&format!(
        "[OIDC Import] Attempting to refresh token with clientId: {}...",
        &client_id[..20.min(client_id.len())]
    ));

    // 尝试刷新以获取 Access Token
    let token_res = core_kiro::refresh_token(refresh_token, client_id, client_secret)
        .await
        .map_err(|e| {
            log_info(&format!("[OIDC Import] Token refresh failed: {}", e));
            format!("Token 刷新失败: {}. 请检查凭证是否正确或已过期", e)
        })?;

    log_info("[OIDC Import] Token refreshed successfully, fetching user info...");

    // 尝试获取配额和用户信息（如果失败，使用默认值）
    let quota_res = match core_kiro::get_usage_limits(&token_res.access_token).await {
        Ok(quota) => {
            log_info("[OIDC Import] User info fetched successfully");
            quota
        }
        Err(e) => {
            log_info(&format!(
                "[OIDC Import] Failed to fetch user info (using defaults): {}",
                e
            ));
            // 返回默认配额信息
            core_kiro::KiroQuotaData {
                subscription_type: Some("Free".to_string()),
                subscription_title: Some("Free Tier".to_string()),
                total_limit: 25.0,
                current_usage: 0.0,
                percent_used: 0.0,
                days_remaining: None,
                email: Some("imported@example.com".to_string()),
                user_id: None,
            }
        }
    };

    let email = quota_res
        .email
        .clone()
        .unwrap_or("unknown@example.com".to_string());
    let name = extract_username_from_email(&email);

    log_info(&format!(
        "[OIDC Import] Import successful for email: {}",
        email
    ));

    Ok(KiroAccount {
        id: generate_account_id(),
        email,
        name,
        access_token: token_res.access_token,
        refresh_token: Some(token_res.refresh_token.unwrap_or(refresh_token.to_string())),
        client_id: Some(client_id.to_string()),
        client_secret: Some(client_secret.to_string()),
        expires_in: token_res.expires_in,
        quota: quota_res,
    })
}

/// 社交登录
#[command]
pub async fn kiro_social_login(app: AppHandle, provider: String) -> Result<KiroAccount, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(1);

    // 注册 Sender
    if let Some(state) = app.try_state::<core_kiro::DeepLinkState>() {
        // Explicitly annotate closure argument type to satisfy E0282
        let mut sender_guard = state
            .sender
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        *sender_guard = Some(tx);
    } else {
        return Err("DeepLinkState not initialized".to_string());
    }

    // 构建 URL
    // 注意：Callback URL 必须是 kiro://oauth/callback
    let callback_url = "kiro://oauth/callback";
    let url = format!(
        "https://app.kiro.dev/login?provider={}&callback={}&source=desktop",
        provider.to_lowercase(),
        urlencoding::encode(callback_url)
    );

    // 打开浏览器
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // 等待回调
    // 设置超时 5 分钟
    let url = tokio::time::timeout(std::time::Duration::from_secs(300), rx.recv())
        .await
        .map_err(|_| "Login timed out".to_string())?
        .ok_or("Channel closed".to_string())?;

    // 解析 URL
    // kiro://oauth/callback?token=...
    let url_parsed = url::Url::parse(&url).map_err(|e| format!("Invalid callback URL: {}", e))?;
    let pairs = url_parsed.query_pairs();
    let token = pairs
        .into_iter()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.to_string())
        .ok_or("No token in callback")?;

    // 导入 Token
    kiro_import_sso_token(token).await
}

/// 切换 Kiro 账号 - 写入凭证到本地 SSO 缓存
#[command]
pub async fn switch_kiro_account(
    access_token: String,
    refresh_token: String,
    client_id: String,
    client_secret: String,
    region: Option<String>,
    start_url: Option<String>,
    auth_method: Option<String>,
    provider: Option<String>,
) -> Result<(), String> {
    use crate::utils::logger::log_info;
    use sha1::{Digest, Sha1};

    log_info("[Switch Account] Starting account switch...");

    let region = region.unwrap_or_else(|| "us-east-1".to_string());
    let auth_method = auth_method.unwrap_or_else(|| "IdC".to_string());
    let provider = provider.unwrap_or_else(|| "BuilderId".to_string());
    let effective_start_url =
        start_url.unwrap_or_else(|| "https://view.awsapps.com/start".to_string());

    // 计算 clientIdHash (与 Kiro 客户端一致)
    let hash_input = format!(r#"{{"startUrl":"{}"}}"#, effective_start_url);
    let mut hasher = Sha1::new();
    hasher.update(hash_input.as_bytes());
    let client_id_hash = format!("{:x}", hasher.finalize());

    log_info(&format!(
        "[Switch Account] Client ID hash: {}",
        client_id_hash
    ));

    // 获取 SSO 缓存目录
    let home_dir = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let sso_cache = home_dir.join(".aws").join("sso").join("cache");

    // 确保目录存在
    std::fs::create_dir_all(&sso_cache).map_err(|e| format!("创建 SSO 缓存目录失败: {}", e))?;

    log_info(&format!(
        "[Switch Account] SSO cache directory: {}",
        sso_cache.display()
    ));

    // 写入 token 文件
    let token_path = sso_cache.join("kiro-auth-token.json");
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    let token_data = serde_json::json!({
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": expires_at.to_rfc3339(),
        "clientIdHash": client_id_hash,
        "authMethod": auth_method,
        "provider": provider,
        "region": region
    });

    std::fs::write(
        &token_path,
        serde_json::to_string_pretty(&token_data).unwrap(),
    )
    .map_err(|e| format!("写入 token 文件失败: {}", e))?;

    log_info(&format!(
        "[Switch Account] Token saved to: {}",
        token_path.display()
    ));

    // 只有 IdC 登录需要写入客户端注册文件
    if auth_method != "social" && !client_id.is_empty() && !client_secret.is_empty() {
        let client_reg_path = sso_cache.join(format!("{}.json", client_id_hash));
        let client_expires_at = chrono::Utc::now() + chrono::Duration::days(90);
        let client_data = serde_json::json!({
            "clientId": client_id,
            "clientSecret": client_secret,
            "expiresAt": client_expires_at.to_rfc3339().replace("Z", ""),
            "scopes": [
                "codewhisperer:completions",
                "codewhisperer:analysis",
                "codewhisperer:conversations",
                "codewhisperer:transformations",
                "codewhisperer:taskassist"
            ]
        });

        std::fs::write(
            &client_reg_path,
            serde_json::to_string_pretty(&client_data).unwrap(),
        )
        .map_err(|e| format!("写入客户端注册文件失败: {}", e))?;

        log_info(&format!(
            "[Switch Account] Client registration saved to: {}",
            client_reg_path.display()
        ));
    }

    log_info("[Switch Account] Account switch completed successfully");
    Ok(())
}

/// 在隐私模式下打开浏览器
#[command]
pub async fn open_url_in_private_mode(app: AppHandle, url: String) -> Result<(), String> {
    use crate::utils::logger::{log_error, log_info};
    use tauri_plugin_shell::ShellExt;

    let platform = std::env::consts::OS;
    log_info(&format!(
        "[Browser] Opening in private mode on {}: {}",
        platform, url
    ));

    let shell = app.shell();

    let result = match platform {
        "windows" => {
            // Windows: 先检测默认浏览器，然后尝试打开
            let default_browser = detect_windows_default_browser();
            log_info(&format!(
                "[Browser] Detected default browser: {}",
                default_browser
            ));

            // 根据检测到的浏览器优先尝试
            let mut browsers = vec![(
                default_browser.as_str(),
                get_browser_private_flag(&default_browser),
            )];

            // 添加其他常见浏览器作为备选
            for (browser, flag) in &[
                ("chrome", "--incognito"),
                ("msedge", "-inprivate"),
                ("firefox", "-private-window"),
                ("brave", "--incognito"),
                ("opera", "--private"),
            ] {
                if *browser != default_browser {
                    browsers.push((browser, flag));
                }
            }

            let mut success = false;
            for (browser, flag) in browsers {
                if browser == "unknown" {
                    continue;
                }

                log_info(&format!("[Browser] Trying {} with flag {}", browser, flag));

                // 方法1: 直接使用浏览器可执行文件
                match shell.command(browser).args(&[flag, &url]).spawn() {
                    Ok(_) => {
                        log_info(&format!(
                            "[Browser] Successfully launched {} directly",
                            browser
                        ));
                        success = true;
                        break;
                    }
                    Err(e) => {
                        log_info(&format!(
                            "[Browser] Direct launch failed: {}, trying cmd",
                            e
                        ));

                        // 方法2: 使用 cmd /c start
                        match shell
                            .command("cmd")
                            .args(&["/c", "start", "", browser, flag, &url])
                            .spawn()
                        {
                            Ok(_) => {
                                log_info(&format!(
                                    "[Browser] Successfully launched {} via cmd",
                                    browser
                                ));
                                success = true;
                                break;
                            }
                            Err(e2) => {
                                log_info(&format!("[Browser] cmd launch also failed: {}", e2));
                            }
                        }
                    }
                }
            }

            if success {
                Ok(())
            } else {
                Err("All browser launch attempts failed".to_string())
            }
        }
        "macos" => {
            // macOS: 尝试 Chrome -> Firefox
            log_info("[Browser] Trying Chrome");
            match shell
                .command("open")
                .args(&["-na", "Google Chrome", "--args", "--incognito", &url])
                .spawn()
            {
                Ok(_) => {
                    log_info("[Browser] Opened with Chrome");
                    Ok(())
                }
                Err(_) => {
                    log_info("[Browser] Chrome failed, trying Firefox");
                    shell
                        .command("open")
                        .args(&["-a", "Firefox", "--args", "-private-window", &url])
                        .spawn()
                        .map(|_| {
                            log_info("[Browser] Opened with Firefox");
                        })
                        .map_err(|e| format!("Failed to open browser: {}", e))
                }
            }
        }
        "linux" => {
            // Linux: 尝试常见浏览器
            let browsers = vec![
                ("google-chrome", vec!["--incognito", &url]),
                ("chromium", vec!["--incognito", &url]),
                ("firefox", vec!["-private-window", &url]),
            ];

            let mut success = false;
            for (browser, args) in browsers {
                log_info(&format!("[Browser] Trying {}", browser));

                match shell.command(browser).args(&args).spawn() {
                    Ok(_) => {
                        log_info(&format!("[Browser] Successfully launched {}", browser));
                        success = true;
                        break;
                    }
                    Err(e) => {
                        log_info(&format!("[Browser] Failed to launch {}: {}", browser, e));
                    }
                }
            }

            if success {
                Ok(())
            } else {
                Err("All browsers failed".to_string())
            }
        }
        _ => Err(format!("Unsupported platform: {}", platform)),
    };

    // 如果所有尝试都失败，回退到默认浏览器
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            log_error(&format!(
                "[Browser] Private mode failed: {}, using default browser",
                e
            ));
            app.opener()
                .open_url(&url, None::<&str>)
                .map_err(|e| format!("Failed to open URL: {}", e))
        }
    }
}

/// 检测 Windows 默认浏览器
fn detect_windows_default_browser() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // 尝试从注册表读取默认浏览器
        let output = Command::new("reg")
            .args(&[
                "query",
                "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice",
                "/v",
                "ProgId"
            ])
            .output();

        if let Ok(output) = output {
            let stdout = crate::utils::encoding::decode_console_output(&output.stdout);

            if stdout.contains("ChromeHTML") || stdout.contains("Google") {
                return "chrome".to_string();
            }
            if stdout.contains("MSEdgeHTM") || stdout.contains("Edge") {
                return "msedge".to_string();
            }
            if stdout.contains("FirefoxURL") || stdout.contains("Firefox") {
                return "firefox".to_string();
            }
            if stdout.contains("BraveHTML") || stdout.contains("Brave") {
                return "brave".to_string();
            }
            if stdout.contains("Opera") {
                return "opera".to_string();
            }
        }
    }

    "unknown".to_string()
}

/// 获取浏览器的隐私模式参数
fn get_browser_private_flag(browser: &str) -> &'static str {
    match browser {
        "chrome" => "--incognito",
        "msedge" => "-inprivate",
        "firefox" => "-private-window",
        "brave" => "--incognito",
        "opera" => "--private",
        _ => "--incognito",
    }
}

/// Get Kiro platform version
pub fn get_kiro_version() -> Option<String> {
    use crate::utils::encoding::decode_console_output;
    use crate::utils::logger::{log_debug, log_info};
    use std::process::Command;

    log_debug("Checking Kiro version");

    // 尝试直接执行命令获取版本
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", "kiro --version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = { Command::new("sh").arg("-c").arg("kiro --version").output() };

    match output {
        Ok(out) => {
            let stdout = decode_console_output(&out.stdout).trim().to_string();
            let stderr = decode_console_output(&out.stderr).trim().to_string();

            log_info(&format!(
                "Kiro command executed - status: {}, stdout: '{}', stderr: '{}'",
                out.status, stdout, stderr
            ));

            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if !raw.is_empty() {
                    let version = extract_version(raw);
                    log_debug(&format!("Kiro version extracted: {}", version));
                    return Some(version);
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                log_info(&format!("Kiro command failed: {}", err));
            }
        }
        Err(e) => {
            log_info(&format!("Failed to execute kiro command: {}", e));
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
