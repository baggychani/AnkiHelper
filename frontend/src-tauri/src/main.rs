#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, path::PathBuf, process::{Child, Command}, sync::Mutex};
use tauri::{Manager, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

fn project_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().ok()
}

fn start_backend() -> Child {
    let bundled = env::current_exe().ok()
        .and_then(|path| path.parent().map(|parent| parent.join("anki-helper-backend.exe")));
    if let Some(sidecar) = bundled.filter(|path| path.is_file()) {
        return Command::new(sidecar)
            .spawn()
            .expect("Could not start the bundled Python engine");
    }

    let root = project_root().expect("workspace root");
    let python = root.join(".venv").join("Scripts").join("python.exe");
    let mut command = if python.exists() { Command::new(python) } else { Command::new("py") };
    command
        .args(["-m", "uvicorn", "anki_helper.backend:app", "--host", "127.0.0.1", "--port", "8765"])
        .current_dir(&root)
        .env("PYTHONPATH", root.join("src"))
        .spawn()
        .expect("Could not start the local Python engine")
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(BackendProcess(Mutex::new(Some(start_backend()))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Anki Helper");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(process) = handle.try_state::<BackendProcess>() {
                if let Ok(mut child) = process.0.lock() {
                    if let Some(mut child) = child.take() { let _ = child.kill(); }
                }
            }
        }
    });
}
