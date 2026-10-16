use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use crate::utils::logger::{log_debug, log_info};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlatformVersion {
    pub platform: String,
    pub installed: bool,
    pub version: Option<String>,
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AntigravityPathInfo {
    pub configured_path: Option<String>,
    pub detected_path: Option<String>,
    pub effective_path: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalPlatformPathInfo {
    pub platform: String,
    pub name: String,
    pub kind: String,
    pub configured_path: Option<String>,
    pub detected_path: Option<String>,
    pub effective_path: Option<String>,
    pub exists: bool,
    pub version: Option<String>,
}

fn build_antigravity_path_info() -> Result<AntigravityPathInfo, String> {
    let configured_path = crate::utils::config::get_config_string("antigravity_executable")?;
    let detected_path = crate::utils::process::get_antigravity_executable_path()
        .map(|path| path.to_string_lossy().to_string());

    let configured_existing_path = configured_path
        .clone()
        .filter(|path| PathBuf::from(path).exists());
    let effective_path = configured_existing_path.or_else(|| detected_path.clone());
    let exists = effective_path.is_some();

    Ok(AntigravityPathInfo {
        configured_path,
        detected_path,
        effective_path,
        exists,
    })
}

fn existing_string_path(path: Result<PathBuf, String>) -> Option<String> {
    path.ok()
        .filter(|current| current.exists())
        .map(|current| current.to_string_lossy().to_string())
}

fn build_local_platform_path_info(platform: &str) -> Result<LocalPlatformPathInfo, String> {
    use crate::commands::{
        antigravity, buddy, cursor, github_copilot, qoder, state_db, trae, windsurf,
    };

    match platform {
        "antigravity" => {
            let info = build_antigravity_path_info()?;
            Ok(LocalPlatformPathInfo {
                platform: "antigravity".to_string(),
                name: "Antigravity".to_string(),
                kind: "executable".to_string(),
                configured_path: info.configured_path,
                detected_path: info.detected_path,
                effective_path: info.effective_path,
                exists: info.exists,
                version: if info.exists {
                    antigravity::get_antigravity_version()
                } else {
                    None
                },
            })
        }
        "cursor" => {
            let configured_path = crate::utils::config::get_config_string(state_db::CURSOR_APP.config_key)?;
            let detected_path = existing_string_path(state_db::resolve_default_state_db_path(
                state_db::CURSOR_APP,
            ));
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "cursor".to_string(),
                name: "Cursor".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: if exists {
                    cursor::get_cursor_version()
                } else {
                    None
                },
            })
        }
        "windsurf" => {
            let configured_path =
                crate::utils::config::get_config_string(state_db::WINDSURF_APP.config_key)?;
            let detected_path = existing_string_path(state_db::resolve_default_state_db_path(
                state_db::WINDSURF_APP,
            ));
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "windsurf".to_string(),
                name: "Windsurf".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: if exists {
                    windsurf::get_windsurf_version()
                } else {
                    None
                },
            })
        }
        "github-copilot" => {
            let configured_path = crate::utils::config::get_config_string(
                github_copilot::GITHUB_COPILOT_STATE_DB_CONFIG_KEY,
            )?;
            let detected_path = existing_string_path(github_copilot::detect_vscode_state_db_path());
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "github-copilot".to_string(),
                name: "GitHub Copilot".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: if exists {
                    github_copilot::get_github_copilot_version()
                } else {
                    None
                },
            })
        }
        "codebuddy" => {
            let configured_path =
                crate::utils::config::get_config_string(buddy::CODEBUDDY_STATE_DB_CONFIG_KEY)?;
            let detected_path = existing_string_path(buddy::detect_buddy_state_db_path("codebuddy"));
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "codebuddy".to_string(),
                name: "CodeBuddy".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: None,
            })
        }
        "codebuddy_cn" => {
            let configured_path =
                crate::utils::config::get_config_string(buddy::CODEBUDDY_CN_STATE_DB_CONFIG_KEY)?;
            let detected_path =
                existing_string_path(buddy::detect_buddy_state_db_path("codebuddy_cn"));
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "codebuddy_cn".to_string(),
                name: "CodeBuddy CN".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: None,
            })
        }
        "workbuddy" => {
            let configured_path =
                crate::utils::config::get_config_string(buddy::WORKBUDDY_STATE_DB_CONFIG_KEY)?;
            let detected_path =
                existing_string_path(buddy::detect_buddy_state_db_path("workbuddy"));
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "workbuddy".to_string(),
                name: "WorkBuddy".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: None,
            })
        }
        "qoder" => {
            let configured_path =
                crate::utils::config::get_config_string(qoder::QODER_STATE_DB_CONFIG_KEY)?;
            let detected_path = existing_string_path(qoder::detect_qoder_state_db_path());
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "qoder".to_string(),
                name: "Qoder".to_string(),
                kind: "database".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: None,
            })
        }
        "trae" => {
            let configured_path =
                crate::utils::config::get_config_string(trae::TRAE_STORAGE_PATH_CONFIG_KEY)?;
            let detected_path = existing_string_path(trae::detect_trae_storage_path());
            let effective_path = configured_path
                .clone()
                .filter(|path| PathBuf::from(path).exists())
                .or_else(|| detected_path.clone());
            let exists = effective_path.is_some();

            Ok(LocalPlatformPathInfo {
                platform: "trae".to_string(),
                name: "Trae".to_string(),
                kind: "storage".to_string(),
                configured_path,
                detected_path,
                effective_path,
                exists,
                version: None,
            })
        }
        _ => Err(format!("Unsupported platform path management target: {}", platform)),
    }
}

fn platform_path_config_key(platform: &str) -> Result<&'static str, String> {
    use crate::commands::{buddy, github_copilot, qoder, state_db, trae};

    match platform {
        "antigravity" => Ok("antigravity_executable"),
        "cursor" => Ok(state_db::CURSOR_APP.config_key),
        "windsurf" => Ok(state_db::WINDSURF_APP.config_key),
        "github-copilot" => Ok(github_copilot::GITHUB_COPILOT_STATE_DB_CONFIG_KEY),
        "codebuddy" => Ok(buddy::CODEBUDDY_STATE_DB_CONFIG_KEY),
        "codebuddy_cn" => Ok(buddy::CODEBUDDY_CN_STATE_DB_CONFIG_KEY),
        "workbuddy" => Ok(buddy::WORKBUDDY_STATE_DB_CONFIG_KEY),
        "qoder" => Ok(qoder::QODER_STATE_DB_CONFIG_KEY),
        "trae" => Ok(trae::TRAE_STORAGE_PATH_CONFIG_KEY),
        _ => Err(format!("Unsupported platform path management target: {}", platform)),
    }
}

#[tauri::command]
pub async fn get_antigravity_path_info(_app: AppHandle) -> Result<AntigravityPathInfo, String> {
    build_antigravity_path_info()
}

#[tauri::command]
pub async fn detect_antigravity_executable(_app: AppHandle) -> Result<Option<String>, String> {
    Ok(crate::utils::process::get_antigravity_executable_path()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn select_antigravity_executable(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();

    #[cfg(target_os = "windows")]
    {
        dialog = dialog.add_filter("Executable", &["exe"]);
    }

    #[cfg(target_os = "macos")]
    {
        dialog = dialog.add_filter("Application", &["app"]);
    }

    let result = dialog
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    Ok(result.map(|path| path.to_string()))
}

#[tauri::command]
pub async fn set_antigravity_executable_path(
    _app: AppHandle,
    path: String,
) -> Result<AntigravityPathInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let path_buf = PathBuf::from(trimmed);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", trimmed));
    }

    crate::utils::config::update_antigravity_path(trimmed.to_string())?;
    build_antigravity_path_info()
}

#[tauri::command]
pub async fn clear_antigravity_executable_path(
    _app: AppHandle,
) -> Result<AntigravityPathInfo, String> {
    crate::utils::config::set_config_string("antigravity_executable", None)?;
    build_antigravity_path_info()
}

#[tauri::command]
pub async fn get_local_platform_path_infos(
    _app: AppHandle,
) -> Result<Vec<LocalPlatformPathInfo>, String> {
    [
        "antigravity",
        "cursor",
        "windsurf",
        "github-copilot",
        "codebuddy",
        "codebuddy_cn",
        "workbuddy",
        "qoder",
        "trae",
    ]
        .iter()
        .map(|platform| build_local_platform_path_info(platform))
        .collect()
}

#[tauri::command]
pub async fn detect_local_platform_path(
    _app: AppHandle,
    platform: String,
) -> Result<Option<String>, String> {
    Ok(build_local_platform_path_info(&platform)?.detected_path)
}

#[tauri::command]
pub async fn select_local_platform_path(
    app: AppHandle,
    platform: String,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();

    match platform.as_str() {
        "antigravity" => {
            #[cfg(target_os = "windows")]
            {
                dialog = dialog.add_filter("Executable", &["exe"]);
            }

            #[cfg(target_os = "macos")]
            {
                dialog = dialog.add_filter("Application", &["app"]);
            }
        }
        "cursor" | "windsurf" | "github-copilot" | "codebuddy" | "codebuddy_cn" | "workbuddy"
        | "qoder" => {
            dialog = dialog.add_filter("State DB", &["vscdb"]);
        }
        "trae" => {
            dialog = dialog.add_filter("Storage JSON", &["json"]);
        }
        _ => return Err(format!("Unsupported platform path management target: {}", platform)),
    }

    let result = dialog
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    Ok(result.map(|path| path.to_string()))
}

#[tauri::command]
pub async fn set_local_platform_path(
    _app: AppHandle,
    platform: String,
    path: String,
) -> Result<LocalPlatformPathInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let path_buf = PathBuf::from(trimmed);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", trimmed));
    }

    crate::utils::config::set_config_string(
        platform_path_config_key(&platform)?,
        Some(trimmed.to_string()),
    )?;

    build_local_platform_path_info(&platform)
}

#[tauri::command]
pub async fn clear_local_platform_path(
    _app: AppHandle,
    platform: String,
) -> Result<LocalPlatformPathInfo, String> {
    crate::utils::config::set_config_string(platform_path_config_key(&platform)?, None)?;
    build_local_platform_path_info(&platform)
}

#[tauri::command]
pub async fn get_platform_versions(_app: AppHandle) -> Result<Vec<PlatformVersion>, String> {
    use crate::commands::{
        antigravity, claude, codex, cursor, gemini, github_copilot, kiro, windsurf,
    };

    log_debug("检查平台安装状态和版本");

    let mut versions = Vec::new();
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;

    // Claude
    let claude_path = home.join(".claude").join("settings.json");
    let claude_installed = claude_path.exists();
    versions.push(PlatformVersion {
        platform: "claude".to_string(),
        installed: claude_installed,
        version: if claude_installed {
            claude::get_claude_version()
        } else {
            None
        },
    });

    // Codex
    let codex_path = home.join(".codex");
    let codex_installed = codex_path.exists()
        && (codex_path.join("config.toml").exists() || codex_path.join("auth.json").exists());
    versions.push(PlatformVersion {
        platform: "codex".to_string(),
        installed: codex_installed,
        version: if codex_installed {
            codex::get_codex_version()
        } else {
            None
        },
    });

    // Cursor
    let cursor_installed = build_local_platform_path_info("cursor")?.exists;
    versions.push(PlatformVersion {
        platform: "cursor".to_string(),
        installed: cursor_installed,
        version: if cursor_installed {
            cursor::get_cursor_version()
        } else {
            None
        },
    });

    // Windsurf
    let windsurf_installed = build_local_platform_path_info("windsurf")?.exists;
    versions.push(PlatformVersion {
        platform: "windsurf".to_string(),
        installed: windsurf_installed,
        version: if windsurf_installed {
            windsurf::get_windsurf_version()
        } else {
            None
        },
    });

    // GitHub Copilot
    let github_copilot_installed = build_local_platform_path_info("github-copilot")?.exists;
    versions.push(PlatformVersion {
        platform: "github-copilot".to_string(),
        installed: github_copilot_installed,
        version: if github_copilot_installed {
            github_copilot::get_github_copilot_version()
        } else {
            None
        },
    });

    let codebuddy_installed = build_local_platform_path_info("codebuddy")?.exists;
    versions.push(PlatformVersion {
        platform: "codebuddy".to_string(),
        installed: codebuddy_installed,
        version: None,
    });

    let codebuddy_cn_installed = build_local_platform_path_info("codebuddy_cn")?.exists;
    versions.push(PlatformVersion {
        platform: "codebuddy_cn".to_string(),
        installed: codebuddy_cn_installed,
        version: None,
    });

    let workbuddy_installed = build_local_platform_path_info("workbuddy")?.exists;
    versions.push(PlatformVersion {
        platform: "workbuddy".to_string(),
        installed: workbuddy_installed,
        version: None,
    });

    let qoder_installed = build_local_platform_path_info("qoder")?.exists;
    versions.push(PlatformVersion {
        platform: "qoder".to_string(),
        installed: qoder_installed,
        version: None,
    });

    let trae_installed = build_local_platform_path_info("trae")?.exists;
    versions.push(PlatformVersion {
        platform: "trae".to_string(),
        installed: trae_installed,
        version: None,
    });

    // Gemini
    let gemini_path = home.join(".gemini");
    let gemini_installed = gemini_path.exists()
        && (gemini_path.join(".env").exists()
            || gemini_path.join("config.json").exists()
            || gemini_path.join("settings.json").exists());
    versions.push(PlatformVersion {
        platform: "gemini".to_string(),
        installed: gemini_installed,
        version: if gemini_installed {
            gemini::get_gemini_version()
        } else {
            None
        },
    });

    // Kiro
    let kiro_path = home.join(".kiro");
    let sso_cache = home.join(".aws").join("sso").join("cache");
    let kiro_token_path = sso_cache.join("kiro-auth-token.json");
    let kiro_installed = kiro_path.exists() || kiro_token_path.exists();
    versions.push(PlatformVersion {
        platform: "kiro".to_string(),
        installed: kiro_installed,
        version: if kiro_installed {
            kiro::get_kiro_version()
        } else {
            None
        },
    });

    // Antigravity
    let antigravity_installed = build_local_platform_path_info("antigravity")?.exists;
    versions.push(PlatformVersion {
        platform: "antigravity".to_string(),
        installed: antigravity_installed,
        version: if antigravity_installed {
            antigravity::get_antigravity_version()
        } else {
            None
        },
    });

    log_info(&format!("平台版本检查完成: {:?}", versions));
    Ok(versions)
}
