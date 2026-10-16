// Show console window in debug mode for logging
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lutra_credentials_lib::run()
}
