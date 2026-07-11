# Anki Helper

`.apkg` 덱을 열어 노트 타입의 필드, 카드 앞·뒷면 템플릿, CSS, 샘플 데이터를 한곳에서 확인하고 내보내는 PySide6 데스크톱 앱입니다.

## 실행

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\app.py
```

현재 프로젝트에는 필요한 `.venv`가 이미 준비되어 있습니다. 실행은 루트의
`app.py` 하나면 됩니다. 다른 Python으로 실행했더라도 `app.py`가 자동으로
프로젝트의 `.venv`를 찾아 사용합니다.

## 현재 제공하는 내보내기

- 선택한 노트 타입의 입력용 TSV (UTF-8 BOM)
- 필드·앞면·뒷면·CSS·템플릿 정보가 담긴 `design.json`
- 위 두 파일과 원본 미디어를 담은 ZIP 번들

`src/anki_helper/anki_package.py`는 UI와 분리되어 있으므로, 이후 CSV/XLSX 입력과 APKG 재생성 기능을 같은 데이터 모델 위에 추가할 수 있습니다.
