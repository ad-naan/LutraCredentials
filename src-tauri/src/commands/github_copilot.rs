use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use aes_gcm::aead::generic_array::GenericArray;
#[cfg(target_os = "windows")]
use aes_gcm::aead::Aead;
#[cfg(target_os = "windows")]
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
#[cfg(target_os = "windows")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LocalFree, HLOCAL};
#[cfg(target_os = "windows")]
use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

struct VsCodeCandidate {
    display_name: &'static str,
    dir_name: &'static str,
    cli_command: &'static str,
}

const VSCODE_CANDIDATES: [VsCodeCandidate; 3] = [
    VsCodeCandidate {
        display_name: "VS Code",
        dir_name: "Code",
        cli_command: "code",
    },
    VsCodeCandidate {
        display_name: "VS Code Insiders",
        dir_name: "Code - Insiders",
        cli_command: "code-insiders",
    },
    VsCodeCandidate {
        display_name: "VSCodium",
        dir_name: "VSCodium",
        cli_command: "codium",
    },
];

struct VsCodeInstallation {
    candidate: &'static VsCodeCandidate,
    user_data_root: PathBuf,
    state_db_path: PathBuf,
}

pub const GITHUB_COPILOT_STATE_DB_CONFIG_KEY: &str = "github_copilot_state_db_path";

fn get_env_path(keys: &[&str]) -> Option<PathBuf> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

fn get_user_data_root_candidates() -> Vec<(&'static VsCodeCandidate, PathBuf)> {
    if let Some(root) = get_env_path(&["GITHUB_COPILOT_USER_DATA_DIR", "VSCODE_USER_DATA_DIR"]) {
        return vec![(&VSCODE_CANDIDATES[0], root)];
    }

    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            for candidate in &VSCODE_CANDIDATES {
                candidates.push((candidate, PathBuf::from(&appdata).join(candidate.dir_name)));
            }
            return candidates;
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home_dir) = dirs::home_dir() {
        for candidate in &VSCODE_CANDIDATES {
            candidates.push((
                candidate,
                home_dir
                    .join("Library")
                    .join("Application Support")
                    .join(candidate.dir_name),
            ));
        }
        return candidates;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    if let Some(home_dir) = dirs::home_dir() {
        for candidate in &VSCODE_CANDIDATES {
            candidates.push((candidate, home_dir.join(".config").join(candidate.dir_name)));
        }
    }

    candidates
}

fn state_db_path_from_root(user_data_root: &Path) -> PathBuf {
    user_data_root
        .join("User")
        .join("globalStorage")
        .join("state.vscdb")
}

fn local_state_path_from_root(user_data_root: &Path) -> PathBuf {
    user_data_root.join("Local State")
}

fn installation_from_state_db_path(db_path: PathBuf) -> Result<VsCodeInstallation, String> {
    let user_data_root = db_path
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "Cannot determine VS Code user data root from {}",
                db_path.display()
            )
        })?;

    Ok(VsCodeInstallation {
        candidate: &VSCODE_CANDIDATES[0],
        user_data_root,
        state_db_path: db_path,
    })
}

fn detect_vscode_installation() -> Result<VsCodeInstallation, String> {
    if let Some(db_path) = get_env_path(&["GITHUB_COPILOT_STATE_DB_PATH", "VSCODE_STATE_DB_PATH"]) {
        return installation_from_state_db_path(db_path);
    }

    for (candidate, user_data_root) in get_user_data_root_candidates() {
        let state_db_path = state_db_path_from_root(&user_data_root);
        if state_db_path.exists() {
            return Ok(VsCodeInstallation {
                candidate,
                user_data_root,
                state_db_path,
            });
        }
    }

    Err("VS Code state database not found".to_string())
}

fn resolve_vscode_installation() -> Result<VsCodeInstallation, String> {
    if let Some(configured_path) =
        crate::utils::config::get_config_string(GITHUB_COPILOT_STATE_DB_CONFIG_KEY)?
    {
        return installation_from_state_db_path(PathBuf::from(configured_path));
    }

    detect_vscode_installation()
}

pub fn detect_vscode_state_db_path() -> Result<PathBuf, String> {
    Ok(detect_vscode_installation()?.state_db_path)
}

fn read_string_item(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read VS Code item '{}': {}", key, error))
}

fn decode_buffer_data(buffer: &Value) -> Result<Vec<u8>, String> {
    let data = buffer
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Secret storage payload is not a Buffer".to_string())?;

    data.iter()
        .enumerate()
        .map(|(index, value)| {
            value
                .as_u64()
                .ok_or_else(|| format!("Secret storage byte at index {} is invalid", index))
                .and_then(|number| {
                    if number > 255 {
                        Err(format!(
                            "Secret storage byte at index {} is out of range",
                            index
                        ))
                    } else {
                        Ok(number as u8)
                    }
                })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn get_windows_encryption_key(user_data_root: &Path) -> Result<Vec<u8>, String> {
    let local_state_path = local_state_path_from_root(user_data_root);
    let local_state = std::fs::read_to_string(&local_state_path).map_err(|error| {
        format!(
            "Failed to read VS Code Local State '{}': {}",
            local_state_path.display(),
            error
        )
    })?;

    let parsed: Value = serde_json::from_str(&local_state)
        .map_err(|error| format!("Failed to parse VS Code Local State JSON: {}", error))?;

    let encrypted_key = parsed["os_crypt"]["encrypted_key"]
        .as_str()
        .ok_or_else(|| "Cannot find os_crypt.encrypted_key in Local State".to_string())?;

    let bytes = general_purpose::STANDARD
        .decode(encrypted_key)
        .map_err(|error| format!("Failed to decode encrypted_key: {}", error))?;

    if bytes.len() < 6 || &bytes[..5] != b"DPAPI" {
        return Err("VS Code encrypted_key is not a DPAPI payload".to_string());
    }

    dpapi_decrypt(&bytes[5..])
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|_| "DPAPI CryptUnprotectData failed".to_string())?;

        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(HLOCAL(output.pbData as *mut _));
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn decrypt_windows_secret_payload(
    user_data_root: &Path,
    encrypted: &[u8],
) -> Result<Vec<u8>, String> {
    if encrypted.len() < 31 || &encrypted[..3] != b"v10" {
        return Err("Unsupported VS Code secret payload format".to_string());
    }

    let key = get_windows_encryption_key(user_data_root)?;
    let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));
    let nonce = Nonce::from_slice(&encrypted[3..15]);
    cipher
        .decrypt(nonce, &encrypted[15..])
        .map_err(|error| format!("Failed to decrypt VS Code secret payload: {}", error))
}

fn decode_secret_storage_value(user_data_root: &Path, raw_value: &str) -> Result<String, String> {
    let parsed: Value = serde_json::from_str(raw_value).unwrap_or_else(|_| json!(raw_value));

    if parsed.is_array() {
        return Ok(raw_value.to_string());
    }

    if let Some(value) = parsed.as_str() {
        return Ok(value.to_string());
    }

    if parsed.get("data").is_some() {
        let encrypted = decode_buffer_data(&parsed)?;

        #[cfg(target_os = "windows")]
        {
            let decrypted = decrypt_windows_secret_payload(user_data_root, &encrypted)?;
            return String::from_utf8(decrypted)
                .map_err(|error| format!("VS Code secret payload is not valid UTF-8: {}", error));
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = (user_data_root, encrypted);
            return Err("GitHub Copilot local import currently supports Windows only".to_string());
        }
    }

    Err("Unsupported VS Code secret storage value".to_string())
}

fn load_github_auth_sessions(user_data_root: &Path, raw_value: &str) -> Result<Vec<Value>, String> {
    let decoded = decode_secret_storage_value(user_data_root, raw_value)?;
    serde_json::from_str(&decoded).map_err(|error| {
        format!(
            "Decrypted github.auth is not a valid sessions array: {}",
            error
        )
    })
}

fn resolve_copilot_session(sessions: &[Value]) -> Option<&Value> {
    sessions
        .iter()
        .find(|session| {
            session["scopes"]
                .as_array()
                .map(|scopes| {
                    scopes
                        .iter()
                        .any(|scope| scope.as_str() == Some("user:email"))
                })
                .unwrap_or(false)
        })
        .or_else(|| sessions.first())
}

#[tauri::command]
pub async fn get_github_copilot_config(_app: AppHandle) -> Result<Value, String> {
    let installation = resolve_vscode_installation()?;
    let connection = Connection::open(&installation.state_db_path).map_err(|error| {
        format!(
            "Failed to open VS Code database '{}': {}",
            installation.state_db_path.display(),
            error
        )
    })?;

    let secret_key =
        r#"secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}"#;
    let github_auth_raw = read_string_item(&connection, secret_key)?
        .ok_or_else(|| "No github.auth secret found in local VS Code database".to_string())?;
    let sessions = load_github_auth_sessions(&installation.user_data_root, &github_auth_raw)?;
    let session = resolve_copilot_session(&sessions)
        .ok_or_else(|| "No GitHub auth session found in VS Code".to_string())?;

    let login = read_string_item(&connection, "github.copilot-github")?
        .or_else(|| {
            session["account"]["label"]
                .as_str()
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| "github-copilot".to_string());
    let github_user_id = session["account"]["id"]
        .as_str()
        .map(|value| value.to_string())
        .or_else(|| {
            session["account"]["id"]
                .as_i64()
                .map(|value| value.to_string())
        });
    let github_access_token = session["accessToken"]
        .as_str()
        .ok_or_else(|| "No access token found in github.auth session".to_string())?;

    Ok(json!({
        "email": login,
        "login": login,
        "providerId": "Copilot",
        "githubUserId": github_user_id,
        "githubAccessToken": github_access_token,
        "session": session,
        "sessions": sessions,
        "source": "local",
        "vscodeVariant": installation.candidate.display_name,
        "localPath": installation.state_db_path.to_string_lossy().to_string(),
        "userDataRoot": installation.user_data_root.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn github_copilot_import_from_local(app: AppHandle) -> Result<Value, String> {
    get_github_copilot_config(app).await
}

pub fn get_github_copilot_version() -> Option<String> {
    use crate::commands::state_db::extract_version;
    use std::process::Command;

    for candidate in &VSCODE_CANDIDATES {
        #[cfg(target_os = "windows")]
        let output = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            Command::new("cmd")
                .args(["/C", &format!("{} --version", candidate.cli_command)])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        };

        #[cfg(not(target_os = "windows"))]
        let output = Command::new("sh")
            .arg("-c")
            .arg(format!("{} --version", candidate.cli_command))
            .output();

        if let Ok(result) = output {
            if result.status.success() {
                let stdout = crate::utils::encoding::decode_console_output(&result.stdout).trim().to_string();
                let stderr = crate::utils::encoding::decode_console_output(&result.stderr).trim().to_string();
                let raw = if stdout.is_empty() { stderr } else { stdout };

                if !raw.is_empty() {
                    return Some(extract_version(raw.lines().next().unwrap_or(&raw)));
                }
            }
        }
    }

    None
}
