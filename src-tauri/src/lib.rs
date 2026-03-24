use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use tauri::{Emitter, State};
use std::thread;

struct PtyState {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    master: Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
}

#[tauri::command]
fn spawn_pty(app_handle: tauri::AppHandle, state: State<'_, PtyState>) -> Result<(), String> {
    let pty_system = native_pty_system();
    
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let default_shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    };

    let cmd = CommandBuilder::new(default_shell);
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Drop slave as we don't need it on the master side
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut state_writer = state.writer.lock().unwrap();
        *state_writer = Some(writer);
        
        let mut state_master = state.master.lock().unwrap();
        *state_master = Some(pair.master);
    }

    // Spawn thread to read from pty and emit to frontend
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("pty-output", text);
                }
                _ => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn write_pty(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    let mut writer_guard = state.writer.lock().unwrap();
    if let Some(writer) = writer_guard.as_mut() {
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_pty(state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let master_guard = state.master.lock().unwrap();
    if let Some(master) = master_guard.as_ref() {
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(PtyState {
            writer: Arc::new(Mutex::new(None)),
            master: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![spawn_pty, write_pty, resize_pty])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
