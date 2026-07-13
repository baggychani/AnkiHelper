"""Local API used by the Tauri desktop shell.

The API intentionally binds to loopback only.  It is a private bridge between
the installed desktop UI and the existing APKG parsing/export domain code.
"""

from __future__ import annotations

import tempfile
import base64
import html
import mimetypes
import re
import sqlite3
import zipfile
from copy import deepcopy
from uuid import uuid4
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .anki_package import (
    ApkgReadError,
    DeckPackage,
    Field,
    NoteType,
    export_bundle,
    export_design,
    export_media,
    export_project,
    export_tsv,
    import_project,
    media_items,
    read_apkg,
    render_template,
    save_apkg,
)

app = FastAPI(title="Anki Helper local engine", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    # Tauri 2's Windows WebView uses http://tauri.localhost.  The backend is
    # loopback-only, so allowing the desktop shell and development origins is
    # safe and prevents browser-level "Failed to fetch" errors on APKG open.
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

_package: DeckPackage | None = None
_selected_note_type_id: str | None = None
_requires_save_as = False
_sound_marker = re.compile(r"<span class='sound' data-sound='([^']+)'>.*?</span>")


class OpenPackageRequest(BaseModel):
    path: str


class TemplatePatch(BaseModel):
    front: str | None = None
    back: str | None = None


class CssPatch(BaseModel):
    css: str


class FieldPatch(BaseModel):
    name: str


class FieldCreate(BaseModel):
    name: str


class NoteFieldPatch(BaseModel):
    value: str


class NoteTypeClone(BaseModel):
    name: str


class SavePackageRequest(BaseModel):
    path: str | None = None


class ImportProjectRequest(BaseModel):
    path: str


def _note_type_data(note_type: NoteType) -> dict:
    return {
        "id": note_type.id,
        "name": note_type.name,
        "fields": [asdict(field) for field in note_type.fields],
        "templates": [asdict(template) for template in note_type.templates],
        "css": note_type.css,
        "notes": note_type.notes,
    }


def _workspace_data() -> dict | None:
    if _package is None:
        return None
    return {
        "source": str(_package.source),
        "source_name": _package.source.name,
        "media_count": len(_package.media),
        "note_types": [_note_type_data(note_type) for note_type in _package.note_types],
        "selected_note_type_id": _selected_note_type_id,
        "requires_save_as": _requires_save_as,
    }


def _get_note_type(note_type_id: str) -> NoteType:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    for note_type in _package.note_types:
        if note_type.id == note_type_id:
            return note_type
    raise HTTPException(status_code=404, detail="노트 타입을 찾지 못했습니다.")


def _embed_media_audio(markup: str) -> str:
    """Turn Anki sound markers into playable inline audio for the preview."""
    if _package is None:
        return markup

    def replace(match: re.Match[str]) -> str:
        filename = match.group(1)
        stored_name = next((stored for stored, original in _package.media.items() if original == filename), filename)
        if stored_name not in _package.archive_entries:
            return f"<span class='sound'>🔊 {html.escape(filename)}</span>"
        try:
            with zipfile.ZipFile(_package.source) as archive:
                payload = archive.read(stored_name)
        except (OSError, KeyError, zipfile.BadZipFile):
            return f"<span class='sound'>🔊 {html.escape(filename)}</span>"
        media_type = mimetypes.guess_type(filename)[0] or "audio/mpeg"
        encoded = base64.b64encode(payload).decode("ascii")
        return f"<button type='button' class='anki-audio sound' data-audio='data:{media_type};base64,{encoded}' aria-label='음성 재생'>▶</button>"

    return _sound_marker.sub(replace, markup)


@app.get("/api/health")
@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/workspace")
def workspace() -> dict | None:
    return _workspace_data()


@app.post("/api/packages/open")
def open_package(payload: OpenPackageRequest) -> dict:
    global _package, _selected_note_type_id, _requires_save_as
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    try:
        if source.suffix.lower() == ".zip":
            with zipfile.ZipFile(source) as archive:
                if "source/original.apkg" not in archive.namelist():
                    raise ApkgReadError("이 편집 프로젝트에는 원본 APKG가 포함되어 있지 않습니다. 새로 내보낸 편집 프로젝트를 사용해 주세요.")
                temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-project-", suffix=".apkg", delete=False)
                temporary.write(archive.read("source/original.apkg")); temporary.close()
            _package = read_apkg(temporary.name)
            import_project(_package, source)
            _requires_save_as = True
        else:
            _package = read_apkg(source)
            _requires_save_as = False
    except (ApkgReadError, ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _selected_note_type_id = _package.note_types[0].id if _package.note_types else None
    return _workspace_data() or {}


@app.post("/api/packages/save")
def save_package(payload: SavePackageRequest) -> dict:
    global _package, _selected_note_type_id, _requires_save_as
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    destination = Path(payload.path) if payload.path else _package.source
    if _requires_save_as and not payload.path:
        raise HTTPException(status_code=400, detail="편집 프로젝트는 처음 저장할 APKG 위치를 선택해야 합니다.")
    if destination.suffix.lower() != ".apkg":
        raise HTTPException(status_code=400, detail="APKG 형식으로만 저장할 수 있습니다.")
    selected_name = next((item.name for item in _package.note_types if item.id == _selected_note_type_id), None)
    try:
        target, backup = save_apkg(_package, destination, backup=True)
        _package = read_apkg(target)
        _requires_save_as = False
    except (OSError, sqlite3.DatabaseError, zipfile.BadZipFile, ApkgReadError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"APKG 저장에 실패했습니다: {exc}") from exc
    if selected_name:
        _selected_note_type_id = next((item.id for item in _package.note_types if item.name == selected_name), _package.note_types[0].id if _package.note_types else None)
    return {"workspace": _workspace_data(), "saved_to": str(target), "backup": str(backup) if backup else None}


@app.get("/api/media")
def list_media() -> list[dict]:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    return media_items(_package)


@app.get("/api/media/{stored_name}")
def download_media(stored_name: str) -> FileResponse:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    item = next((entry for entry in media_items(_package) if entry["stored_name"] == stored_name), None)
    if item is None:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾지 못했습니다.")
    with zipfile.ZipFile(_package.source) as archive:
        temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-media-", suffix=Path(item["name"]).suffix, delete=False)
        temporary.write(archive.read(stored_name)); temporary.close()
    return FileResponse(temporary.name, filename=item["name"], media_type=mimetypes.guess_type(item["name"])[0] or "application/octet-stream")


@app.post("/api/projects/import")
def import_edit_project(payload: ImportProjectRequest) -> dict:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        note_type = import_project(_package, payload.path)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"workspace": _workspace_data(), "note_type_id": note_type.id}


@app.patch("/api/note-types/{note_type_id}/templates/{template_index}")
def update_template(note_type_id: str, template_index: int, patch: TemplatePatch) -> dict:
    note_type = _get_note_type(note_type_id)
    if not 0 <= template_index < len(note_type.templates):
        raise HTTPException(status_code=404, detail="카드 템플릿을 찾지 못했습니다.")
    template = note_type.templates[template_index]
    if patch.front is not None:
        template.front = patch.front
    if patch.back is not None:
        template.back = patch.back
    return _workspace_data() or {}


@app.patch("/api/note-types/{note_type_id}/css")
def update_css(note_type_id: str, patch: CssPatch) -> dict:
    _get_note_type(note_type_id).css = patch.css
    return _workspace_data() or {}


@app.patch("/api/note-types/{note_type_id}/fields/{field_order}")
def update_field(note_type_id: str, field_order: int, patch: FieldPatch) -> dict:
    note_type = _get_note_type(note_type_id)
    name = patch.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="필드 이름을 비워 둘 수 없습니다.")
    field = next((item for item in note_type.fields if item.order == field_order), None)
    if field is None:
        raise HTTPException(status_code=404, detail="필드를 찾지 못했습니다.")
    if any(item is not field and item.name.casefold() == name.casefold() for item in note_type.fields):
        raise HTTPException(status_code=400, detail="같은 이름의 필드가 이미 있습니다.")
    old_name = field.name
    field.name = name
    token_pattern = re.compile(r"(\{\{(?:[#^])?\s*)" + re.escape(old_name) + r"(\s*(?::[^{}]+)?\s*\}\})")
    for template in note_type.templates:
        template.front = token_pattern.sub(r"\g<1>" + name + r"\g<2>", template.front)
        template.back = token_pattern.sub(r"\g<1>" + name + r"\g<2>", template.back)
    return _workspace_data() or {}


@app.post("/api/note-types/{note_type_id}/fields")
def add_field(note_type_id: str, payload: FieldCreate) -> dict:
    note_type = _get_note_type(note_type_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="필드 이름을 입력해 주세요.")
    if any(item.name.casefold() == name.casefold() for item in note_type.fields):
        raise HTTPException(status_code=400, detail="같은 이름의 필드가 이미 있습니다.")
    note_type.fields.append(Field(name=name, order=len(note_type.fields)))
    for values in note_type.notes:
        values.append("")
    return _workspace_data() or {}


@app.delete("/api/note-types/{note_type_id}/fields/{field_order}")
def delete_field(note_type_id: str, field_order: int) -> dict:
    note_type = _get_note_type(note_type_id)
    if len(note_type.fields) <= 1:
        raise HTTPException(status_code=400, detail="필드는 하나 이상 남겨야 합니다.")
    field_index = next((index for index, item in enumerate(note_type.fields) if item.order == field_order), None)
    if field_index is None:
        raise HTTPException(status_code=404, detail="필드를 찾지 못했습니다.")
    old_name = note_type.fields[field_index].name
    del note_type.fields[field_index]
    for index, field in enumerate(note_type.fields):
        field.order = index
    for values in note_type.notes:
        if field_index < len(values):
            del values[field_index]
    token_pattern = re.compile(r"\{\{(?:[#^])?\s*" + re.escape(old_name) + r"(?:\s*:[^{}]+)?\s*\}\}")
    for template in note_type.templates:
        template.front = token_pattern.sub("", template.front)
        template.back = token_pattern.sub("", template.back)
    return _workspace_data() or {}


@app.patch("/api/note-types/{note_type_id}/notes/{note_index}/fields/{field_order}")
def update_note_field(note_type_id: str, note_index: int, field_order: int, patch: NoteFieldPatch) -> dict:
    note_type = _get_note_type(note_type_id)
    if not 0 <= note_index < len(note_type.notes):
        raise HTTPException(status_code=404, detail="노트를 찾지 못했습니다.")
    if not 0 <= field_order < len(note_type.fields):
        raise HTTPException(status_code=404, detail="필드를 찾지 못했습니다.")
    values = note_type.notes[note_index]
    while len(values) < len(note_type.fields):
        values.append("")
    values[field_order] = patch.value
    return _workspace_data() or {}


@app.post("/api/note-types/{note_type_id}/clone")
def clone_note_type(note_type_id: str, payload: NoteTypeClone) -> dict:
    global _selected_note_type_id
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="노트 유형 이름을 입력해 주세요.")
    if any(item.name.casefold() == name.casefold() for item in _package.note_types):
        raise HTTPException(status_code=400, detail="같은 이름의 노트 유형이 이미 있습니다.")
    source = _get_note_type(note_type_id)
    copied = deepcopy(source)
    copied.id = str(uuid4())
    copied.name = name
    copied.source_id = source.id
    _package.note_types.append(copied)
    _selected_note_type_id = copied.id
    return _workspace_data() or {}


@app.get("/api/note-types/{note_type_id}/preview")
def preview_card(
    note_type_id: str,
    template_index: int = 0,
    side: Literal["front", "back"] = "front",
    note_index: int = 0,
) -> dict[str, str]:
    note_type = _get_note_type(note_type_id)
    if not 0 <= template_index < len(note_type.templates):
        raise HTTPException(status_code=404, detail="카드 템플릿을 찾지 못했습니다.")
    values = note_type.notes[note_index % len(note_type.notes)] if note_type.notes else [""] * len(note_type.fields)
    template = note_type.templates[template_index]
    front = render_template(template.front, note_type.fields, values)
    body = front if side == "front" else render_template(template.back, note_type.fields, values, front)
    helper_css = ".anki-audio{display:inline-grid;place-items:center;width:36px;height:36px;margin:0 0 0 10px;border:1px solid #f4b183;border-radius:999px;background:#fff7ef;color:#d44709;font:700 16px/1 system-ui,sans-serif;cursor:pointer;vertical-align:middle}.anki-audio.playing{background:#d44709;color:#fff}"
    return {"html": f"<style>{helper_css}{note_type.css}</style>{_embed_media_audio(body)}"}


@app.get("/api/note-types/{note_type_id}/export/{kind}")
def download_export(note_type_id: str, kind: Literal["tsv", "design", "bundle", "media", "project"]) -> FileResponse:
    note_type = _get_note_type(note_type_id)
    suffix, filename = {
        "tsv": (".tsv", f"{note_type.name}_input.tsv"),
        "design": (".json", f"{note_type.name}_design.json"),
        "bundle": (".apkg", f"{note_type.name}_수정본.apkg"),
        "media": (".zip", f"{note_type.name}_미디어.zip"),
        "project": (".zip", f"{note_type.name}_편집프로젝트.zip"),
    }[kind]
    temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-", suffix=suffix, delete=False)
    temporary.close()
    target = Path(temporary.name)
    if kind == "tsv":
        export_tsv(note_type, target)
    elif kind == "design":
        export_design(note_type, target)
    elif kind == "media":
        if _package is None:
            raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
        export_media(_package, target)
    elif kind == "project":
        if _package is None:
            raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
        export_project(_package, note_type, target)
    else:
        if _package is None:  # Protected by _get_note_type; keep type check explicit.
            raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
        save_apkg(deepcopy(_package), target, backup=False)
    return FileResponse(target, filename=filename, media_type="application/octet-stream")


def main() -> None:
    """Run the local engine directly, useful for browser-only development."""
    import uvicorn

    uvicorn.run(
        "anki_helper.backend:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
        log_config=None,
        access_log=False,
    )
