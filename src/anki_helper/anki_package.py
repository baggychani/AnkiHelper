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
import zlib
import xml.etree.ElementTree as ET
from copy import deepcopy
from datetime import datetime
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4


FIELD_TOKEN = re.compile(r"{{(?:#|\^)?\s*([^{}:#]+?)(?::[^{}]+)?\s*}}")
MEDIA_TOKEN = re.compile(r"\[sound:[^\]]+\]|<img\b[^>]*>", re.IGNORECASE)


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
    removed_note_type_ids: list[str] = field(default_factory=list)
    display_name: str | None = None
    pending_media: dict[str, Path] = field(default_factory=dict)
    removed_media: set[str] = field(default_factory=set)


class ApkgReadError(RuntimeError):
    pass


@dataclass(slots=True)
class TablePreview:
    """A worksheet-shaped view of a structured source file.

    The importer deliberately keeps this separate from Anki fields: a sheet's
    first row is only a suggestion until the user confirms it in the UI.
    """

    source_name: str
    kind: str
    sheet_names: list[str]
    selected_sheet: str
    rows: list[list[str]]
    omitted_empty_columns: int = 0


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


def _note_checksum(value: str) -> int:
    return zlib.crc32(value.encode("utf-8")) & 0xFFFFFFFF


def split_field_content(value: str) -> tuple[str, str]:
    """Separate plain text from Anki media markers in one field cell.

    Media tokens (`[sound:…]`, `<img …>`) are returned exactly as stored so
    playback filenames stay intact after move/split operations.
    """
    raw = value or ""
    media_parts = [match.group(0) for match in MEDIA_TOKEN.finditer(raw)]
    text = MEDIA_TOKEN.sub(" ", raw)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    media = " ".join(media_parts).strip()
    return text, media


def field_content_kind(value: str) -> Literal["empty", "text", "media", "mixed"]:
    text, media = split_field_content(value)
    if text and media:
        return "mixed"
    if media:
        return "media"
    if text:
        return "text"
    return "empty"


def _join_field_parts(text: str, media: str) -> str:
    """Rebuild a cell as text then media tags, without altering tag contents."""
    parts = [part for part in (text.strip(), media.strip()) if part]
    return " ".join(parts).strip()


def move_field_piece(source: str, destination: str, mode: Literal["text", "media", "all"]) -> tuple[str, str]:
    """Move text, media markers, or the whole cell from source into destination."""
    if mode == "all":
        moved = (source or "").strip()
        if not moved:
            return source or "", destination or ""
        if (destination or "").strip():
            return "", f"{destination.strip()} {moved}".strip()
        return "", moved

    source_text, source_media = split_field_content(source)
    dest_text, dest_media = split_field_content(destination)

    if mode == "text":
        if not source_text:
            return source or "", destination or ""
        dest_text = f"{dest_text} {source_text}".strip() if dest_text else source_text
        source_text = ""
    else:
        if not source_media:
            return source or "", destination or ""
        # Keep each [sound:…] / <img> token verbatim; only separate tokens with spaces.
        dest_media = f"{dest_media} {source_media}".strip() if dest_media else source_media
        source_media = ""

    return _join_field_parts(source_text, source_media), _join_field_parts(dest_text, dest_media)


def reorder_field(note_type: NoteType, field_order: int, new_order: int) -> None:
    """Move a field to a new index and keep note values aligned with field order."""
    count = len(note_type.fields)
    if not 0 <= field_order < count:
        raise ValueError("필드를 찾지 못했습니다.")
    if not 0 <= new_order < count:
        raise ValueError("올바른 필드 위치가 아닙니다.")
    if field_order == new_order:
        return

    field = note_type.fields.pop(field_order)
    note_type.fields.insert(new_order, field)
    for index, item in enumerate(note_type.fields):
        item.order = index

    for values in note_type.notes:
        while len(values) < count:
            values.append("")
        value = values.pop(field_order)
        values.insert(new_order, value)


def move_note_field_contents(
    note_type: NoteType,
    source_order: int,
    destination_order: int,
    mode: Literal["text", "media", "all"],
) -> int:
    """Move matching content across every note. Returns how many notes changed."""
    if source_order == destination_order:
        raise ValueError("같은 필드로 이동할 수 없습니다.")
    if not 0 <= source_order < len(note_type.fields):
        raise ValueError("출발 필드를 찾지 못했습니다.")
    if not 0 <= destination_order < len(note_type.fields):
        raise ValueError("도착 필드를 찾지 못했습니다.")

    changed = 0
    for values in note_type.notes:
        while len(values) < len(note_type.fields):
            values.append("")
        before_source = values[source_order]
        before_destination = values[destination_order]
        values[source_order], values[destination_order] = move_field_piece(
            before_source, before_destination, mode
        )
        if values[source_order] != before_source or values[destination_order] != before_destination:
            changed += 1
    return changed


def remap_note_rows(
    source: NoteType,
    destination: NoteType,
    rows: list[list[str]],
    mapping: dict[int, int] | None = None,
) -> list[list[str]]:
    """Map note rows onto another note type.

    ``mapping`` is ``{source_order: destination_order}``. When omitted, fields
    are matched by name and then by shared order.
    """
    if mapping is None:
        mapping = {}
        source_by_name = {field.name: field.order for field in source.fields}
        used_dest: set[int] = set()
        for field in destination.fields:
            if field.name in source_by_name:
                mapping[source_by_name[field.name]] = field.order
                used_dest.add(field.order)
        if len(source.fields) == len(destination.fields):
            for field in source.fields:
                if field.order not in mapping and field.order not in used_dest:
                    mapping[field.order] = field.order

    remapped: list[list[str]] = []
    for row in rows:
        next_row = [""] * len(destination.fields)
        for source_order, destination_order in mapping.items():
            if not 0 <= destination_order < len(destination.fields):
                continue
            next_row[destination_order] = row[source_order] if source_order < len(row) else ""
        remapped.append(next_row)
    return remapped


def move_notes_between_types(
    package: DeckPackage,
    source: NoteType,
    destination: NoteType,
    mapping: dict[int, int] | None = None,
) -> int:
    """Move every note from one note type to another. Returns moved count."""
    if source.id == destination.id:
        raise ValueError("같은 노트 유형으로는 이동할 수 없습니다.")
    moved = len(source.notes)
    if moved == 0:
        return 0
    destination.notes.extend(remap_note_rows(source, destination, source.notes, mapping))
    source_ids = package.note_ids.pop(source.id, [])
    package.note_ids.setdefault(destination.id, []).extend(source_ids)
    source.notes = []
    package.note_ids[source.id] = []
    return moved


def save_as_note_type(package: DeckPackage, source: NoteType, name: str, *, move_cards: bool = True) -> NoteType:
    """Create a new note type from the current one, moving cards by default."""
    copied = deepcopy(source)
    copied.id = str(uuid4())
    copied.name = name
    copied.source_id = source.id
    if move_cards:
        copied.notes = source.notes
        source.notes = []
        package.note_ids[copied.id] = package.note_ids.pop(source.id, [])
        package.note_ids[source.id] = []
    else:
        copied.notes = deepcopy(source.notes)
        package.note_ids[copied.id] = []
    package.note_types.append(copied)
    return copied


def remove_note_type(package: DeckPackage, note_type_id: str) -> None:
    """Remove an empty note type from the working package."""
    index = next((i for i, item in enumerate(package.note_types) if item.id == note_type_id), None)
    if index is None:
        raise ValueError("노트 유형을 찾지 못했습니다.")
    if len(package.note_types) <= 1:
        raise ValueError("노트 유형은 하나 이상 남겨야 합니다.")
    note_type = package.note_types[index]
    if note_type.notes:
        raise ValueError("카드가 있는 노트 유형은 제거할 수 없습니다. 먼저 카드를 옮기세요.")
    if package.note_ids.get(note_type_id):
        raise ValueError("카드가 있는 노트 유형은 제거할 수 없습니다. 먼저 카드를 옮기세요.")
    del package.note_types[index]
    package.note_ids.pop(note_type_id, None)
    package.removed_note_type_ids.append(note_type_id)


def _purge_removed_note_types_legacy(connection: sqlite3.Connection, package: DeckPackage, models: dict[str, Any]) -> None:
    for removed_id in package.removed_note_type_ids:
        models.pop(removed_id, None)
        if not str(removed_id).isdigit():
            continue
        mid = int(removed_id)
        connection.execute("DELETE FROM cards WHERE nid IN (SELECT id FROM notes WHERE mid=?)", (mid,))
        connection.execute("DELETE FROM notes WHERE mid=?", (mid,))
    package.removed_note_type_ids.clear()


def _purge_removed_note_types_normalized(connection: sqlite3.Connection, package: DeckPackage) -> None:
    for removed_id in package.removed_note_type_ids:
        if not str(removed_id).isdigit():
            continue
        type_id = int(removed_id)
        connection.execute("DELETE FROM cards WHERE nid IN (SELECT id FROM notes WHERE mid=?)", (type_id,))
        connection.execute("DELETE FROM notes WHERE mid=?", (type_id,))
        connection.execute("DELETE FROM templates WHERE ntid=?", (type_id,))
        connection.execute("DELETE FROM fields WHERE ntid=?", (type_id,))
        connection.execute("DELETE FROM notetypes WHERE id=?", (type_id,))
    package.removed_note_type_ids.clear()


def _alloc_note_id(connection: sqlite3.Connection) -> int:
    note_id = int(connection.execute("SELECT COALESCE(MAX(id), 0) FROM notes").fetchone()[0]) + 1
    while connection.execute("SELECT 1 FROM notes WHERE id=?", (note_id,)).fetchone():
        note_id += 1
    return note_id


def _alloc_card_id(connection: sqlite3.Connection) -> int:
    card_id = int(connection.execute("SELECT COALESCE(MAX(id), 0) FROM cards").fetchone()[0]) + 1
    while connection.execute("SELECT 1 FROM cards WHERE id=?", (card_id,)).fetchone():
        card_id += 1
    return card_id


def _default_deck_id(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT did FROM cards ORDER BY id LIMIT 1").fetchone()
    return int(row[0]) if row else 1


def _card_defaults(connection: sqlite3.Connection, source_mid: str | None, ord_idx: int) -> tuple[Any, ...]:
    if source_mid and str(source_mid).isdigit():
        row = connection.execute(
            """
            SELECT c.type, c.queue, c.ivl, c.factor, c.reps, c.lapses, c.left, c.flags, c.data
            FROM cards c
            JOIN notes n ON c.nid = n.id
            WHERE n.mid = ? AND c.ord = ?
            LIMIT 1
            """,
            (int(source_mid), ord_idx),
        ).fetchone()
        if row:
            return row
    return (0, 0, 0, 2500, 0, 0, 0, 0, "")


def _sync_note_rows_legacy(connection: sqlite3.Connection, package: DeckPackage, note_type: NoteType, model_id: int) -> None:
    key = str(model_id)
    note_ids = list(package.note_ids.get(key, []))
    mod = int(datetime.now().timestamp())
    deck_id = _default_deck_id(connection)

    if len(note_ids) > len(note_type.notes):
        for note_id in note_ids[len(note_type.notes) :]:
            connection.execute("DELETE FROM cards WHERE nid=?", (note_id,))
            connection.execute("DELETE FROM notes WHERE id=?", (note_id,))
        note_ids = note_ids[: len(note_type.notes)]

    for index, note_id in enumerate(note_ids):
        values = note_type.notes[index]
        connection.execute(
            "UPDATE notes SET flds=?, mid=?, mod=?, usn=-1 WHERE id=?",
            ("\x1f".join(values), model_id, mod, note_id),
        )

    for values in note_type.notes[len(note_ids) :]:
        note_id = _alloc_note_id(connection)
        guid = uuid4().hex[:10]
        sfld = values[0] if values else ""
        connection.execute(
            "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')",
            (note_id, guid, model_id, mod, "\x1f".join(values), sfld, _note_checksum(sfld)),
        )
        note_ids.append(note_id)
        for ord_idx in range(len(note_type.templates)):
            card_id = _alloc_card_id(connection)
            card_type, queue, ivl, factor, reps, lapses, left, flags, data = _card_defaults(connection, note_type.source_id, ord_idx)
            due = int(connection.execute("SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE did=?", (deck_id,)).fetchone()[0])
            connection.execute(
                """
                INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
                VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
                """,
                (card_id, note_id, deck_id, ord_idx, mod, card_type, queue, due, ivl, factor, reps, lapses, left, flags, data),
            )

    package.note_ids[key] = note_ids


def _sync_note_rows_normalized(connection: sqlite3.Connection, package: DeckPackage, note_type: NoteType, type_id: int) -> None:
    key = str(type_id)
    note_ids = list(package.note_ids.get(key, []))
    mod = int(datetime.now().timestamp())
    deck_id = _default_deck_id(connection)

    if len(note_ids) > len(note_type.notes):
        for note_id in note_ids[len(note_type.notes) :]:
            connection.execute("DELETE FROM cards WHERE nid=?", (note_id,))
            connection.execute("DELETE FROM notes WHERE id=?", (note_id,))
        note_ids = note_ids[: len(note_type.notes)]

    for index, note_id in enumerate(note_ids):
        values = note_type.notes[index]
        connection.execute(
            "UPDATE notes SET flds=?, mid=?, mod=?, usn=-1 WHERE id=?",
            ("\x1f".join(values), type_id, mod, note_id),
        )

    for values in note_type.notes[len(note_ids) :]:
        note_id = _alloc_note_id(connection)
        guid = uuid4().hex[:10]
        sfld = values[0] if values else ""
        connection.execute(
            "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')",
            (note_id, guid, type_id, mod, "\x1f".join(values), sfld, _note_checksum(sfld)),
        )
        note_ids.append(note_id)
        for ord_idx in range(len(note_type.templates)):
            card_id = _alloc_card_id(connection)
            card_type, queue, ivl, factor, reps, lapses, left, flags, data = _card_defaults(connection, note_type.source_id, ord_idx)
            due = int(connection.execute("SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE did=?", (deck_id,)).fetchone()[0])
            connection.execute(
                """
                INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
                VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
                """,
                (card_id, note_id, deck_id, ord_idx, mod, card_type, queue, due, ivl, factor, reps, lapses, left, flags, data),
            )

    package.note_ids[key] = note_ids


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
        previous_id = note_type.id
        note_type.id = new_id
        package.note_ids[new_id] = package.note_ids.pop(previous_id, [])
    for note_type in package.note_types:
        model = models.get(note_type.id)
        if model is None:
            continue
        original_fields = model.get("flds", [])
        fields_by_name = {item.get("name"): item for item in original_fields if isinstance(item, dict)}
        model["flds"] = []
        for index, field in enumerate(note_type.fields):
            base = fields_by_name.get(field.name)
            if base is None and index < len(original_fields) and isinstance(original_fields[index], dict):
                # Fall back to position only when the name is brand-new.
                base = original_fields[index] if original_fields[index].get("name") == field.name else None
            if base is None:
                base = {"font": "Arial", "size": 20, "rtl": False, "sticky": False}
            model["flds"].append({**base, "name": field.name, "ord": index})
        original_templates = model.get("tmpls", [])
        for index, template in enumerate(note_type.templates):
            if index < len(original_templates):
                original_templates[index]["name"] = template.name
                original_templates[index]["qfmt"] = template.front
                original_templates[index]["afmt"] = template.back
        model["css"] = note_type.css
        _sync_note_rows_legacy(connection, package, note_type, int(note_type.id))
    _purge_removed_note_types_legacy(connection, package, models)
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
        previous_id = note_type.id
        note_type.id = str(new_id)
        package.note_ids[note_type.id] = package.note_ids.pop(previous_id, [])
    for note_type in package.note_types:
        if not note_type.id.isdigit():
            continue
        type_id = int(note_type.id)
        existing = connection.execute("SELECT ord, name, config FROM fields WHERE ntid=? ORDER BY ord", (type_id,)).fetchall()
        existing_by_name = {name: config for _ord, name, config in existing}
        connection.execute("DELETE FROM fields WHERE ntid=?", (type_id,))
        for index, field in enumerate(note_type.fields):
            config = existing_by_name.get(field.name, b"")
            connection.execute("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", (type_id, index, field.name, config))
        for index, template in enumerate(note_type.templates):
            row = connection.execute("SELECT config FROM templates WHERE ntid=? AND ord=?", (type_id, index)).fetchone()
            if row:
                config = _replace_protobuf_text(_replace_protobuf_text(row[0], 1, template.front), 2, template.back)
                connection.execute("UPDATE templates SET name=?, config=? WHERE ntid=? AND ord=?", (template.name, config, type_id, index))
        row = connection.execute("SELECT config FROM notetypes WHERE id=?", (type_id,)).fetchone()
        if row:
            connection.execute("UPDATE notetypes SET name=?, config=?, mtime_secs=strftime('%s','now'), usn=-1 WHERE id=?", (note_type.name, _replace_protobuf_text(row[0], 3, note_type.css), type_id))
        _sync_note_rows_normalized(connection, package, note_type, type_id)
    _purge_removed_note_types_normalized(connection, package)


def save_apkg(package: DeckPackage, destination: str | Path | None = None, *, backup: bool = True) -> tuple[Path, Path | None]:
    """Persist edits into the real Anki collection and repack the APKG."""
    target = Path(destination) if destination else package.source
    backup_path = _backup_source(package.source) if backup else None
    database_path: Path | None = None
    temp_output: Path | None = None
    try:
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
                media_payload = json.dumps(package.media, ensure_ascii=False).encode("utf-8")
                if "media" in package.archive_entries and source_archive.read("media").startswith(b"\x28\xb5\x2f\xfd"):
                    media_payload = _compress_anki21b(media_payload)
                with zipfile.ZipFile(temp_output, "w", zipfile.ZIP_DEFLATED) as output:
                    for item in source_archive.infolist():
                        if item.filename in package.removed_media:
                            continue
                        payload = updated_database if item.filename == package.database_name else media_payload if item.filename == "media" else source_archive.read(item.filename)
                        output.writestr(item, payload)
                    if "media" not in package.archive_entries:
                        output.writestr("media", media_payload)
                    for stored_name, staged_path in package.pending_media.items():
                        output.write(staged_path, stored_name)
            finally:
                if database_path:
                    database_path.unlink(missing_ok=True)
        if temp_output is None:
            raise ApkgReadError("APKG 저장 임시 파일을 만들지 못했습니다.")
        temp_output.replace(target)
    except Exception:
        if temp_output:
            temp_output.unlink(missing_ok=True)
        raise
    if target.resolve() == package.source.resolve():
        package.source = target
    for staged_path in package.pending_media.values():
        staged_path.unlink(missing_ok=True)
    package.pending_media.clear()
    package.removed_media.clear()
    return target, backup_path


def inspect_table_source(path: str | Path, sheet_name: str | None = None) -> TablePreview:
    """Load a tabular source without assigning meaning to its rows or columns."""
    source = Path(path)
    extension = source.suffix.casefold()
    if extension == ".xlsx":
        sheets = _read_xlsx(source)
        if not sheets:
            raise ValueError("엑셀 파일에서 읽을 수 있는 시트를 찾지 못했습니다.")
        selected = sheet_name if sheet_name in sheets else next(iter(sheets))
        rows, omitted = _drop_empty_columns(sheets[selected])
        return TablePreview(source.name, "xlsx", list(sheets), selected, rows, omitted)
    if extension not in {".csv", ".tsv", ".txt"}:
        raise ValueError("Excel(.xlsx), CSV, TSV 또는 TXT 파일만 가져올 수 있습니다.")
    encoding = "utf-8-sig"
    try:
        content = source.read_text(encoding=encoding)
    except UnicodeDecodeError:
        content = source.read_text(encoding="cp949")
    delimiter = "\t" if extension == ".tsv" else _csv_delimiter(content)
    rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(content), delimiter=delimiter)]
    rows, omitted = _drop_empty_columns(_trim_table(rows))
    return TablePreview(source.name, extension.lstrip("."), ["데이터"], "데이터", rows, omitted)


def create_package_from_table(
    fields: list[str],
    rows: list[list[str]],
    *,
    deck_name: str,
    note_type_name: str,
    front_field: int,
    back_field: int,
    template: NoteType | None = None,
    template_package: DeckPackage | None = None,
) -> DeckPackage:
    """Create a small, portable legacy APKG for a reviewed table.

    The legacy collection schema remains importable by current Anki and is
    intentionally used here because it is self-contained and does not need a
    bundled Anki database as a hidden template.
    """
    clean_fields = [name.strip() for name in fields]
    if not clean_fields or any(not name for name in clean_fields):
        raise ValueError("모든 필드에 이름을 입력해 주세요.")
    if len({name.casefold() for name in clean_fields}) != len(clean_fields):
        raise ValueError("같은 이름의 필드는 사용할 수 없습니다.")
    if not 0 <= front_field < len(clean_fields) or not 0 <= back_field < len(clean_fields):
        raise ValueError("카드 앞면과 뒷면에 사용할 필드를 선택해 주세요.")
    deck_name = deck_name.strip() or "새 덱"
    note_type_name = note_type_name.strip() or "기본"
    values = [
        [str(row[index]).strip() if index < len(row) else "" for index in range(len(clean_fields))]
        for row in rows
    ]
    values = [row for row in values if any(cell for cell in row)]
    if not values:
        raise ValueError("비어 있지 않은 데이터 행이 하나 이상 필요합니다.")

    now = int(datetime.now().timestamp())
    base_id = int(datetime.now().timestamp() * 1000) * 1000
    model_id, deck_id = base_id + 1, base_id + 2
    answer_fields = [name for index, name in enumerate(clean_fields) if index != front_field] or [clean_fields[back_field]]
    answer_markup = "<br>\n".join("{{" + name + "}}" for name in answer_fields)
    templates = (
        [{"name": item.name, "ord": index, "qfmt": item.front, "afmt": item.back, "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0} for index, item in enumerate(template.templates)]
        if template and template.templates
        else [{"name": "Card 1", "ord": 0, "qfmt": "{{" + clean_fields[front_field] + "}}", "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n" + answer_markup, "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}]
    )
    requirements = []
    for index, card_template in enumerate(templates):
        tokens = [match.strip() for match in FIELD_TOKEN.findall(card_template["qfmt"])]
        order = next((index for index, name in enumerate(clean_fields) if name in tokens), front_field)
        requirements.append([index, "any", [order]])
    model = {
        "id": model_id,
        "name": template.name if template else note_type_name,
        "type": 0,
        "mod": now,
        "usn": -1,
        "sortf": front_field,
        "did": None,
        "tmpls": templates,
        "flds": [
            {"name": name, "ord": index, "sticky": False, "rtl": False, "font": "Arial", "size": 20}
            for index, name in enumerate(clean_fields)
        ],
        "css": template.css if template else ".card {\n  font-family: arial;\n  font-size: 20px;\n  line-height: 1.5;\n  text-align: center;\n  color: black;\n  background-color: white;\n}\n",
        "latexPre": "", "latexPost": "", "latexsvg": False,
        "req": requirements,
    }
    deck = {"id": deck_id, "mod": now, "name": deck_name, "usn": -1, "lrnToday": [0, 0], "revToday": [0, 0], "newToday": [0, 0], "timeToday": [0, 0], "collapsed": False, "browserCollapsed": False, "desc": "", "dyn": 0, "conf": 1, "extendNew": 0, "extendRev": 0}
    deck_conf = {"1": {"id": 1, "mod": now, "name": "Default", "usn": -1, "maxTaken": 60, "autoplay": True, "timer": 0, "replayq": True, "new": {"delays": [1, 10], "ints": [1, 4], "initialFactor": 2500, "perDay": 20}, "rev": {"ease4": 1.3, "ivlFct": 1, "maxIvl": 36500, "perDay": 200}, "lapse": {"delays": [10], "leechAction": 1, "leechFails": 8, "minInt": 1, "mult": 0}}}

    temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-new-deck-", suffix=".apkg", delete=False)
    temporary.close()
    database = Path(temporary.name).with_suffix(".anki2")
    try:
        connection = sqlite3.connect(database)
        try:
            connection.executescript(_LEGACY_SCHEMA)
            connection.execute(
                "INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, -1, 0, ?, ?, ?, ?, '{}')",
                (now, now * 1000, now * 1000, json.dumps({"curModel": model_id, "curDeck": deck_id, "newSpread": 0, "nextPos": len(values) + 1}), json.dumps({str(model_id): model}, ensure_ascii=False), json.dumps({str(deck_id): deck}, ensure_ascii=False), json.dumps(deck_conf, ensure_ascii=False)),
            )
            for index, row in enumerate(values):
                note_id = base_id + 100 + index * 100
                connection.execute(
                    "INSERT INTO notes VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')",
                    (note_id, uuid4().hex[:10], model_id, now, "\x1f".join(row), row[front_field], _note_checksum(row[front_field])),
                )
                for card_order in range(len(templates)):
                    connection.execute(
                        "INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')",
                        (note_id + card_order + 1, note_id, deck_id, card_order, now, index * len(templates) + card_order + 1),
                    )
            connection.commit()
        finally:
            connection.close()
        with zipfile.ZipFile(temporary.name, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(database, "collection.anki2")
            template_media = media_items(template_package) if template_package else []
            media = {item["stored_name"]: item["name"] for item in template_media}
            archive.writestr("media", json.dumps(media, ensure_ascii=False))
            if template_package and template_media:
                with zipfile.ZipFile(template_package.source) as source_archive:
                    for item in template_media:
                        archive.writestr(item["stored_name"], _media_bytes(template_package, item["stored_name"], source_archive))
    finally:
        database.unlink(missing_ok=True)
    package = read_apkg(temporary.name)
    package.display_name = f"{deck_name}.apkg"
    return package


def _csv_delimiter(content: str) -> str:
    try:
        return csv.Sniffer().sniff(content[:8192], delimiters=",;\t").delimiter
    except csv.Error:
        return ","


def _trim_table(rows: list[list[str]]) -> list[list[str]]:
    while rows and not any(rows[-1]):
        rows.pop()
    width = max((len(row) for row in rows), default=0)
    return [row + [""] * (width - len(row)) for row in rows]


def _drop_empty_columns(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """Ignore columns with no value anywhere; users can add them later in Fields."""
    if not rows:
        return rows, 0
    active = [index for index in range(len(rows[0])) if any(row[index].strip() for row in rows)]
    return [[row[index] for index in active] for row in rows], len(rows[0]) - len(active)


def _read_xlsx(source: Path) -> dict[str, list[list[str]]]:
    ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "pkg": "http://schemas.openxmlformats.org/package/2006/relationships"}
    try:
        with zipfile.ZipFile(source) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships.findall("pkg:Relationship", ns)}
            shared: list[str] = []
            if "xl/sharedStrings.xml" in archive.namelist():
                strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                shared = ["".join(item.itertext()) for item in strings.findall("main:si", ns)]
            output: dict[str, list[list[str]]] = {}
            for sheet in workbook.findall("main:sheets/main:sheet", ns):
                target = targets.get(sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""))
                if not target:
                    continue
                sheet_path = "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
                output[sheet.attrib.get("name", "시트")] = _read_xlsx_sheet(archive.read(sheet_path), shared, ns)
            return output
    except (KeyError, OSError, ET.ParseError, zipfile.BadZipFile) as exc:
        raise ValueError("읽을 수 없는 Excel(.xlsx) 파일입니다.") from exc


def _read_xlsx_sheet(payload: bytes, shared: list[str], ns: dict[str, str]) -> list[list[str]]:
    root = ET.fromstring(payload)
    rows: list[list[str]] = []
    for row in root.findall("main:sheetData/main:row", ns):
        values: list[str] = []
        for cell in row.findall("main:c", ns):
            reference = cell.attrib.get("r", "A1")
            column = _xlsx_column_index(reference)
            values.extend([""] * max(0, column - len(values)))
            kind = cell.attrib.get("t")
            value = cell.findtext("main:v", default="", namespaces=ns)
            if kind == "s" and value.isdigit() and int(value) < len(shared):
                values.append(shared[int(value)])
            elif kind == "inlineStr":
                inline = cell.find("main:is", ns)
                values.append("".join(inline.itertext()) if inline is not None else "")
            elif kind == "b":
                values.append("TRUE" if value == "1" else "FALSE")
            elif value:
                values.append(value)
            else:
                formula = cell.findtext("main:f", default="", namespaces=ns)
                values.append(f"={formula}" if formula else "")
        rows.append(values)
    return _trim_table(rows)


def _xlsx_column_index(reference: str) -> int:
    letters = "".join(char for char in reference if char.isalpha())
    value = 0
    for char in letters:
        value = value * 26 + ord(char.upper()) - 64
    return max(value - 1, 0)


_LEGACY_SCHEMA = """
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_notes_csum ON notes (csum);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_revlog_cid ON revlog (cid);
"""


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


def _media_type(name: str) -> Literal["audio", "image", "other"]:
    suffix = Path(name).suffix.lower()
    if suffix in {".mp3", ".wav", ".ogg", ".m4a", ".flac"}:
        return "audio"
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        return "image"
    return "other"


def _media_item(package: DeckPackage, stored_name: str, original_name: str, archive: zipfile.ZipFile | None = None) -> dict[str, Any] | None:
    if stored_name in package.removed_media:
        return None
    staged_path = package.pending_media.get(stored_name)
    if staged_path:
        if not staged_path.is_file():
            return None
        size = staged_path.stat().st_size
    else:
        if archive is None or stored_name not in package.archive_entries:
            return None
        size = archive.getinfo(stored_name).file_size
    return {"name": original_name, "stored_name": stored_name, "size": size, "type": _media_type(original_name)}


def _media_bytes(package: DeckPackage, stored_name: str, archive: zipfile.ZipFile) -> bytes:
    staged_path = package.pending_media.get(stored_name)
    return staged_path.read_bytes() if staged_path else archive.read(stored_name)


def media_items(package: DeckPackage) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with zipfile.ZipFile(package.source) as archive:
        for stored_name, original_name in package.media.items():
            item = _media_item(package, stored_name, original_name, archive)
            if item:
                items.append(item)
    return sorted(items, key=lambda item: item["name"].casefold())


def _safe_media_name(name: str) -> str:
    clean = Path(name).name.strip()
    if not clean or clean in {".", ".."}:
        raise ValueError("미디어 파일 이름을 확인할 수 없습니다.")
    return clean


def _unique_media_name(name: str, used: set[str]) -> str:
    if name not in used:
        return name
    stem, suffix = Path(name).stem, Path(name).suffix
    counter = 2
    while f"{stem}-{counter}{suffix}" in used:
        counter += 1
    return f"{stem}-{counter}{suffix}"


def _next_media_stored_name(package: DeckPackage) -> str:
    numeric_names = [int(name) for name in package.media if name.isdigit()]
    return str(max(numeric_names, default=-1) + 1)


def import_media(package: DeckPackage, paths: list[str | Path], *, template_asset: bool = False) -> list[dict[str, Any]]:
    """Stage local files so the next APKG save embeds them as Anki media."""
    staged: list[tuple[str, str, Path]] = []
    used_names = set(package.media.values())
    next_stored_name = int(_next_media_stored_name(package))
    try:
        for raw_path in paths:
            source = Path(raw_path)
            if not source.is_file():
                raise ValueError(f"미디어 파일을 찾을 수 없습니다: {source.name or source}")
            name = _safe_media_name(source.name)
            if template_asset:
                name = "_" + name.lstrip("_")
            name = _unique_media_name(name, used_names)
            used_names.add(name)
            temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-media-", suffix=source.suffix, delete=False)
            temporary.close()
            staged_path = Path(temporary.name)
            try:
                shutil.copyfile(source, staged_path)
            except OSError:
                staged_path.unlink(missing_ok=True)
                raise
            staged.append((str(next_stored_name), name, staged_path))
            next_stored_name += 1
    except Exception:
        for _stored_name, _name, staged_path in staged:
            staged_path.unlink(missing_ok=True)
        raise
    for stored_name, name, staged_path in staged:
        package.media[stored_name] = name
        package.pending_media[stored_name] = staged_path
    return [item for stored_name, name, _staged_path in staged if (item := _media_item(package, stored_name, name))]


def remove_media(package: DeckPackage, stored_name: str) -> None:
    if stored_name not in package.media:
        raise ValueError("미디어 파일을 찾을 수 없습니다.")
    staged_path = package.pending_media.pop(stored_name, None)
    if staged_path:
        staged_path.unlink(missing_ok=True)
    elif stored_name in package.archive_entries:
        package.removed_media.add(stored_name)
    del package.media[stored_name]


def export_media(package: DeckPackage, destination: str | Path) -> Path:
    target = Path(destination)
    with zipfile.ZipFile(package.source) as source, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for item in media_items(package):
            output.writestr(f"media/{item['name']}", _media_bytes(package, item["stored_name"], source))
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
                output.writestr(f"media/{item['name']}", _media_bytes(package, item["stored_name"], source))
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
            for item in media_items(package):
                output.writestr(f"media/{item['name']}", _media_bytes(package, item["stored_name"], source_archive))
    return target
