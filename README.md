# Anki Helper

Anki Helper는 Anki의 `.apkg` 파일을 열어 카드 데이터, 필드, 미디어와 카드 디자인을 한곳에서 편집하는 Windows 데스크톱 앱입니다. 화면은 React와 Tailwind CSS, 데스크톱 실행 환경은 Tauri, APKG 처리는 Python FastAPI가 담당합니다.

현재 버전: **1.1.2**

## 지원 파일

- **Anki 패키지 (`.apkg`)**: 파일을 직접 열고 수정한 뒤 원본에 저장하거나 새 APKG로 내보낼 수 있습니다.
- **Anki Helper 편집 프로젝트 (`.zip`)**: APKG 원본, 노트 데이터, 템플릿, CSS, 미디어와 관리 정보를 함께 보관하는 왕복 편집용 압축 파일입니다.

편집 프로젝트는 항상 ZIP 형식입니다. 일반 ZIP이 아니라 Anki Helper가 내보낸 편집 프로젝트만 다시 열 수 있습니다.

## 주요 기능

- 노트 유형별 카드 데이터 확인·선택
- 일반 데이터 셀 더블클릭 편집 (텍스트와 미디어가 섞인 칸도 함께 표시)
- 필드 이름 변경·추가·삭제·순서 변경
- 필드 내용 이동 (텍스트만 / 미디어만 / 전체)
- 카드를 다른 노트 유형으로 옮기고, 빈 노트 유형 제거
- 구성을 새 노트 유형으로 저장 (카드 함께 이동)
- 필드 이름 변경 시 HTML 템플릿의 `{{필드명}}` 참조 자동 수정
- 앞면 HTML, 뒷면 HTML과 공통 CSS 편집
- 실제 템플릿과 미디어를 반영한 카드 미리보기
- 음성 바로 듣기, 이미지 확인, 개별 미디어 저장 및 전체 미디어 ZIP 추출
- 카드 데이터의 미디어 셀에서 해당 미디어로 바로 이동
- `Ctrl+S` 또는 저장 버튼으로 현재 APKG에 변경사항 반영
- 다른 이름으로 수정본 APKG 저장
- TSV, 디자인 JSON, 미디어 ZIP, 편집 프로젝트 ZIP 내보내기
- 종료 전 확인 (Esc로 취소)

## 저장과 백업

일반 저장은 현재 열어 둔 APKG에 변경사항을 반영합니다. 저장 직전에 수정 전 APKG가 `%LOCALAPPDATA%\\Anki Helper\\Backups` 폴더에 시간별로 백업됩니다. 원본과 별개의 파일이 필요하면 사이드바의 **다른 이름으로 APKG 저장**을 사용하세요.

편집 프로젝트를 열었을 때는 포함된 원본 APKG를 임시 작업본으로 사용하므로, 첫 저장 시 새 APKG의 위치를 선택합니다.

## 편집 프로젝트 구성

대표적인 구조는 다음과 같습니다.

```text
project.zip
├─ manifest.json
├─ notes.tsv
├─ media/
├─ models/
│  └─ 노트 유형 이름/
│     ├─ model.json
│     ├─ card_1_front.html
│     ├─ card_1_back.html
│     └─ style.css
└─ source/
   └─ original.apkg
```

TSV에는 기존 노트와의 연결을 유지하기 위한 관리 식별자가 포함될 수 있습니다. 앱 화면에서는 일반 편집에 불필요한 관리 정보가 드러나지 않도록 처리합니다.

### 편집 프로젝트를 직접 다시 구성하는 방법

현재 편집 프로젝트는 **기존 APKG를 수정하기 위한 왕복 편집 형식**입니다. TSV와 HTML만으로 완전히 새로운 APKG를 만드는 형식은 아닙니다. 가장 안전한 방법은 기준이 될 APKG를 Anki Helper에서 연 뒤 **편집 프로젝트 내보내기**를 실행하고, 생성된 ZIP의 파일만 수정하는 것입니다.

직접 ZIP을 다시 묶을 때는 다음 조건을 지켜야 합니다.

1. `manifest.json`, `notes.tsv`, `models`, `source`가 ZIP의 최상위에 있어야 합니다. 이 파일들을 감싸는 별도의 상위 폴더를 만들면 안 됩니다.
2. `source/original.apkg`를 삭제하거나 다른 APKG로 임의 교체하면 안 됩니다. 노트 유형 ID와 노트 ID의 기준 파일입니다.
3. `notes.tsv`의 첫 열인 `__note_id`와 `__note_type`은 유지해야 합니다. 현재 가져오기는 기존 `__note_id`와 일치하는 행만 수정하며, ID가 없는 행을 새 노트로 추가하지 않습니다.
4. 일반 필드 열은 `manifest.json`과 원본 노트 유형의 필드 이름을 그대로 사용해야 합니다.
5. `models/노트 유형 이름/` 아래의 HTML과 CSS는 수정할 수 있습니다. 폴더명은 Windows 파일명에 사용할 수 없는 문자가 `_`로 바뀐 이름입니다.
6. 수정 후 전체 구조를 `.zip`으로 압축하고 Anki Helper의 **파일 열기**에서 선택합니다. 내용을 확인한 뒤 **저장**을 누르면 새 APKG의 위치를 묻습니다.

`media/` 폴더는 현재 개별 파일 확인과 외부 편집을 위한 내보내기 사본입니다. 편집 프로젝트를 다시 열 때 이 폴더의 신규·교체 미디어를 APKG에 병합하지는 않으며, 실제 미디어 기준은 `source/original.apkg`입니다.

## 실행

저장소 루트에서 다음 명령을 실행하면 Anki Helper가 열립니다.

```powershell
python .\app.py
```

기본 동작은 **최신 소스**를 반영합니다. 로컬 `release` 빌드가 없거나 소스보다 오래됐으면 `npm run tauri dev`로 실행하고, 최신 release 빌드가 있으면 그 exe를 실행합니다.

미리 빌드해 둔 release exe만 강제로 실행하려면:

```powershell
python .\app.py --release
```

또는 가상환경을 이용할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe .\app.py
```

## 개발 환경 준비

Python 의존성:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

프런트엔드 의존성:

```powershell
cd frontend
npm install
```

개발 모드:

```powershell
cd frontend
npm run tauri dev
```

타입 검사와 로컬 빌드:

```powershell
cd frontend
npm run check
npm run tauri build
```

빌드된 실행 파일은 `frontend/src-tauri/target/release/anki-helper.exe`에 생성됩니다.

## GitHub Release

`.github/workflows/release.yml`은 Windows 설치 파일을 만드는 공식 배포 경로입니다. 태그를 푸시하거나 GitHub Actions에서 수동 실행하면 다음 순서로 동작합니다.

1. Python, Node.js와 Rust 빌드 환경 준비
2. PyInstaller로 FastAPI 엔진을 `anki-helper-backend.exe` 단일 파일로 빌드
3. Python 엔진을 Tauri sidecar로 포함
4. NSIS Windows 설치 파일 생성
5. GitHub Release 생성 및 설치 파일 첨부

정식 버전을 배포할 때는 Python·npm·Cargo·Tauri 버전을 동일하게 맞춘 뒤 버전 태그를 푸시합니다.

```powershell
git tag v1.1.2
git push origin v1.1.2
```

일반 `npm run tauri build`는 이 저장소에서 개발할 때 사용하는 로컬 빌드이며 `.venv`의 Python을 실행합니다. GitHub Release 빌드는 Python 설치가 없는 PC에서도 실행되도록 별도의 `tauri.release.conf.json`과 번들된 Python sidecar를 사용합니다.

## 구조

```text
React UI
   ↓ HTTP (127.0.0.1:8765)
Tauri desktop shell
   ↓
Python FastAPI APKG engine
```

백엔드는 외부 네트워크가 아니라 로컬 루프백 주소에서만 실행됩니다. 선택한 APKG와 미디어는 외부 서버로 전송되지 않습니다.

© 2026 Bae Gichan
