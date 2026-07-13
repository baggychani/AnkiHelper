"""Launch the Anki Helper desktop application.

This is the single entry point for local use: ``python app.py`` opens the
Tauri window, which in turn starts its private Python API engine.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DESKTOP_APP = ROOT / "frontend" / "src-tauri" / "target" / "release" / "anki-helper.exe"


def main() -> None:
    if not DESKTOP_APP.is_file():
        raise SystemExit(
            "데스크톱 앱이 아직 빌드되지 않았습니다. "
            "frontend 폴더에서 `npm run tauri build`를 먼저 실행하세요."
        )
    subprocess.Popen([str(DESKTOP_APP)], cwd=ROOT)


if __name__ == "__main__":
    main()
