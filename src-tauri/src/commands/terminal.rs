use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalSession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type TerminalMap = Arc<Mutex<HashMap<String, TerminalSession>>>;

#[tauri::command]
pub async fn spawn_terminal(
    cwd: String,
    app: AppHandle,
    terminals: State<'_, TerminalMap>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            "/bin/sh".to_string()
        }
    });

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);

    let child = pair.slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pair.master
        .take_writer()
        .map_err(|e| e.to_string())?;

    let mut reader = pair.master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let terminal_id = id.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        &format!("terminal-output-{}", terminal_id),
                        data,
                    );
                }
                Err(_) => break,
            }
        }
    });

    terminals
        .lock()
        .unwrap()
        .insert(
            id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );

    Ok(id)
}

#[tauri::command]
pub fn write_terminal(
    id: String,
    data: String,
    terminals: State<'_, TerminalMap>,
) -> Result<(), String> {
    let mut map = terminals.lock().unwrap();
    if let Some(session) = map.get_mut(&id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    id: String,
    cols: u16,
    rows: u16,
    terminals: State<'_, TerminalMap>,
) -> Result<(), String> {
    let map = terminals.lock().unwrap();
    if let Some(session) = map.get(&id) {
        session
            .master
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
pub fn kill_terminal(
    id: String,
    terminals: State<'_, TerminalMap>,
) -> Result<(), String> {
    if let Some(mut session) = terminals.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
