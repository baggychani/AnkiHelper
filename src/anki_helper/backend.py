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
from starlette.background import BackgroundTask

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
    field_content_kind,
    import_project,
    import_media,
    inspect_table_source,
    media_items,
    move_note_field_contents,
    move_notes_between_types,
    read_apkg,
    remove_media,
    remove_note_type,
    render_template,
    reorder_field,
    save_apkg,
    save_as_note_type,
    split_field_content,
    create_package_from_table,
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


def _temporary_file_response(path: Path, *, filename: str, media_type: str) -> FileResponse:
    """Stream a generated download and remove its staging file afterwards."""
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


def _cleanup_ephemeral_package(package: DeckPackage | None, requires_save_as: bool) -> None:
    """Remove only package copies that this process staged in the temp directory."""
    if package is None:
        return
    for staged_path in package.pending_media.values():
        staged_path.unlink(missing_ok=True)
    package.pending_media.clear()
    if not requires_save_as:
        return
    source = package.source
    try:
        temporary_root = Path(tempfile.gettempdir()).resolve()
        if source.is_file() and temporary_root in source.resolve().parents:
            source.unlink(missing_ok=True)
    except OSError:
        pass


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
    move_cards: bool = True


class NoteTypeMoveNotes(BaseModel):
    destination_id: str
    mapping: dict[str, int] | None = None


class SelectedNoteType(BaseModel):
    note_type_id: str


class FieldMove(BaseModel):
    destination_order: int
    mode: Literal["text", "media", "all"] = "all"


class FieldReorder(BaseModel):
    new_order: int


class SavePackageRequest(BaseModel):
    path: str | None = None


class MediaImportRequest(BaseModel):
    paths: list[str]
    template_asset: bool = False


class ImportProjectRequest(BaseModel):
    path: str


class TableInspectRequest(BaseModel):
    path: str
    sheet_name: str | None = None


class TableCreateRequest(BaseModel):
    path: str
    sheet_name: str | None = None
    first_row_is_header: bool = False
    field_names: list[str]
    deck_name: str = "새 덱"
    note_type_name: str = "기본"
    front_field: int = 0
    back_field: int = 1
    template_source_path: str | None = None
    template_note_type_id: str | None = None
    field_mapping: dict[str, int] | None = None


class NoteTypeSourceRequest(BaseModel):
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
        "source_name": _package.display_name or _package.source.name,
        "media_count": len(_package.media),
        "note_types": [_note_type_data(note_type) for note_type in _package.note_types],
        "selected_note_type_id": _selected_note_type_id,
        "requires_save_as": _requires_save_as,
    }


def _read_note_type_source(path: str | Path) -> tuple[DeckPackage, Path | None]:
    """Read an APKG or an exported Anki Helper project as a reusable design source."""
    source = Path(path)
    if source.suffix.lower() != ".zip":
        return read_apkg(source), None
    try:
        with zipfile.ZipFile(source) as archive:
            if "source/original.apkg" not in archive.namelist():
                raise ValueError("노트 유형 원본으로는 APKG 또는 Anki Helper 편집 프로젝트 ZIP을 선택해 주세요.")
            temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-note-type-source-", suffix=".apkg", delete=False)
            temporary.write(archive.read("source/original.apkg")); temporary.close()
    except zipfile.BadZipFile as exc:
        raise ValueError("읽을 수 없는 노트 유형 원본 파일입니다.") from exc
    package = read_apkg(temporary.name)
    import_project(package, source)
    return package, Path(temporary.name)


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


@app.put("/api/workspace/selected-note-type")
def select_note_type(payload: SelectedNoteType) -> dict:
    global _selected_note_type_id
    _get_note_type(payload.note_type_id)
    _selected_note_type_id = payload.note_type_id
    return _workspace_data() or {}


@app.post("/api/packages/open")
def open_package(payload: OpenPackageRequest) -> dict:
    global _package, _selected_note_type_id, _requires_save_as
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    previous_package, previous_requires_save_as = _package, _requires_save_as
    staged_source: Path | None = None
    try:
        if source.suffix.lower() == ".zip":
            with zipfile.ZipFile(source) as archive:
                if "source/original.apkg" not in archive.namelist():
                    raise ApkgReadError("이 편집 프로젝트에는 원본 APKG가 포함되어 있지 않습니다. 새로 내보낸 편집 프로젝트를 사용해 주세요.")
                temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-project-", suffix=".apkg", delete=False)
                temporary.write(archive.read("source/original.apkg")); temporary.close()
                staged_source = Path(temporary.name)
            package = read_apkg(staged_source)
            import_project(package, source)
            requires_save_as = True
        else:
            package = read_apkg(source)
            requires_save_as = False
    except (ApkgReadError, ValueError, zipfile.BadZipFile) as exc:
        if staged_source:
            staged_source.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _package = package
    _requires_save_as = requires_save_as
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    _selected_note_type_id = _package.note_types[0].id if _package.note_types else None
    return _workspace_data() or {}


@app.post("/api/tables/inspect")
def inspect_table(payload: TableInspectRequest) -> dict:
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    try:
        table = inspect_table_source(source, payload.sheet_name)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "source_name": table.source_name,
        "kind": table.kind,
        "sheet_names": table.sheet_names,
        "selected_sheet": table.selected_sheet,
        "row_count": len(table.rows),
        "column_count": max((len(row) for row in table.rows), default=0),
        "omitted_empty_columns": table.omitted_empty_columns,
        "sample_rows": table.rows[:10],
    }


@app.post("/api/note-types/source")
def inspect_note_type_source(payload: NoteTypeSourceRequest) -> dict:
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    temporary: Path | None = None
    try:
        package, temporary = _read_note_type_source(source)
        return {
            "source_name": source.name,
            "note_types": [
                {"id": item.id, "name": item.name, "fields": [asdict(field) for field in item.fields], "template_count": len(item.templates)}
                for item in package.note_types
            ],
        }
    except (OSError, ValueError, zipfile.BadZipFile, ApkgReadError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


@app.post("/api/tables/create")
def create_from_table(payload: TableCreateRequest) -> dict:
    global _package, _selected_note_type_id, _requires_save_as
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    template_temporary: Path | None = None
    previous_package, previous_requires_save_as = _package, _requires_save_as
    try:
        table = inspect_table_source(source, payload.sheet_name)
        rows = table.rows[1:] if payload.first_row_is_header else table.rows
        if payload.template_source_path and payload.template_note_type_id:
            template_package, template_temporary = _read_note_type_source(payload.template_source_path)
            template = next((item for item in template_package.note_types if item.id == payload.template_note_type_id), None)
            if template is None:
                raise ValueError("선택한 노트 유형을 원본 파일에서 찾지 못했습니다.")
            try:
                mapping = {int(source_order): int(destination_order) for source_order, destination_order in (payload.field_mapping or {}).items()}
            except (TypeError, ValueError) as exc:
                raise ValueError("필드 연결 정보가 올바르지 않습니다.") from exc
            if not mapping:
                raise ValueError("엑셀 열과 노트 유형 필드를 하나 이상 연결해 주세요.")
            mapped_rows = []
            for row in rows:
                mapped = [""] * len(template.fields)
                for source_order, destination_order in mapping.items():
                    if 0 <= source_order < len(row) and 0 <= destination_order < len(mapped):
                        mapped[destination_order] = row[source_order]
                mapped_rows.append(mapped)
            package = create_package_from_table(
                [field.name for field in template.fields],
                mapped_rows,
                deck_name=payload.deck_name,
                note_type_name=template.name,
                front_field=0,
                back_field=min(1, len(template.fields) - 1),
                template=template,
                template_package=template_package,
            )
        else:
            package = create_package_from_table(
                payload.field_names,
                rows,
                deck_name=payload.deck_name,
                note_type_name=payload.note_type_name,
                front_field=payload.front_field,
                back_field=payload.back_field,
            )
    except (OSError, ValueError, sqlite3.DatabaseError, zipfile.BadZipFile, ApkgReadError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if template_temporary:
            template_temporary.unlink(missing_ok=True)
    _package = package
    _requires_save_as = True
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    _selected_note_type_id = _package.note_types[0].id
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
    previous_package, previous_requires_save_as = _package, _requires_save_as
    try:
        target, backup = save_apkg(_package, destination, backup=not _requires_save_as)
        _package = read_apkg(target)
        _requires_save_as = False
    except (OSError, sqlite3.DatabaseError, zipfile.BadZipFile, ApkgReadError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"APKG 저장에 실패했습니다: {exc}") from exc
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    if selected_name:
        _selected_note_type_id = next((item.id for item in _package.note_types if item.name == selected_name), _package.note_types[0].id if _package.note_types else None)
    return {"workspace": _workspace_data(), "saved_to": str(target), "backup": str(backup) if backup else None}


@app.get("/api/media")
def list_media() -> list[dict]:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    return media_items(_package)


@app.post("/api/media/import")
def add_media(payload: MediaImportRequest) -> dict:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    if not payload.paths:
        raise HTTPException(status_code=400, detail="추가할 미디어 파일을 선택해주세요.")
    try:
        added = import_media(_package, payload.paths, template_asset=payload.template_asset)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"workspace": _workspace_data(), "items": added}


@app.delete("/api/media/{stored_name}")
def delete_media(stored_name: str) -> dict:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        remove_media(_package, stored_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"workspace": _workspace_data()}


@app.get("/api/media/{stored_name}")
def download_media(stored_name: str) -> FileResponse:
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    item = next((entry for entry in media_items(_package) if entry["stored_name"] == stored_name), None)
    if item is None:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾지 못했습니다.")
    staged_path = _package.pending_media.get(stored_name)
    if staged_path and staged_path.is_file():
        return FileResponse(staged_path, filename=item["name"], media_type=mimetypes.guess_type(item["name"])[0] or "application/octet-stream")
    with zipfile.ZipFile(_package.source) as archive:
        temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-media-", suffix=Path(item["name"]).suffix, delete=False)
        temporary.write(archive.read(stored_name)); temporary.close()
    return _temporary_file_response(
        Path(temporary.name),
        filename=item["name"],
        media_type=mimetypes.guess_type(item["name"])[0] or "application/octet-stream",
    )


@app.post("/api/projects/import")
def import_edit_project(payload: ImportProjectRequest) -> dict:
    global _requires_save_as
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        note_type = import_project(_package, payload.path)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _requires_save_as = True
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


@app.get("/api/note-types/{note_type_id}/fields/{field_order}/content-summary")
def field_content_summary(note_type_id: str, field_order: int) -> dict:
    note_type = _get_note_type(note_type_id)
    if not 0 <= field_order < len(note_type.fields):
        raise HTTPException(status_code=404, detail="필드를 찾지 못했습니다.")
    filled = 0
    text_only = 0
    media_only = 0
    mixed = 0
    destination_filled = {field.order: 0 for field in note_type.fields if field.order != field_order}
    for values in note_type.notes:
        while len(values) < len(note_type.fields):
            values.append("")
        kind = field_content_kind(values[field_order])
        if kind != "empty":
            filled += 1
        if kind == "text":
            text_only += 1
        elif kind == "media":
            media_only += 1
        elif kind == "mixed":
            mixed += 1
        for order in destination_filled:
            if values[order].strip():
                destination_filled[order] += 1
    sample = next((values[field_order] for values in note_type.notes if values[field_order].strip()), "")
    sample_text, sample_media = split_field_content(sample)
    return {
        "field_order": field_order,
        "filled": filled,
        "text_only": text_only,
        "media_only": media_only,
        "mixed": mixed,
        "has_mixed": mixed > 0,
        "destination_filled": destination_filled,
        "sample_text": sample_text[:80],
        "sample_media": sample_media[:120],
    }


@app.post("/api/note-types/{note_type_id}/fields/{field_order}/move")
def move_field_contents(note_type_id: str, field_order: int, payload: FieldMove) -> dict:
    note_type = _get_note_type(note_type_id)
    try:
        changed = move_note_field_contents(note_type, field_order, payload.destination_order, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    workspace = _workspace_data() or {}
    return {"workspace": workspace, "changed": changed}


@app.post("/api/note-types/{note_type_id}/fields/{field_order}/reorder")
def reorder_note_field(note_type_id: str, field_order: int, payload: FieldReorder) -> dict:
    note_type = _get_note_type(note_type_id)
    try:
        reorder_field(note_type, field_order, payload.new_order)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
    copied = save_as_note_type(_package, source, name, move_cards=payload.move_cards)
    _selected_note_type_id = copied.id
    return _workspace_data() or {}


@app.delete("/api/note-types/{note_type_id}")
def delete_note_type(note_type_id: str) -> dict:
    global _selected_note_type_id
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        remove_note_type(_package, note_type_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if _selected_note_type_id == note_type_id:
        _selected_note_type_id = _package.note_types[0].id if _package.note_types else None
    return _workspace_data() or {}


@app.post("/api/note-types/{note_type_id}/move-notes")
def move_notes(note_type_id: str, payload: NoteTypeMoveNotes) -> dict:
    global _selected_note_type_id
    if _package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    source = _get_note_type(note_type_id)
    destination = _get_note_type(payload.destination_id)
    mapping = None
    if payload.mapping is not None:
        try:
            mapping = {int(source_order): int(destination_order) for source_order, destination_order in payload.mapping.items()}
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="필드 대응 정보가 올바르지 않습니다.") from exc
    try:
        moved = move_notes_between_types(_package, source, destination, mapping)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _selected_note_type_id = destination.id
    return {"workspace": _workspace_data(), "moved": moved}


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
    return _temporary_file_response(target, filename=filename, media_type="application/octet-stream")


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
