use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, State};

struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    process_id: Option<u32>,
}

struct PtyState {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Clone, serde::Serialize)]
struct PtyPayload {
    id: String,
    data: String,
}

#[tauri::command]
fn get_available_shells() -> Result<Vec<String>, String> {
    #[cfg(unix)]
    {
        if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
            let shells: Vec<String> = contents
                .lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .collect();
            if !shells.is_empty() {
                return Ok(shells);
            }
        }
    }

    #[cfg(windows)]
    return Ok(vec!["powershell.exe".to_string(), "cmd.exe".to_string()]);

    #[cfg(not(windows))]
    Ok(vec![
        "/bin/sh".to_string(),
        "/bin/bash".to_string(),
        "/bin/zsh".to_string(),
    ])
}

#[tauri::command]
fn spawn_pty(
    id: String,
    rows: u16,
    cols: u16,
    shell: Option<String>,
    cwd: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let default_shell = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
        }
    });

    let mut cmd = CommandBuilder::new(default_shell);
    cmd.env("TERM", "xterm-256color");
    if let Some(directory) = cwd {
        if !std::path::Path::new(&directory).is_dir() {
            return Err(format!("Terminal directory is unavailable: {directory}"));
        }
        cmd.cwd(directory);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let process_id = child.process_id();

    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(
            id.clone(),
            PtySession {
                writer: Arc::new(Mutex::new(writer)),
                master: Arc::new(Mutex::new(pair.master)),
                process_id,
            },
        );
    }

    let thread_id = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 2048];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        "pty-output",
                        PtyPayload {
                            id: thread_id.clone(),
                            data: text,
                        },
                    );
                }
                _ => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn get_pty_cwd(id: String, state: State<'_, PtyState>) -> Result<String, String> {
    let process_id = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .and_then(|session| session.process_id)
        .ok_or_else(|| "The selected terminal is not running yet.".to_string())?;

    #[cfg(target_os = "linux")]
    {
        return std::fs::read_link(format!("/proc/{process_id}/cwd"))
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| format!("Could not read the terminal directory: {e}"));
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("lsof")
            .args(["-a", "-p", &process_id.to_string(), "-d", "cwd", "-Fn"])
            .output()
            .map_err(|e| format!("Could not read the terminal directory: {e}"))?;
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.strip_prefix('n'))
            {
                return Ok(path.to_string());
            }
        }
        return Err("Could not read the terminal directory.".to_string());
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = process_id;
        Err("Opening the terminal directory is not supported on this platform yet.".to_string())
    }
}

#[tauri::command]
fn write_pty(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&id) {
        let mut writer_guard = session.writer.lock().unwrap();
        writer_guard
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_pty(id: String, rows: u16, cols: u16, state: State<'_, PtyState>) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&id) {
        let master_guard = session.master.lock().unwrap();
        master_guard
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn kill_pty(id: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PtyState {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            get_pty_cwd,
            get_available_shells
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
