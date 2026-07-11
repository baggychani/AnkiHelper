"""Anki Helper 실행점.

프로젝트 루트에서 이 파일을 실행하면, 필요한 경우 로컬 .venv의 Python으로
자동 전환한 뒤 GUI를 엽니다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


def _use_project_environment() -> None:
    """Re-launch with the checked-in local environment when needed."""
    try:
        import PySide6  # noqa: F401
    except ImportError:
        if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
            os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise SystemExit(
            "PySide6가 준비되지 않았습니다. 프로젝트의 .venv 환경을 먼저 설치해 주세요."
        )


def main() -> None:
    _use_project_environment()
    sys.path.insert(0, str(ROOT / "src"))
    from anki_helper.app import main as start_application

    start_application()


if __name__ == "__main__":
    main()
