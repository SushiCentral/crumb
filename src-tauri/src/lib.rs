mod commands;
use commands::fs::*;
use commands::terminal::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminals: commands::terminal::TerminalMap =
        Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(terminals)
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_dir,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
