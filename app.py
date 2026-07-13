"""Launch the Anki Helper desktop application.

``python app.py`` runs the latest local source in Tauri dev mode when the
cached release build is missing or older than the project files.

Use ``python app.py --release`` to force the prebuilt release executable.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
DESKTOP_APP = FRONTEND / "src-tauri" / "target" / "release" / "anki-helper.exe"
INSTALLED_APP = Path(os.environ.get("LOCALAPPDATA", "")) / "Anki Helper" / "anki-helper.exe"
CARGO_BIN = Path.home() / ".cargo" / "bin"
SOURCE_MARKERS = (
    FRONTEND / "src" / "App.tsx",
    FRONTEND / "src-tauri" / "src" / "main.rs",
    ROOT / "src" / "anki_helper" / "backend.py",
    ROOT / "src" / "anki_helper" / "anki_package.py",
)
DEV_PORTS = (1420, 8765)


def release_is_stale() -> bool:
    if not DESKTOP_APP.is_file():
        return True
    built_at = DESKTOP_APP.stat().st_mtime
    return any(path.is_file() and path.stat().st_mtime > built_at for path in SOURCE_MARKERS)


def free_dev_ports() -> None:
    """Stop leftover Vite/backend listeners so ``tauri dev`` can bind cleanly."""
    if sys.platform != "win32":
        return
    ports = ",".join(str(port) for port in DEV_PORTS)
    script = (
        f"Get-NetTCPConnection -LocalPort {ports} -State Listen -ErrorAction SilentlyContinue "
        "| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def ensure_toolchain_path() -> None:
    """Make rustup-installed cargo visible even in stale shells."""
    if CARGO_BIN.is_dir():
        cargo = str(CARGO_BIN)
        if cargo not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{cargo}{os.pathsep}{os.environ.get('PATH', '')}"


def resolve_release_app() -> Path | None:
    if DESKTOP_APP.is_file():
        return DESKTOP_APP
    if "--installed" in sys.argv and INSTALLED_APP.is_file():
        return INSTALLED_APP
    return None


def dev_toolchain_ready() -> tuple[bool, str]:
    ensure_toolchain_path()
    if not (FRONTEND / "node_modules").is_dir():
        return False, "frontend에서 `npm install`을 먼저 실행하세요."
    if shutil.which("cargo") is None:
        return False, (
            "Rust가 설치되어 있지 않습니다. https://rustup.rs 에서 설치한 뒤 "
            "터미널을 다시 열어 주세요."
        )
    return True, ""


def launch_release(app_path: Path | None = None) -> None:
    target = app_path or resolve_release_app()
    if target is None:
        raise SystemExit(
            "실행 가능한 Anki Helper를 찾지 못했습니다.\n"
            "- 로컬 빌드: frontend에서 `npm run tauri build`\n"
            "- 설치 파일: https://github.com/baggychani/AnkiHelper/releases"
        )
    free_dev_ports()
    subprocess.Popen([str(target)], cwd=target.parent)


def launch_dev() -> None:
    ready, message = dev_toolchain_ready()
    if not ready:
        raise SystemExit(message)
    free_dev_ports()
    subprocess.Popen(["npm", "run", "tauri", "dev"], cwd=FRONTEND, shell=True)


def main() -> None:
    if "--installed" in sys.argv:
        if not INSTALLED_APP.is_file():
            raise SystemExit(f"설치된 Anki Helper를 찾지 못했습니다: {INSTALLED_APP}")
        print("설치된 Anki Helper를 실행합니다.")
        launch_release(INSTALLED_APP)
        return

    if "--release" in sys.argv:
        launch_release()
        return

    if DESKTOP_APP.is_file() and not release_is_stale():
        launch_release(DESKTOP_APP)
        return

    if DESKTOP_APP.is_file():
        print("로컬 release 빌드가 소스보다 오래됐습니다. 최신 코드로 개발 모드를 실행합니다.")
    else:
        print("최신 소스 코드로 개발 모드를 실행합니다.")
    launch_dev()


if __name__ == "__main__":
    main()
