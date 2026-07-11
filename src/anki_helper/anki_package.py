from __future__ import annotations

import csv
import html
import io
import json
import re
import sqlite3
import tempfile
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


@dataclass(slots=True)
class DeckPackage:
    source: Path
    note_types: list[NoteType]
    media: dict[str, str]
    archive_entries: set[str]


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
        return _read_legacy_collection(source, Path(temp_name), media, entries)
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
    source: Path, database_path: Path, media: dict[str, str], entries: set[str]
) -> DeckPackage:
    connection = sqlite3.connect(database_path)
    try:
        models_json = connection.execute("SELECT models FROM col").fetchone()
        if not models_json:
            raise ApkgReadError("노트 타입 정보를 찾지 못했습니다.")
        if not models_json[0]:
            return _read_normalized_collection(source, connection, media, entries)
        models: dict[str, Any] = json.loads(models_json[0])
        rows = connection.execute("SELECT mid, flds FROM notes ORDER BY id").fetchall()
    finally:
        connection.close()

    notes_by_model: dict[str, list[list[str]]] = {}
    for model_id, fields in rows:
        notes_by_model.setdefault(str(model_id), []).append(str(fields).split("\x1f"))

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
    return DeckPackage(source=source, note_types=note_types, media=media, archive_entries=entries)


def _read_normalized_collection(
    source: Path, connection: sqlite3.Connection, media: dict[str, str], entries: set[str]
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
    for type_id, fields in connection.execute("SELECT mid, flds FROM notes ORDER BY id"):
        notes_by_type.setdefault(type_id, []).append(str(fields).split("\x1f"))

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
    return DeckPackage(source=source, note_types=note_types, media=media, archive_entries=entries)


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
    markup = re.sub(r"\[sound:([^\]]+)\]", r"<span class='sound'>🔊 \1</span>", markup)
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
