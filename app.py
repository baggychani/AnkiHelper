"""Launch the Anki Helper desktop application.

``python app.py`` runs the latest local source in Tauri dev mode when the
cached release build is missing or older than the project files.

Use ``python app.py --release`` to force the prebuilt release executable.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
DESKTOP_APP = FRONTEND / "src-tauri" / "target" / "release" / "anki-helper.exe"
SOURCE_MARKERS = (
    FRONTEND / "src" / "App.tsx",
    FRONTEND / "src-tauri" / "src" / "main.rs",
    ROOT / "src" / "anki_helper" / "backend.py",
    ROOT / "src" / "anki_helper" / "anki_package.py",
)


def release_is_stale() -> bool:
    if not DESKTOP_APP.is_file():
        return True
    built_at = DESKTOP_APP.stat().st_mtime
    return any(path.is_file() and path.stat().st_mtime > built_at for path in SOURCE_MARKERS)


def launch_release() -> None:
    if not DESKTOP_APP.is_file():
        raise SystemExit(
            "데스크톱 앱이 아직 빌드되지 않았습니다. "
            "frontend 폴더에서 `npm run tauri build`를 먼저 실행하세요."
        )
    subprocess.Popen([str(DESKTOP_APP)], cwd=ROOT)


def launch_dev() -> None:
    if not (FRONTEND / "node_modules").is_dir():
        raise SystemExit("frontend에서 `npm install`을 먼저 실행하세요.")
    subprocess.Popen(["npm", "run", "tauri", "dev"], cwd=FRONTEND, shell=True)


def main() -> None:
    if "--release" in sys.argv:
        launch_release()
        return

    if DESKTOP_APP.is_file() and not release_is_stale():
        launch_release()
        return

    if DESKTOP_APP.is_file():
        print("로컬 release 빌드가 소스보다 오래됐습니다. 최신 코드로 개발 모드를 실행합니다.")
    else:
        print("release 빌드가 없어 개발 모드를 실행합니다.")
    launch_dev()


if __name__ == "__main__":
    main()
