#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
};
use tauri::{Manager, RunEvent, WebviewWindow};

const DEFAULT_WINDOW_WIDTH: f64 = 1280.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 820.0;

fn should_start_maximized(window: &WebviewWindow) -> bool {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => return false,
    };
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return false;
    }

    let work = monitor.work_area();
    let logical_width = work.size.width as f64 / scale;
    let logical_height = work.size.height as f64 / scale;
    if logical_width <= 0.0 || logical_height <= 0.0 {
        return false;
    }

    DEFAULT_WINDOW_HEIGHT > logical_height
        || DEFAULT_WINDOW_WIDTH >= logical_width * 0.85
        || DEFAULT_WINDOW_HEIGHT >= logical_height * 0.92
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendProcess(Mutex<Option<Child>>);

fn exe_dir() -> Option<PathBuf> {
    env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

fn bundled_backend() -> Option<PathBuf> {
    let dir = exe_dir()?;
    let direct = dir.join("anki-helper-backend.exe");
    if direct.is_file() {
        return Some(direct);
    }

    let entries = fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.starts_with("anki-helper-backend") && name.ends_with(".exe") {
            return Some(path);
        }
    }

    None
}

fn spawn_process(mut command: Command) -> Result<Child, String> {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .spawn()
        .map_err(|error| format!("Could not start the Anki Helper engine: {error}"))
}

fn free_backend_port() {
    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

#[cfg(debug_assertions)]
fn spawn_dev_backend() -> Result<Child, String> {
    free_backend_port();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let python = root.join(".venv").join("Scripts").join("python.exe");
    let mut command = if python.is_file() {
        Command::new(python)
    } else {
        Command::new("py")
    };
    command
        .args([
            "-m",
            "uvicorn",
            "anki_helper.backend:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ])
        .current_dir(&root)
        .env("PYTHONPATH", root.join("src"));
    spawn_process(command)
}

fn start_backend() -> Result<Child, String> {
    free_backend_port();
    if let Some(path) = bundled_backend() {
        return spawn_process(Command::new(path));
    }

    #[cfg(debug_assertions)]
    {
        return spawn_dev_backend();
    }

    #[cfg(not(debug_assertions))]
    {
        Err("Anki Helper engine file was not found next to the app.".into())
    }
}

#[cfg(windows)]
fn show_startup_error(message: &str) {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(Some(0))
            .collect()
    }

    extern "system" {
        fn MessageBoxW(
            hwnd: *mut c_void,
            text: *const u16,
            caption: *const u16,
            utype: u32,
        ) -> i32;
    }

    let text = wide(message);
    let caption = wide("Anki Helper");
    unsafe {
        MessageBoxW(ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

#[cfg(not(windows))]
fn show_startup_error(message: &str) {
    eprintln!("{message}");
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            match start_backend() {
                Ok(child) => {
                    app.manage(BackendProcess(Mutex::new(Some(child))));
                }
                Err(message) => {
                    show_startup_error(&message);
                    return Err(message.into());
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                if should_start_maximized(&window) {
                    let _ = window.maximize();
                }
                let _ = window.show();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Anki Helper");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(process) = handle.try_state::<BackendProcess>() {
                if let Ok(mut child) = process.0.lock() {
                    if let Some(mut child) = child.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
