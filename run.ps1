$ErrorActionPreference = 'Stop'

if (-not (Test-Path '.\.venv\Scripts\python.exe')) {
    Write-Host '먼저 .venv 환경을 만들고 requirements.txt를 설치해 주세요.' -ForegroundColor Yellow
    exit 1
}

$env:PYTHONPATH = (Join-Path $PSScriptRoot 'src')
& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') -m anki_helper
