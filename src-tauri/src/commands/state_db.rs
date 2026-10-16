use rusqlite::{params, types::ValueRef, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use std::env;
use std::path::PathBuf;

#[derive(Clone, Copy)]
pub struct StateDbApp {
    pub display_name: &'static str,
    pub dir_name: &'static str,
    pub env_var: &'static str,
    pub cli_command: &'static str,
    pub config_key: &'static str,
}

pub const CURSOR_APP: StateDbApp = StateDbApp {
    display_name: "Cursor",
    dir_name: "Cursor",
    env_var: "CURSOR_STATE_DB_PATH",
    cli_command: "cursor",
    config_key: "cursor_state_db_path",
};

pub const WINDSURF_APP: StateDbApp = StateDbApp {
    display_name: "Windsurf",
    dir_name: "Windsurf",
    env_var: "WINDSURF_STATE_DB_PATH",
    cli_command: "windsurf",
    config_key: "windsurf_state_db_path",
};

pub fn resolve_default_state_db_path(app: StateDbApp) -> Result<PathBuf, String> {
    if let Ok(env_path) = env::var(app.env_var) {
        return Ok(PathBuf::from(env_path));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            return Ok(PathBuf::from(appdata)
                .join(app.dir_name)
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"));
        }
    }

    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    #[cfg(target_os = "macos")]
    {
        return Ok(home_dir
            .join("Library")
            .join("Application Support")
            .join(app.dir_name)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"));
    }

    #[cfg(target_os = "windows")]
    {
        return Ok(home_dir
            .join("AppData")
            .join("Roaming")
            .join(app.dir_name)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(home_dir
            .join(".config")
            .join(app.dir_name)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"))
    }
}

pub fn resolve_state_db_path(app: StateDbApp) -> Result<PathBuf, String> {
    if let Some(config_path) = crate::utils::config::get_config_string(app.config_key)? {
        return Ok(PathBuf::from(config_path));
    }

    resolve_default_state_db_path(app)
}

pub fn open_state_db(app: StateDbApp) -> Result<(Connection, PathBuf), String> {
    let db_path = resolve_state_db_path(app)?;
    if !db_path.exists() {
        return Err(format!(
            "{} state database not found: {}",
            app.display_name,
            db_path.display()
        ));
    }

    let connection = Connection::open(&db_path).map_err(|error| {
        format!(
            "Failed to open {} state database: {}",
            app.display_name, error
        )
    })?;

    Ok((connection, db_path))
}

pub fn get_item_value(
    connection: &Connection,
    key: &str,
    display_name: &str,
) -> Result<Option<String>, String> {
    let value = connection
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            params![key],
            |row| match row.get_ref(0)? {
                ValueRef::Null => Ok(String::new()),
                ValueRef::Text(text) => Ok(String::from_utf8_lossy(text).to_string()),
                ValueRef::Blob(blob) => Ok(String::from_utf8_lossy(blob).to_string()),
                ValueRef::Integer(number) => Ok(number.to_string()),
                ValueRef::Real(number) => Ok(number.to_string()),
            },
        )
        .optional()
        .map_err(|error| format!("Failed to read {} item '{}': {}", display_name, key, error))?;

    Ok(value.filter(|current| !current.trim().is_empty()))
}

pub fn set_item_value(
    transaction: &Transaction<'_>,
    key: &str,
    value: Option<&str>,
    display_name: &str,
) -> Result<(), String> {
    match value.map(str::trim).filter(|current| !current.is_empty()) {
        Some(current) => {
            transaction
                .execute(
                    "INSERT INTO ItemTable(key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, current],
                )
                .map_err(|error| {
                    format!("Failed to write {} item '{}': {}", display_name, key, error)
                })?;
        }
        None => {
            transaction
                .execute("DELETE FROM ItemTable WHERE key = ?1", params![key])
                .map_err(|error| {
                    format!("Failed to clear {} item '{}': {}", display_name, key, error)
                })?;
        }
    }

    Ok(())
}

pub fn find_string_recursive(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(|item| item.as_str()) {
                    let trimmed = found.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }

            map.values()
                .find_map(|item| find_string_recursive(item, keys))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_string_recursive(item, keys)),
        _ => None,
    }
}

pub fn extract_version(raw: &str) -> String {
    use once_cell::sync::Lazy;
    use regex::Regex;

    static VERSION_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\d+\.\d+\.\d+(-[\w.]+)?").expect("Invalid version regex"));

    VERSION_RE
        .find(raw)
        .map(|matched| matched.as_str().to_string())
        .unwrap_or_else(|| raw.to_string())
}

pub fn get_cli_version(app: StateDbApp) -> Option<String> {
    use crate::utils::encoding::decode_console_output;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        Command::new("cmd")
            .args(["/C", &format!("{} --version", app.cli_command)])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!("{} --version", app.cli_command))
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let stdout = decode_console_output(&result.stdout).trim().to_string();
            let stderr = decode_console_output(&result.stderr).trim().to_string();
            let raw = if stdout.is_empty() { stderr } else { stdout };

            if raw.is_empty() {
                None
            } else {
                Some(extract_version(&raw))
            }
        }
        _ => None,
    }
}
