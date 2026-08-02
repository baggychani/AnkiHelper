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
use std::sync::OnceLock;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
#[cfg(windows)]
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;

struct BackendProcess(Mutex<Option<Child>>);

#[cfg(windows)]
fn backend_job() -> isize {
    static JOB: OnceLock<isize> = OnceLock::new();
    *JOB.get_or_init(|| {
        #[repr(C)]
        struct IoCounters {
            read_operation_count: u64,
            write_operation_count: u64,
            other_operation_count: u64,
            read_transfer_count: u64,
            write_transfer_count: u64,
            other_transfer_count: u64,
        }
        #[repr(C)]
        struct JobObjectBasicLimitInformation {
            per_process_user_time_limit: i64,
            per_job_user_time_limit: i64,
            limit_flags: u32,
            minimum_working_set_size: usize,
            maximum_working_set_size: usize,
            active_process_limit: u32,
            affinity: usize,
            priority_class: u32,
            scheduling_class: u32,
        }
        #[repr(C)]
        struct JobObjectExtendedLimitInformationStruct {
            basic_limit_information: JobObjectBasicLimitInformation,
            io_info: IoCounters,
            process_memory_limit: usize,
            job_memory_limit: usize,
            peak_process_memory_used: usize,
            peak_job_memory_used: usize,
        }

        extern "system" {
            fn CreateJobObjectW(attributes: *mut core::ffi::c_void, name: *const u16) -> isize;
            fn SetInformationJobObject(
                job: isize,
                info_class: u32,
                info: *mut core::ffi::c_void,
                length: u32,
            ) -> i32;
        }

        unsafe {
            let job = CreateJobObjectW(core::ptr::null_mut(), core::ptr::null());
            if job == 0 || job == -1 {
                return 0;
            }
            let mut info = JobObjectExtendedLimitInformationStruct {
                basic_limit_information: JobObjectBasicLimitInformation {
                    per_process_user_time_limit: 0,
                    per_job_user_time_limit: 0,
                    limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit: 0,
                    affinity: 0,
                    priority_class: 0,
                    scheduling_class: 0,
                },
                io_info: IoCounters {
                    read_operation_count: 0,
                    write_operation_count: 0,
                    other_operation_count: 0,
                    read_transfer_count: 0,
                    write_transfer_count: 0,
                    other_transfer_count: 0,
                },
                process_memory_limit: 0,
                job_memory_limit: 0,
                peak_process_memory_used: 0,
                peak_job_memory_used: 0,
            };
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &mut info as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of_val(&info) as u32,
            );
            if ok == 0 {
                0
            } else {
                job
            }
        }
    })
}

#[cfg(windows)]
fn attach_backend_to_job(child: &Child) {
    let job = backend_job();
    if job == 0 {
        return;
    }
    extern "system" {
        fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> isize;
        fn CloseHandle(handle: isize) -> i32;
    }
    const PROCESS_SET_QUOTA: u32 = 0x0100;
    const PROCESS_TERMINATE: u32 = 0x0001;
    unsafe {
        let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child.id());
        if handle != 0 {
            let _ = AssignProcessToJobObject(job, handle);
            let _ = CloseHandle(handle);
        }
    }
}

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
    let child = command
        .spawn()
        .map_err(|error| format!("Could not start the Anki Helper engine: {error}"))?;
    #[cfg(windows)]
    attach_backend_to_job(&child);
    Ok(child)
}

fn free_backend_port() {
    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Get-Process -Name 'anki-helper-backend' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
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

#[tauri::command]
fn show_main_window(window: WebviewWindow) -> Result<(), String> {
    if should_start_maximized(&window) {
        let _ = window.maximize();
    }
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![show_main_window])
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
