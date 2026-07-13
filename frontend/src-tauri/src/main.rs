#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, path::PathBuf, process::{Child, Command}, sync::Mutex};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

enum ManagedBackend {
    Sidecar(CommandChild),
    Dev(Child),
}

struct BackendProcess(Mutex<Option<ManagedBackend>>);

fn project_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().ok()
}

fn spawn_dev_backend() -> Child {
    let root = project_root().expect("workspace root");
    let python = root.join(".venv").join("Scripts").join("python.exe");
    let mut command = if python.exists() {
        Command::new(python)
    } else {
        Command::new("py")
    };
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .args(["-m", "uvicorn", "anki_helper.backend:app", "--host", "127.0.0.1", "--port", "8765"])
        .current_dir(&root)
        .env("PYTHONPATH", root.join("src"))
        .spawn()
        .expect("Could not start the local Python engine")
}

fn start_backend(app: &tauri::App) -> ManagedBackend {
    if let Ok(sidecar) = app.shell().sidecar("binaries/anki-helper-backend") {
        let (_rx, child) = sidecar
            .spawn()
            .expect("Could not start the bundled Python engine");
        return ManagedBackend::Sidecar(child);
    }

    ManagedBackend::Dev(spawn_dev_backend())
}

fn stop_backend(child: ManagedBackend) {
    match child {
        ManagedBackend::Sidecar(child) => {
            let _ = child.kill();
        }
        ManagedBackend::Dev(mut child) => {
            let _ = child.kill();
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(BackendProcess(Mutex::new(Some(start_backend(app)))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Anki Helper");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(process) = handle.try_state::<BackendProcess>() {
                if let Ok(mut child) = process.0.lock() {
                    if let Some(child) = child.take() {
                        stop_backend(child);
                    }
                }
            }
        }
    });
}
