"""Build the Windows Python sidecar expected by the Tauri release config."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "build" / "sidecar-dist"
WORK = ROOT / "build" / "sidecar-work"
SPEC = ROOT / "build" / "sidecar-spec"
TARGET = ROOT / "frontend" / "src-tauri" / "binaries" / "anki-helper-backend-x86_64-pc-windows-msvc.exe"


def main() -> None:
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--noconsole",
        "--name",
        "anki-helper-backend",
        "--paths",
        str(ROOT / "src"),
        "--distpath",
        str(DIST),
        "--workpath",
        str(WORK),
        "--specpath",
        str(SPEC),
        str(ROOT / "scripts" / "backend_entry.py"),
    ]
    subprocess.run(command, check=True, cwd=ROOT)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DIST / "anki-helper-backend.exe", TARGET)
    print(f"Sidecar ready: {TARGET}")


if __name__ == "__main__":
    main()
