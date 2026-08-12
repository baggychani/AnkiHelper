# Anki Helper

Anki Helper는 Anki의 `.apkg` 파일을 열어 카드 데이터, 필드, 미디어와 카드 디자인을 한곳에서 편집하는 Windows 데스크톱 앱입니다. 화면은 React와 Tailwind CSS, 데스크톱 실행 환경은 Tauri, APKG 처리는 Python FastAPI가 담당합니다.

현재 버전: **2.0.1**

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
- 실제 템플릿과 미디어를 반영한 카드 미리보기 (Anki PC / AnkiDroid 표시 환경과 야간 모드 전환)
- 이미지·음성·영상·폰트 등 미디어 추가/삭제, 음성·영상 미리보기, 개별 미디어 저장 및 전체 미디어 ZIP 추출
- 미디어 검사: 누락 참조, 사용하지 않는 파일, 참조되지 않는 디자인용 `_` 파일, 대소문자 충돌, APKG 미디어 맵 이상 확인
- 참조 중인 미디어는 삭제 전 사용 위치를 알려 주고 강제 삭제 여부 확인
- 카드 데이터의 미디어 셀에서 해당 미디어로 바로 이동
- `Ctrl+S` 또는 저장 버튼으로 현재 APKG에 변경사항 반영
- 다른 이름으로 수정본 APKG 저장
- TSV, 디자인 JSON, 미디어 ZIP, 편집 프로젝트 ZIP 내보내기
- 종료 전 확인 (Esc로 취소)

### 미디어와 카드 디자인

카드 템플릿에서 모든 카드에 공통으로 쓸 파일은 **디자인용 추가**로 넣으세요. 파일명에 `_` 접두어가 붙어 Anki의 미디어 검사와 내보내기에서 템플릿 자산으로 안전하게 취급됩니다. 이미지 태그, 음성/영상 태그, CSS `url()`, `srcset`, `poster`, 로컬 스타일시트와 `@import` 참조는 카드 미리보기에서도 실제 APKG 미디어로 해석됩니다. 템플릿 JavaScript가 실행 중 이미지 주소나 CSS 배경을 지정하는 경우도 미디어 관리의 파일명과 연결됩니다.

미디어 검사 버튼은 저장 전에 깨진 이미지·음성·폰트 참조와 플랫폼별 대소문자 충돌을 찾는 용도입니다. 파일명에 Windows에서 허용되지 않는 문자가 있으면 추가할 때 안전한 이름으로 정리하며, 같은 이름을 대소문자만 달리 추가하면 자동으로 고유 이름을 만듭니다. 폰트 파일은 **CSS 복사**, 이미지·음성·영상은 **태그 복사**로 올바른 참조를 만들 수 있습니다.

최신 Anki가 내보낸 Zstandard 압축 미디어와 protobuf 미디어 인덱스도 원래 형식으로 보존합니다. 음성 듣기는 APKG의 원본 음원 바이트를 완전히 읽은 뒤 재생하며, 실시간 미리보기에서는 Anki처럼 카드 면이 열릴 때 포함된 음성을 순서대로 자동 재생합니다. 뒷면의 `{{FrontSide}}`가 가져온 앞면 음성은 Anki와 동일하게 자동 재생하지 않지만 재생 버튼으로 다시 들을 수 있습니다. 미리보기의 구간 재생 요청도 동일한 파일 검증값과 정확한 바이트 범위로 처리합니다.

미리보기의 **PC / AnkiDroid** 전환은 템플릿에 각각 Anki의 데스크톱·Android 플랫폼 클래스를 적용하고, 야간 모드는 `nightMode`와 AnkiDroid 호환 클래스를 함께 적용합니다. 따라서 `.win`, `.mobile`, `.android`, `.nightMode`, `.night_mode` 등에 맞춘 카드 CSS를 앱 안에서 비교할 수 있습니다.

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
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

실행 파일만 만드는 환경에서는 `requirements.txt`만 설치해도 됩니다. `requirements-dev.txt`에는 API 통합 테스트와 Ruff 정적 검사에 필요한 개발 의존성이 추가됩니다.

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

정적 검사, 테스트와 로컬 빌드:

```powershell
.\.venv\Scripts\python.exe -m ruff check app.py scripts src tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
cd frontend
npm run lint
npm run check
npm test
npm run tauri build
```

빌드된 실행 파일은 `frontend/src-tauri/target/release/anki-helper.exe`에 생성됩니다.

`.github/workflows/ci.yml`도 `main` 푸시와 Pull Request마다 같은 Python 테스트·Ruff 검사 및 프런트엔드 ESLint·타입 검사·Vitest를 실행합니다. 배포 빌드는 별도의 Release 워크플로에 유지되어 일반 변경 검증과 릴리스 생성을 분리합니다.

## GitHub Release

`.github/workflows/release.yml`은 Windows 설치 파일을 만드는 공식 배포 경로입니다. 태그를 푸시하거나 GitHub Actions에서 수동 실행하면 다음 순서로 동작합니다.

1. Python, Node.js와 Rust 빌드 환경 준비
2. PyInstaller로 FastAPI 엔진을 `anki-helper-backend.exe` 단일 파일로 빌드
3. Python 엔진을 Tauri sidecar로 포함
4. NSIS Windows 설치 파일 생성
5. GitHub Release 생성 및 설치 파일 첨부

정식 버전을 배포할 때는 Python·npm·Cargo·Tauri 버전을 동일하게 맞춘 뒤 버전 태그를 푸시합니다.

```powershell
git tag v2.0.1
git push origin v2.0.1
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
