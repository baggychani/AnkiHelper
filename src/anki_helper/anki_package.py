from __future__ import annotations

import csv
import html
import io
import json
import os
import re
import sqlite3
import tempfile
import shutil
from datetime import datetime
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


FIELD_TOKEN = re.compile(r"{{(?:#|\^)?\s*([^{}:#]+?)(?::[^{}]+)?\s*}}")


@dataclass(slots=True)
class Field:
    name: str
    order: int


@dataclass(slots=True)
class Template:
    name: str
    front: str
    back: str


@dataclass(slots=True)
class NoteType:
    id: str
    name: str
    fields: list[Field]
    templates: list[Template]
    css: str
    notes: list[list[str]]
    source_id: str | None = None


@dataclass(slots=True)
class DeckPackage:
    source: Path
    note_types: list[NoteType]
    media: dict[str, str]
    archive_entries: set[str]
    database_name: str
    note_ids: dict[str, list[int]]


class ApkgReadError(RuntimeError):
    pass


def read_apkg(path: str | Path) -> DeckPackage:
    """Read the parts of an Anki package needed to edit and export a note type."""
    source = Path(path)
    if source.suffix.lower() != ".apkg":
        raise ApkgReadError("APKG 파일만 열 수 있습니다.")

    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ApkgReadError("손상되었거나 읽을 수 없는 APKG 파일입니다.") from exc

    with archive:
        entries = {entry.filename for entry in archive.infolist()}
        db_name = _find_collection(entries)
        if not db_name:
            raise ApkgReadError("Anki 컬렉션 데이터베이스를 찾지 못했습니다.")
        media = _read_media_map(archive, entries)
        database_bytes = archive.read(db_name)
        if db_name.endswith(".anki21b"):
            database_bytes = _decompress_anki21b(database_bytes)

    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".anki2", delete=False) as temp:
            temp.write(database_bytes)
            temp_name = temp.name
        return _read_legacy_collection(source, Path(temp_name), media, entries, db_name)
    except sqlite3.DatabaseError as exc:
        raise ApkgReadError(
            "이 APKG의 컬렉션 형식을 읽지 못했습니다. Anki에서 '내보내기 → 구형 호환' 형식으로 다시 내보낸 뒤 열어 주세요."
        ) from exc
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def _find_collection(entries: set[str]) -> str | None:
    # collection.anki2 remains the most portable reader target when both forms exist.
    # Modern APKG exports contain the full collection as a Zstandard-compressed
    # collection.anki21b, plus a small legacy compatibility database.
    for name in ("collection.anki21b", "collection.anki21", "collection.anki2"):
        if name in entries:
            return name
    return None


def _decompress_anki21b(data: bytes) -> bytes:
    try:
        import zstandard
    except ImportError as exc:
        raise ApkgReadError("최신 Anki 덱을 열려면 zstandard 패키지가 필요합니다.") from exc
    try:
        # APKG uses a streaming Zstandard frame without a declared final size.
        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data)) as reader:
            return reader.read()
    except zstandard.ZstdError as exc:
        raise ApkgReadError("최신 Anki 컬렉션 압축을 해제하지 못했습니다.") from exc


def _read_media_map(archive: zipfile.ZipFile, entries: set[str]) -> dict[str, str]:
    if "media" not in entries:
        return {}
    try:
        content = archive.read("media")
        if content.startswith(b"\x28\xb5\x2f\xfd"):
            content = _decompress_anki21b(content)
        try:
            raw = json.loads(content.decode("utf-8"))
            return {str(stored): str(original) for stored, original in raw.items()}
        except (UnicodeDecodeError, json.JSONDecodeError):
            # collection.anki21b stores media metadata as protobuf. APKG media
            # payload entries retain the metadata message's zero-based order.
            output: dict[str, str] = {}
            for index, entry in enumerate(_protobuf_parts(content).get(1, [])):
                name = _decode_protobuf_text(_protobuf_parts(entry), 1)
                if name:
                    output[str(index)] = name
            return output
    except (OSError, AttributeError, ValueError):
        return {}


def _read_legacy_collection(
    source: Path, database_path: Path, media: dict[str, str], entries: set[str], database_name: str
) -> DeckPackage:
    connection = sqlite3.connect(database_path)
    try:
        models_json = connection.execute("SELECT models FROM col").fetchone()
        if not models_json:
            raise ApkgReadError("노트 타입 정보를 찾지 못했습니다.")
        if not models_json[0]:
            return _read_normalized_collection(source, connection, media, entries, database_name)
        models: dict[str, Any] = json.loads(models_json[0])
        rows = connection.execute("SELECT id, mid, flds FROM notes ORDER BY id").fetchall()
    finally:
        connection.close()

    notes_by_model: dict[str, list[list[str]]] = {}
    note_ids: dict[str, list[int]] = {}
    for note_id, model_id, fields in rows:
        notes_by_model.setdefault(str(model_id), []).append(str(fields).split("\x1f"))
        note_ids.setdefault(str(model_id), []).append(int(note_id))

    note_types: list[NoteType] = []
    for model_id, model in models.items():
        fields = [Field(name=item["name"], order=int(item["ord"])) for item in model.get("flds", [])]
        templates = [
            Template(name=item["name"], front=item.get("qfmt", ""), back=item.get("afmt", ""))
            for item in model.get("tmpls", [])
        ]
        note_types.append(
            NoteType(
                id=str(model_id),
                name=model.get("name", "이름 없는 노트 타입"),
                fields=fields,
                templates=templates,
                css=model.get("css", ""),
                notes=notes_by_model.get(str(model_id), []),
            )
        )
    return DeckPackage(source=source, note_types=note_types, media=media, archive_entries=entries, database_name=database_name, note_ids=note_ids)


def _read_normalized_collection(
    source: Path, connection: sqlite3.Connection, media: dict[str, str], entries: set[str], database_name: str
) -> DeckPackage:
    """Read Anki's normalized schema used inside collection.anki21b."""
    # The source DB may reference Anki's custom ``unicase`` collation, which
    # Python's SQLite build does not register; stable ids avoid depending on it.
    note_type_rows = connection.execute("SELECT id, name, config FROM notetypes ORDER BY id").fetchall()
    fields_by_type: dict[int, list[Field]] = {}
    for type_id, order, name in connection.execute("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord"):
        fields_by_type.setdefault(type_id, []).append(Field(name=name, order=order))

    templates_by_type: dict[int, list[Template]] = {}
    for type_id, _order, name, config in connection.execute("SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord"):
        parts = _protobuf_parts(config)
        templates_by_type.setdefault(type_id, []).append(
            Template(
                name=name,
                front=_decode_protobuf_text(parts, 1),
                back=_decode_protobuf_text(parts, 2),
            )
        )

    notes_by_type: dict[int, list[list[str]]] = {}
    note_ids: dict[str, list[int]] = {}
    for note_id, type_id, fields in connection.execute("SELECT id, mid, flds FROM notes ORDER BY id"):
        notes_by_type.setdefault(type_id, []).append(str(fields).split("\x1f"))
        note_ids.setdefault(str(type_id), []).append(int(note_id))

    note_types: list[NoteType] = []
    for type_id, name, config in note_type_rows:
        parts = _protobuf_parts(config)
        note_types.append(
            NoteType(
                id=str(type_id),
                name=name,
                fields=fields_by_type.get(type_id, []),
                templates=templates_by_type.get(type_id, []),
                css=_decode_protobuf_text(parts, 3),
                notes=notes_by_type.get(type_id, []),
            )
        )
    return DeckPackage(source=source, note_types=note_types, media=media, archive_entries=entries, database_name=database_name, note_ids=note_ids)


def _protobuf_parts(blob: bytes) -> dict[int, list[bytes]]:
    """Read primitive protobuf fields without tying the inspector to Anki internals."""
    values: dict[int, list[bytes]] = {}
    index = 0
    while index < len(blob):
        key, index = _read_varint(blob, index)
        field, wire_type = key >> 3, key & 7
        if wire_type == 0:
            _, index = _read_varint(blob, index)
        elif wire_type == 1:
            index += 8
        elif wire_type == 2:
            length, index = _read_varint(blob, index)
            values.setdefault(field, []).append(blob[index:index + length])
            index += length
        elif wire_type == 5:
            index += 4
        else:
            break
    return values


def _read_varint(data: bytes, index: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while index < len(data):
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7
    raise ValueError("Incomplete protobuf varint")


def _decode_protobuf_text(parts: dict[int, list[bytes]], field: int) -> str:
    value = parts.get(field, [b""])[0]
    return value.decode("utf-8", errors="replace")


def _encode_varint(value: int) -> bytes:
    output = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        output.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(output)


def _replace_protobuf_text(blob: bytes, field_number: int, text: str) -> bytes:
    """Replace one length-delimited protobuf field while preserving unknown data."""
    replacement = text.encode("utf-8")
    output = bytearray()
    index = 0
    replaced = False
    while index < len(blob):
        start = index
        key, index = _read_varint(blob, index)
        field, wire_type = key >> 3, key & 7
        if wire_type == 0:
            _, index = _read_varint(blob, index)
        elif wire_type == 1:
            index += 8
        elif wire_type == 2:
            length, payload_start = _read_varint(blob, index)
            index = payload_start + length
        elif wire_type == 5:
            index += 4
        else:
            raise ValueError("지원하지 않는 protobuf 형식입니다.")
        if field == field_number and wire_type == 2 and not replaced:
            output.extend(_encode_varint((field_number << 3) | 2))
            output.extend(_encode_varint(len(replacement)))
            output.extend(replacement)
            replaced = True
        else:
            output.extend(blob[start:index])
    if not replaced:
        output.extend(_encode_varint((field_number << 3) | 2))
        output.extend(_encode_varint(len(replacement)))
        output.extend(replacement)
    return bytes(output)


def _compress_anki21b(data: bytes) -> bytes:
    try:
        import zstandard
    except ImportError as exc:
        raise ApkgReadError("최신 Anki 덱을 저장하려면 zstandard 패키지가 필요합니다.") from exc
    return zstandard.ZstdCompressor(level=3).compress(data)


def _backup_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    backup_dir = base / "Anki Helper" / "Backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


def _backup_source(source: Path) -> Path:
    backup_dir = _backup_dir()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{source.stem}_{stamp}{source.suffix}"
    counter = 1
    while backup.exists():
        backup = backup_dir / f"{source.stem}_{stamp}-{counter}{source.suffix}"
        counter += 1
    shutil.copy2(source, backup)
    return backup


def _write_legacy_changes(connection: sqlite3.Connection, package: DeckPackage) -> None:
    row = connection.execute("SELECT models FROM col").fetchone()
    models: dict[str, Any] = json.loads(row[0])
    for note_type in package.note_types:
        if note_type.id in models or not note_type.source_id or note_type.source_id not in models:
            continue
        new_id = str(max([int(key) for key in models if str(key).isdigit()] + [int(datetime.now().timestamp() * 1000)]) + 1)
        model = json.loads(json.dumps(models[note_type.source_id]))
        model["id"] = int(new_id)
        model["name"] = note_type.name
        models[new_id] = model
        note_type.id = new_id
        package.note_ids[new_id] = []
    for note_type in package.note_types:
        model = models.get(note_type.id)
        if model is None:
            continue
        original_fields = model.get("flds", [])
        model["flds"] = [
            {**(original_fields[index] if index < len(original_fields) else {"font": "Arial", "size": 20, "rtl": False, "sticky": False}), "name": field.name, "ord": index}
            for index, field in enumerate(note_type.fields)
        ]
        original_templates = model.get("tmpls", [])
        for index, template in enumerate(note_type.templates):
            if index < len(original_templates):
                original_templates[index]["name"] = template.name
                original_templates[index]["qfmt"] = template.front
                original_templates[index]["afmt"] = template.back
        model["css"] = note_type.css
        for note_id, values in zip(package.note_ids.get(note_type.id, []), note_type.notes):
            connection.execute("UPDATE notes SET flds=?, mod=strftime('%s','now'), usn=-1 WHERE id=?", ("\x1f".join(values), note_id))
    connection.execute("UPDATE col SET models=?, mod=strftime('%s','now'), usn=-1", (json.dumps(models, ensure_ascii=False),))


def _write_normalized_changes(connection: sqlite3.Connection, package: DeckPackage) -> None:
    for note_type in package.note_types:
        if note_type.id.isdigit() or not note_type.source_id or not note_type.source_id.isdigit():
            continue
        source_id = int(note_type.source_id)
        new_id = max(int(connection.execute("SELECT COALESCE(MAX(id), 0) FROM notetypes").fetchone()[0]) + 1, int(datetime.now().timestamp() * 1000))
        source_row = connection.execute("SELECT mtime_secs, usn, config FROM notetypes WHERE id=?", (source_id,)).fetchone()
        if source_row is None:
            continue
        config = _replace_protobuf_text(source_row[2], 3, note_type.css)
        connection.execute("INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, strftime('%s','now'), -1, ?)", (new_id, note_type.name, config))
        source_fields = connection.execute("SELECT ord, config FROM fields WHERE ntid=? ORDER BY ord", (source_id,)).fetchall()
        for index, field in enumerate(note_type.fields):
            field_config = source_fields[index][1] if index < len(source_fields) else b""
            connection.execute("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", (new_id, index, field.name, field_config))
        source_templates = connection.execute("SELECT ord, mtime_secs, usn, config FROM templates WHERE ntid=? ORDER BY ord", (source_id,)).fetchall()
        for index, template in enumerate(note_type.templates):
            template_config = source_templates[index][3] if index < len(source_templates) else b""
            template_config = _replace_protobuf_text(_replace_protobuf_text(template_config, 1, template.front), 2, template.back)
            connection.execute("INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, strftime('%s','now'), -1, ?)", (new_id, index, template.name, template_config))
        note_type.id = str(new_id)
        package.note_ids[note_type.id] = []
    for note_type in package.note_types:
        if not note_type.id.isdigit():
            continue
        type_id = int(note_type.id)
        existing = connection.execute("SELECT ord, config FROM fields WHERE ntid=? ORDER BY ord", (type_id,)).fetchall()
        connection.execute("DELETE FROM fields WHERE ntid=?", (type_id,))
        for index, field in enumerate(note_type.fields):
            config = existing[index][1] if index < len(existing) else b""
            connection.execute("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", (type_id, index, field.name, config))
        for index, template in enumerate(note_type.templates):
            row = connection.execute("SELECT config FROM templates WHERE ntid=? AND ord=?", (type_id, index)).fetchone()
            if row:
                config = _replace_protobuf_text(_replace_protobuf_text(row[0], 1, template.front), 2, template.back)
                connection.execute("UPDATE templates SET name=?, config=? WHERE ntid=? AND ord=?", (template.name, config, type_id, index))
        row = connection.execute("SELECT config FROM notetypes WHERE id=?", (type_id,)).fetchone()
        if row:
            connection.execute("UPDATE notetypes SET name=?, config=?, mtime_secs=strftime('%s','now'), usn=-1 WHERE id=?", (note_type.name, _replace_protobuf_text(row[0], 3, note_type.css), type_id))
        for note_id, values in zip(package.note_ids.get(note_type.id, []), note_type.notes):
            connection.execute("UPDATE notes SET flds=?, mod=strftime('%s','now'), usn=-1 WHERE id=?", ("\x1f".join(values), note_id))


def save_apkg(package: DeckPackage, destination: str | Path | None = None, *, backup: bool = True) -> tuple[Path, Path | None]:
    """Persist edits into the real Anki collection and repack the APKG."""
    target = Path(destination) if destination else package.source
    backup_path = _backup_source(package.source) if backup else None
    with zipfile.ZipFile(package.source) as source_archive:
        database = source_archive.read(package.database_name)
        if package.database_name.endswith(".anki21b"):
            database = _decompress_anki21b(database)
        with tempfile.NamedTemporaryFile(suffix=".anki2", delete=False) as temporary:
            temporary.write(database)
            database_path = Path(temporary.name)
        try:
            connection = sqlite3.connect(database_path)
            try:
                connection.create_collation("unicase", lambda left, right: (left.casefold() > right.casefold()) - (left.casefold() < right.casefold()))
                normalized = bool(connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").fetchone())
                (_write_normalized_changes if normalized else _write_legacy_changes)(connection, package)
                connection.commit()
            finally:
                connection.close()
            updated_database = database_path.read_bytes()
            if package.database_name.endswith(".anki21b"):
                updated_database = _compress_anki21b(updated_database)
            temp_output = target.with_suffix(target.suffix + ".tmp")
            with zipfile.ZipFile(temp_output, "w", zipfile.ZIP_DEFLATED) as output:
                for item in source_archive.infolist():
                    payload = updated_database if item.filename == package.database_name else source_archive.read(item.filename)
                    output.writestr(item, payload)
        finally:
            database_path.unlink(missing_ok=True)
    temp_output.replace(target)
    if target.resolve() == package.source.resolve():
        package.source = target
    return target, backup_path


def render_template(template: str, fields: list[Field], values: list[str], front_html: str = "") -> str:
    """A deliberately small, predictable preview renderer for common Anki fields."""
    field_values = {
        field.name: values[field.order] if field.order < len(values) else ""
        for field in fields
    }

    def replace(match: re.Match[str]) -> str:
        token = match.group(0)
        name = match.group(1).strip()
        if name == "FrontSide":
            return front_html
        value = field_values.get(name, "")
        # Preserve stored HTML but make plain TSV text readable in preview.
        return value.replace("\n", "<br>")

    result = FIELD_TOKEN.sub(replace, template)
    result = result.replace("{{FrontSide}}", front_html)
    return _strip_anki_controls(result)


def _strip_anki_controls(markup: str) -> str:
    markup = re.sub(r"{{[\^#][^}]+}}", "", markup)
    markup = re.sub(r"{{/[^}]+}}", "", markup)
    # Keep the filename as a marker. The local API can replace it with the
    # actual audio bytes from the APKG archive for the live preview.
    markup = re.sub(r"\[sound:([^\]]+)\]", r"<span class='sound' data-sound='\1'>🔊 \1</span>", markup)
    return markup


def export_tsv(note_type: NoteType, destination: str | Path) -> Path:
    target = Path(destination)
    with target.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t")
        writer.writerow([field.name for field in note_type.fields])
        writer.writerows(note_type.notes)
    return target


def design_document(note_type: NoteType) -> dict[str, Any]:
    return {
        "format": "anki-helper/design-v1",
        "note_type": note_type.name,
        "fields": [asdict(field) for field in note_type.fields],
        "templates": [asdict(template) for template in note_type.templates],
        "css": note_type.css,
    }


def export_design(note_type: NoteType, destination: str | Path) -> Path:
    target = Path(destination)
    target.write_text(json.dumps(design_document(note_type), ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def media_items(package: DeckPackage) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with zipfile.ZipFile(package.source) as archive:
        for stored_name, original_name in package.media.items():
            if stored_name not in package.archive_entries:
                continue
            info = archive.getinfo(stored_name)
            media_type = "audio" if Path(original_name).suffix.lower() in {".mp3", ".wav", ".ogg", ".m4a", ".flac"} else "image" if Path(original_name).suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"} else "other"
            items.append({"name": original_name, "stored_name": stored_name, "size": info.file_size, "type": media_type})
    return sorted(items, key=lambda item: item["name"].casefold())


def export_media(package: DeckPackage, destination: str | Path) -> Path:
    target = Path(destination)
    with zipfile.ZipFile(package.source) as source, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for item in media_items(package):
            output.writestr(f"media/{item['name']}", source.read(item["stored_name"]))
    return target


def export_project(package: DeckPackage, note_type: NoteType, destination: str | Path) -> Path:
    """Create an editable, documented round-trip project archive."""
    target = Path(destination)
    safe_model = re.sub(r'[\\/:*?"<>|]', "_", note_type.name)
    manifest = {
        "format": "anki-helper/project-v1",
        "sourceApkg": package.source.name,
        "noteTypeId": note_type.id,
        "noteType": note_type.name,
        "fields": [field.name for field in note_type.fields],
        "templates": [template.name for template in note_type.templates],
        "mediaPolicy": "preserve",
        "identityPolicy": "note-id-preserve",
        "instructions": "notes.tsv의 __note_id 열은 기존 노트 연결용입니다. 삭제하거나 변경하지 마세요.",
    }
    note_ids = package.note_ids.get(note_type.id, [])
    output_stream = io.StringIO(newline="")
    writer = csv.writer(output_stream, delimiter="\t", lineterminator="\n")
    writer.writerow(["__note_id", "__note_type", *[field.name for field in note_type.fields]])
    for index, values in enumerate(note_type.notes):
        writer.writerow([note_ids[index] if index < len(note_ids) else "", note_type.name, *values])
    guide = """Anki Helper 왕복 편집 프로젝트 (.zip)\n\n1. notes.tsv를 Excel 또는 스프레드시트에서 엽니다.\n2. __note_id와 __note_type 열은 수정하지 않습니다.\n3. 일반 필드만 편집합니다.\n4. 파일을 UTF-8 TSV 형식으로 저장합니다.\n5. ZIP 구조를 유지한 채 다시 압축합니다.\n6. Anki Helper의 '파일 열기'에서 편집 프로젝트 ZIP을 선택합니다.\n7. 내용을 확인한 뒤 '저장'을 눌러 새 APKG의 위치를 선택합니다.\n\nmodels 폴더의 HTML/CSS도 편집할 수 있습니다. source/original.apkg는 왕복 편집의 기준 파일이므로 삭제하지 마세요.\n"""
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        output.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        output.writestr("notes.tsv", "\ufeff" + output_stream.getvalue())
        output.writestr("README.txt", guide)
        output.write(package.source, "source/original.apkg")
        output.writestr(f"models/{safe_model}/model.json", json.dumps(design_document(note_type), ensure_ascii=False, indent=2))
        output.writestr(f"models/{safe_model}/style.css", note_type.css)
        for index, template in enumerate(note_type.templates, 1):
            output.writestr(f"models/{safe_model}/card_{index}_front.html", template.front)
            output.writestr(f"models/{safe_model}/card_{index}_back.html", template.back)
        with zipfile.ZipFile(package.source) as source:
            for item in media_items(package):
                output.writestr(f"media/{item['name']}", source.read(item["stored_name"]))
    return target


def import_project(package: DeckPackage, source: str | Path) -> NoteType:
    with zipfile.ZipFile(source) as archive:
        try:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
            rows = list(csv.DictReader(io.StringIO(archive.read("notes.tsv").decode("utf-8-sig")), delimiter="\t"))
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Anki Helper 편집 프로젝트 형식이 아닙니다.") from exc
        note_type = next((item for item in package.note_types if item.id == str(manifest.get("noteTypeId"))), None)
        if note_type is None:
            raise ValueError("이 프로젝트와 연결된 노트 유형을 현재 APKG에서 찾지 못했습니다.")
        fields = [field.name for field in note_type.fields]
        by_id = {str(note_id): index for index, note_id in enumerate(package.note_ids.get(note_type.id, []))}
        for row in rows:
            index = by_id.get(str(row.get("__note_id", "")))
            if index is not None:
                note_type.notes[index] = [row.get(name, "") for name in fields]
        safe_model = re.sub(r'[\\/:*?"<>|]', "_", note_type.name)
        css_path = f"models/{safe_model}/style.css"
        if css_path in archive.namelist():
            note_type.css = archive.read(css_path).decode("utf-8-sig")
        for index, template in enumerate(note_type.templates, 1):
            front = f"models/{safe_model}/card_{index}_front.html"
            back = f"models/{safe_model}/card_{index}_back.html"
            if front in archive.namelist():
                template.front = archive.read(front).decode("utf-8-sig")
            if back in archive.namelist():
                template.back = archive.read(back).decode("utf-8-sig")
    return note_type


def export_bundle(package: DeckPackage, note_type: NoteType, destination: str | Path) -> Path:
    target = Path(destination)
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        export_tsv(note_type, folder / "input.tsv")
        export_design(note_type, folder / "design.json")
        with zipfile.ZipFile(package.source) as source_archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
            output.write(folder / "input.tsv", "input.tsv")
            output.write(folder / "design.json", "design.json")
            for stored_name, original_name in package.media.items():
                if stored_name in package.archive_entries:
                    output.writestr(f"media/{original_name}", source_archive.read(stored_name))
    return target
