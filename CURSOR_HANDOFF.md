# Cursor 인수인계 메모

마지막 확인: 2026-08-29 (KST) · 기준 커밋: `426d90b` (`v2.0.1`) · 브랜치: `main`

## 프로젝트 핵심

- Windows용 Anki APKG 편집기입니다. React/Vite/Tailwind UI → 로컬 FastAPI (`127.0.0.1:8765`) → APKG 처리 로직 순서로 동작하며, APKG는 외부 서버로 전송하지 않습니다.
- 주요 진입점: `app.py`(데스크톱 실행), `frontend/src/App.tsx`(UI 상태/라우팅), `frontend/src/api.ts`(API 계약), `src/anki_helper/backend.py`(FastAPI), `src/anki_helper/anki_package.py`(APKG·미디어 핵심).
- `run.ps1`은 데스크톱 UI가 아니라 FastAPI만 실행합니다. `app.py`와 Tauri 개발 실행은 포트 **1420/8765**의 기존 리스너를 종료하므로 다른 서비스를 같은 포트에 띄우지 마세요.

## 이번 정리에서 완료한 내용

| 영역 | 완료 내용 |
| --- | --- |
| 미디어 추출 | 현재 필터(음성·이미지·영상·폰트·기타)에 맞춘 ZIP 내보내기 및 종류별 기본 파일명 추가 |
| UI | `기타` 필터를 노출하고, 필터 상태에 따라 `음성 추출` 등 정확한 버튼 문구를 표시 |
| APKG 안전성 | `.oga`를 음성으로 분류하고, 경로 탈출·Windows 위험 이름·대소문자 충돌 미디어는 ZIP 내보내기 전에 차단해 400 오류로 안내 |
| 미리보기 보안 | 신뢰되지 않은 카드 템플릿을 opaque sandbox로 격리. 미리보기 전용 임시 토큰 URL로만 미디어를 제공하고, CSP로 외부 연결·폼·상위 창 권한을 차단 |
| 개발 흐름 | `app.py`가 `frontend/src` 하위 파일까지 재귀적으로 검사하도록 수정했고, README의 Python 테스트 명령에 `PYTHONPATH=src`를 추가 |

### 미리보기 호환성 메모

카드 템플릿 JavaScript는 계속 실행되지만, 미리보기 iframe은 부모 Tauri 창/API와 같은 origin을 쓰지 않습니다. 보안을 위해 외부 네트워크 자산은 미리보기에서 막고, `localStorage`/`sessionStorage`는 현재 iframe 문서 안에서만 유지됩니다. 실제 Anki의 장기 저장소 동작을 꼭 검증해야 하는 템플릿은 Anki 자체에서도 확인하세요.

## 검증 결과

- Ruff: 통과
- Python unittest: **42 passed**
- ESLint / TypeScript: 통과
- Vitest: **6 files, 21 passed**
- Vite production build: 통과
- `git diff --check`: 오류 없음

재실행 명령(PowerShell):

```powershell
$env:PYTHONPATH = 'src'
.\.venv\Scripts\python.exe -m ruff check app.py scripts src tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location frontend
npm run lint
npm run check
npm test
npm run build
```

## 빠른 수동 확인

1. 음성·이미지·기타 파일이 섞인 APKG를 연다.
2. 각 필터에서 추출 버튼 문구, ZIP의 `media/` 목록, 파일명 접미사를 확인한다.
3. 카드 미리보기에서 이미지·CSS·음성이 정상적으로 표시/재생되는지 확인한다.
4. 악성 또는 비정상 미디어명 APKG는 내보낼 때 명확한 오류를 내고 ZIP을 만들지 않아야 한다.

## 릴리스·CI

- CI는 Windows / Python 3.12 / Node 22에서 Ruff, Python unittest, ESLint, TypeScript, Vitest를 실행합니다.
- 현재 버전은 **2.0.1**이고 이미 `v2.0.1` 태그가 있습니다. 이번 푸시는 릴리스가 아닙니다.
- 새 릴리스가 필요하면 `pyproject.toml`, `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `src/anki_helper/__init__.py`의 버전과 `vX.Y.Z` 태그를 함께 맞추세요.
- standalone 설치 파일은 PyInstaller sidecar가 필요합니다: `python scripts/build_sidecar.py` 후 release Tauri 설정으로 번들합니다.
