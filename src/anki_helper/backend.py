"""Local API used by the Tauri desktop shell.

The API intentionally binds to loopback only.  It is a private bridge between
the installed desktop UI and the existing APKG parsing/export domain code.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import tempfile
import base64
import hashlib
import html
import json
import mimetypes
import re
import secrets
import sqlite3
import zipfile
from copy import deepcopy
from dataclasses import asdict, dataclass, field as dataclass_field
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .anki_package import (
    ApkgReadError,
    DeckPackage,
    Field,
    NoteType,
    SCRIPT_CONTENT,
    SCRIPT_STRING,
    export_design,
    export_media,
    export_project,
    export_tsv,
    field_content_kind,
    import_project,
    import_media,
    inspect_table_source,
    media_health,
    media_items,
    media_reference_filename,
    media_references_for,
    move_note_field_contents,
    move_notes_between_types,
    read_apkg,
    remove_media,
    remove_note_type,
    rename_media,
    render_template,
    reorder_field,
    save_apkg,
    save_as_note_type,
    split_field_content,
    create_package_from_table,
    decode_media_payload,
)


@dataclass(slots=True)
class BackendState:
    """Mutable workspace owned by one desktop-app instance."""

    package: DeckPackage | None = None
    selected_note_type_id: str | None = None
    requires_save_as: bool = False
    preview_token: str = dataclass_field(default_factory=lambda: secrets.token_urlsafe(32))


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Release staged files belonging to this app instance on shutdown."""
    try:
        yield
    finally:
        state: BackendState = application.state.workspace
        _cleanup_ephemeral_package(state.package, state.requires_save_as)
        state.package = None
        state.selected_note_type_id = None
        state.requires_save_as = False


app = FastAPI(title="Anki Helper local engine", docs_url=None, redoc_url=None, lifespan=lifespan)
app.state.workspace = BackendState()
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


def _backend_state() -> BackendState:
    return app.state.workspace


def _rotate_preview_token(state: BackendState) -> None:
    """Invalidate preview-only media URLs when the active package changes."""
    state.preview_token = secrets.token_urlsafe(32)
_sound_marker = re.compile(
    r"<span class=(?P<class_quote>[\"'])sound(?P=class_quote)\s+"
    r"(?:(?:data-anki-autoplay=(?P<autoplay_quote>[\"'])(?P<autoplay>.*?)(?P=autoplay_quote))\s+)?"
    r"data-sound=(?P<value_quote>[\"'])(?P<filename>.*?)(?P=value_quote)>.*?</span>",
    re.DOTALL,
)
# Anki Desktop / AnkiDroid replay control markup (reviewer.scss defaults).
_replay_svg = (
    "<svg class='playImage' viewBox='0 0 64 64' version='1.1' aria-hidden='true'>"
    "<circle cx='32' cy='32' r='29'/>"
    "<path d='M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z'/>"
    "</svg>"
)
_replay_button_css = (
    ".replay-button{text-decoration:none;display:inline-flex;vertical-align:middle;margin:3px;"
    "cursor:pointer;border:none;background:none;padding:0;font:inherit}"
    ".replay-button span{display:inline-flex;vertical-align:middle;padding:5px}"
    ".replay-button svg{display:inline;width:1em;height:1em;min-width:32px;min-height:32px}"
    ".replay-button svg circle{fill:#fff;stroke:#414141}"
    ".replay-button svg path{fill:#414141}"
    ".replay-button.playing svg circle{fill:#414141;stroke:#414141}"
    ".replay-button.playing svg path{fill:#fff}"
)
_preview_url_attribute = re.compile(
    r"(?P<prefix>(?<![\w.])(?:src|poster|href)\s*=\s*)(?:(?P<quote>[\"'])(?P<quoted>.*?)(?P=quote)|(?P<bare>[^\s>]+))",
    re.IGNORECASE,
)
_css_url = re.compile(
    r"url\(\s*(?:(?P<quote>[\"'])(?P<quoted>.*?)(?P=quote)|(?P<bare>[^)\s]+))\s*\)",
    re.IGNORECASE,
)
_css_import = re.compile(r"(?P<prefix>@import\s+)(?P<quote>[\"'])(?P<url>.*?)(?P=quote)", re.IGNORECASE)
_srcset_attribute = re.compile(
    r"(?P<prefix>(?<![\w.])srcset\s*=\s*)(?:(?P<quote>[\"'])(?P<quoted>.*?)(?P=quote)|(?P<bare>[^\s>]+))",
    re.IGNORECASE,
)
_byte_range = re.compile(r"bytes=(?P<start>\d*)-(?P<end>\d*)$")


def _temporary_file_response(path: Path, *, filename: str, media_type: str) -> FileResponse:
    """Stream a generated download and remove its staging file afterwards."""
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


def _media_response(data: bytes, *, filename: str, range_header: str | None = None) -> Response:
    """Serve stable media bytes, including the single ranges used by players.

    Previously, every audio range request was served from a new temporary file.
    Its changing ETag/mtime made one MP3 look like different resources to the
    WebView decoder, causing metallic clicks at the start or end of some files.
    Stable decoded bytes, validators, and explicit ranges fixed that issue; the
    no-store policy also prevents /api/media/0 cache reuse across APKG files.
    """
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    size = len(data)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "ETag": f'"{hashlib.sha256(data).hexdigest()}"',
    }
    if not range_header:
        return Response(data, media_type=media_type, headers=headers)

    match = _byte_range.fullmatch(range_header.strip())
    if match is None or size == 0:
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers)

    start_text, end_text = match.group("start"), match.group("end")
    if not start_text and not end_text:
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers)
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            headers["Content-Range"] = f"bytes */{size}"
            return Response(status_code=416, headers=headers)
        start, end = max(size - suffix_length, 0), size - 1
    if start >= size or end < start:
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers)
    end = min(end, size - 1)
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(data[start:end + 1], status_code=206, media_type=media_type, headers=headers)


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


class MediaRenameRequest(BaseModel):
    name: str


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
    included_columns: list[int] | None = None


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


def _workspace_data(state: BackendState | None = None) -> dict | None:
    state = state or _backend_state()
    package = state.package
    if package is None:
        return None
    return {
        "source": str(package.source),
        "source_name": package.display_name or package.source.name,
        "media_count": len(package.media),
        "note_types": [_note_type_data(note_type) for note_type in package.note_types],
        "selected_note_type_id": state.selected_note_type_id,
        "requires_save_as": state.requires_save_as,
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
            temporary.write(archive.read("source/original.apkg"))
            temporary.close()
    except zipfile.BadZipFile as exc:
        raise ValueError("읽을 수 없는 노트 유형 원본 파일입니다.") from exc
    package = read_apkg(temporary.name)
    import_project(package, source)
    return package, Path(temporary.name)


def _get_note_type(note_type_id: str, state: BackendState | None = None) -> NoteType:
    package = (state or _backend_state()).package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    for note_type in package.note_types:
        if note_type.id == note_type_id:
            return note_type
    raise HTTPException(status_code=404, detail="노트 타입을 찾지 못했습니다.")


def _embed_preview_media(
    markup: str,
    media_base_url: str = "http://127.0.0.1:8765",
    package: DeckPackage | None = None,
) -> str:
    """Resolve referenced APKG assets inside the isolated preview iframe.

    Card previews live in an ``srcDoc`` iframe, where a template reference such
    as ``<img src="_logo.svg">`` has no APKG media directory to resolve from.
    Absolute local API URLs work for pending files too, without copying large
    images, videos, or fonts into every preview response. The runtime resolver
    also handles template JavaScript such as ``image.src = "_logo.svg"``.
    """
    state = _backend_state()
    package = package or state.package
    if package is None:
        return markup

    media_by_name = {
        filename: stored_name
        for stored_name, original_name in package.media.items()
        if (filename := media_reference_filename(original_name)) is not None
    }
    stylesheet_urls: dict[str, str | None] = {}
    stylesheet_stack: set[str] = set()
    archive: zipfile.ZipFile | None = None

    def media_url(value: str) -> str | None:
        filename = media_reference_filename(value)
        stored_name = media_by_name.get(filename or "")
        if stored_name is None:
            return None
        return f"{media_base_url.rstrip('/')}/api/preview-media/{state.preview_token}/{quote(stored_name, safe='')}"

    def stylesheet_url(value: str) -> str | None:
        """Inline local CSS after rewriting its own local asset references."""
        filename = media_reference_filename(value)
        if filename is None or not filename.casefold().endswith(".css"):
            return None
        if filename in stylesheet_urls:
            return stylesheet_urls[filename]
        if filename in stylesheet_stack:
            return None
        stored_name = media_by_name.get(filename)
        if stored_name is None:
            stylesheet_urls[filename] = None
            return None
        stylesheet_stack.add(filename)
        try:
            staged_path = package.pending_media.get(stored_name)
            if staged_path and staged_path.is_file():
                payload = staged_path.read_bytes()
            else:
                nonlocal archive
                if stored_name not in package.archive_entries:
                    stylesheet_urls[filename] = None
                    return None
                if archive is None:
                    archive = zipfile.ZipFile(package.source)
                payload = decode_media_payload(archive.read(stored_name))
            stylesheet = payload.decode("utf-8-sig")
            stylesheet = _css_import.sub(replace_css_import, stylesheet)
            stylesheet = _css_url.sub(replace_css_url, stylesheet)
            result = f"data:text/css;base64,{base64.b64encode(stylesheet.encode('utf-8')).decode('ascii')}"
            stylesheet_urls[filename] = result
            return result
        except (OSError, UnicodeDecodeError, KeyError, zipfile.BadZipFile):
            stylesheet_urls[filename] = None
            return None
        finally:
            stylesheet_stack.discard(filename)

    def replace_src(match: re.Match[str]) -> str:
        raw = match.group("quoted") or match.group("bare")
        value = stylesheet_url(raw) if "href" in match.group("prefix").casefold() else None
        value = value or media_url(raw)
        return f'{match.group("prefix")}"{value}"' if value else match.group(0)

    def replace_css_url(match: re.Match[str]) -> str:
        value = media_url(match.group("quoted") or match.group("bare"))
        return f'url("{value}")' if value else match.group(0)

    def replace_css_import(match: re.Match[str]) -> str:
        value = stylesheet_url(match.group("url")) or media_url(match.group("url"))
        return f'{match.group("prefix")}"{value}"' if value else match.group(0)

    def replace_srcset(match: re.Match[str]) -> str:
        raw = match.group("quoted") or match.group("bare")
        values = []
        for candidate in raw.split(","):
            parts = candidate.strip().split(maxsplit=1)
            if not parts:
                continue
            value = media_url(parts[0]) or parts[0]
            values.append(" ".join((value, *parts[1:])))
        return f'{match.group("prefix")}"{", ".join(values)}"'

    def replace_script_strings(text: str) -> str:
        """Rewrite media filenames inside template scripts before they assign img.src."""

        def script_replacer(match: re.Match[str]) -> str:
            body = match.group("body")

            def string_replacer(string_match: re.Match[str]) -> str:
                quote_char = string_match.group("quote")
                raw = string_match.group("value")
                value = stylesheet_url(raw) or media_url(raw)
                if value is None:
                    return string_match.group(0)
                escaped = value.replace("\\", "\\\\").replace(quote_char, f"\\{quote_char}")
                return f"{quote_char}{escaped}{quote_char}"

            new_body = SCRIPT_STRING.sub(string_replacer, body)
            return match.group(0) if new_body == body else match.group(0).replace(body, new_body, 1)

        return SCRIPT_CONTENT.sub(script_replacer, text)

    def replace_sound(match: re.Match[str]) -> str:
        filename = html.unescape(match.group("filename"))
        value = media_url(filename)
        if value is None:
            return f"<span class='sound'>🔊 {html.escape(filename)}</span>"
        autoplay = " data-autoplay='false'" if match.group("autoplay") == "false" else ""
        return (
            "<button type='button' class='replay-button anki-audio sound' "
            f"data-audio='{value}'{autoplay} aria-label='음성 재생'><span>{_replay_svg}</span></button>"
        )

    def runtime_resolver() -> str:
        """Map dynamic DOM media assignments before template scripts execute."""
        urls = {
            filename: f"{media_base_url.rstrip('/')}/api/preview-media/{state.preview_token}/{quote(stored_name, safe='')}"
            for filename, stored_name in media_by_name.items()
        }
        for filename in media_by_name:
            if filename.casefold().endswith(".css"):
                urls[filename] = stylesheet_url(filename) or urls[filename]
        serialized = json.dumps(urls, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")
        return f"""<script>(function(){{
const assets={serialized};
const cardState={{session:Object.create(null),local:Object.create(null)}};
const storageFor=bucket=>({{
  get length(){{return Object.keys(bucket).length;}},
  key:index=>Object.keys(bucket)[index]??null,
  getItem:key=>{{const value=bucket[String(key)];return value===undefined?null:value;}},
  setItem:(key,value)=>{{bucket[String(key)]=String(value);}},
  removeItem:key=>{{delete bucket[String(key)];}},
  clear:()=>{{for(const key of Object.keys(bucket))delete bucket[key];}},
}});
try{{
  Object.defineProperty(window,"sessionStorage",{{configurable:true,value:storageFor(cardState.session)}});
  Object.defineProperty(window,"localStorage",{{configurable:true,value:storageFor(cardState.local)}});
}}catch(_error){{}}
try{{
  Object.defineProperty(Document.prototype,"baseURI",{{configurable:true,get:()=>"https://preview.invalid/"}});
}}catch(_error){{}}
const leaf=value=>{{
  const plain=String(value).split(/[?#]/,1)[0].replace(/\\\\/g,"/");
  const name=plain.split("/").filter(Boolean).pop()||plain;
  try{{return decodeURIComponent(name);}}catch(_error){{return name;}}
}};
const resolve=value=>{{
  if(typeof value!=="string")return value;
  if(assets[value])return assets[value];
  const plain=value.split(/[?#]/,1)[0];
  if(assets[plain])return assets[plain];
  let filename=leaf(plain);
  try{{filename=decodeURIComponent(new URL(plain,"https://preview.invalid/").pathname.split("/").filter(Boolean).pop()||filename);}}catch(_error){{}}
  return assets[filename]||assets[leaf(plain)]||value;
}};
const resolveSrcset=value=>typeof value==="string"?value.split(",").map(candidate=>{{const parts=candidate.trim().split(/\\s+/,2);return [resolve(parts[0]),parts[1]].filter(Boolean).join(" ");}}).join(", "):value;
const resolveCss=value=>typeof value==="string"?value.replace(/url\\((['\\"]?)(.*?)\\1\\)/g,(_match,quote,url)=>`url(${{quote}}${{resolve(url)}}${{quote}})`):value;
const patch=(prototype,property,map=resolve)=>{{
  try{{
    let descriptor,target=prototype;
    while(target&&target!==Object.prototype){{
      descriptor=Object.getOwnPropertyDescriptor(target,property);
      if(descriptor)break;
      target=Object.getPrototypeOf(target);
    }}
    if(!descriptor||typeof descriptor.get!=="function"||typeof descriptor.set!=="function")return;
    Object.defineProperty(prototype,property,{{configurable:true,enumerable:!!descriptor.enumerable,get:descriptor.get,set(value){{descriptor.set.call(this,map(value));}}}});
  }}catch(_error){{}}
}};
patch(HTMLImageElement.prototype,"src");
patch(HTMLAudioElement.prototype,"src");
patch(HTMLVideoElement.prototype,"src");
patch(HTMLSourceElement.prototype,"src");
patch(HTMLImageElement.prototype,"srcset",resolveSrcset);
patch(HTMLVideoElement.prototype,"poster");
patch(HTMLLinkElement.prototype,"href");
for(const property of ["background","backgroundImage","borderImage","content","cursor","listStyle","mask","maskImage"])
  patch(CSSStyleDeclaration.prototype,property,resolveCss);
try{{
  const nativeSetProperty=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){{
    return nativeSetProperty.call(this,name,resolveCss(value),priority);
  }};
}}catch(_error){{}}
try{{
  const setAttribute=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){{
    const attribute=String(name).toLowerCase();
    const next=attribute==="srcset"?resolveSrcset(value):["src","poster","href"].includes(attribute)?resolve(value):attribute==="style"?resolveCss(value):value;
    return setAttribute.call(this,name,next);
  }};
}}catch(_error){{}}
const rewriteElement=element=>{{
  if(!(element instanceof Element))return;
  for(const name of ["src","srcset","poster","href"]){{
    if(element.hasAttribute(name)){{const current=element.getAttribute(name);const next=resolve(current);if(next!==current)element.setAttribute(name,next);}}
  }}
  if(element.hasAttribute("style")){{const current=element.getAttribute("style");const next=resolveCss(current);if(next!==current)element.setAttribute("style",next);}}
  if(element instanceof HTMLStyleElement){{const next=resolveCss(element.textContent);if(next!==element.textContent)element.textContent=next;}}
  element.querySelectorAll?.("[src],[srcset],[poster],[href],[style],style").forEach(rewriteElement);
}};
try{{
  new MutationObserver(records=>records.forEach(record=>{{
    if(record.type==="attributes")rewriteElement(record.target);
    record.addedNodes.forEach(rewriteElement);
  }})).observe(document.documentElement,{{childList:true,subtree:true,attributes:true,attributeFilter:["src","srcset","poster","href","style"]}});
}}catch(_error){{}}
try{{rewriteElement(document.documentElement);}}catch(_error){{}}
try{{
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,...rest)=>originalFetch(typeof input==="string"?resolve(input):input instanceof URL?new URL(resolve(input.href)):input,...rest);
}}catch(_error){{}}
window.__ankiHelperResolveMediaUrl=resolve;
}})();</script>"""

    try:
        markup = _sound_marker.sub(replace_sound, markup)
        markup = _preview_url_attribute.sub(replace_src, markup)
        markup = _srcset_attribute.sub(replace_srcset, markup)
        markup = _css_import.sub(replace_css_import, markup)
        markup = replace_script_strings(markup)
        return runtime_resolver() + _css_url.sub(replace_css_url, markup)
    finally:
        if archive is not None:
            archive.close()


@app.get("/api/health")
@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/workspace")
def workspace() -> dict | None:
    return _workspace_data()


@app.put("/api/workspace/selected-note-type")
def select_note_type(payload: SelectedNoteType) -> dict:
    state = _backend_state()
    _get_note_type(payload.note_type_id, state)
    state.selected_note_type_id = payload.note_type_id
    return _workspace_data(state) or {}


@app.post("/api/packages/open")
def open_package(payload: OpenPackageRequest) -> dict:
    state = _backend_state()
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    previous_package, previous_requires_save_as = state.package, state.requires_save_as
    staged_source: Path | None = None
    try:
        if source.suffix.lower() == ".zip":
            with zipfile.ZipFile(source) as archive:
                if "source/original.apkg" not in archive.namelist():
                    raise ApkgReadError("이 편집 프로젝트에는 원본 APKG가 포함되어 있지 않습니다. 새로 내보낸 편집 프로젝트를 사용해 주세요.")
                temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-project-", suffix=".apkg", delete=False)
                temporary.write(archive.read("source/original.apkg"))
                temporary.close()
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
    state.package = package
    state.requires_save_as = requires_save_as
    _rotate_preview_token(state)
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    state.selected_note_type_id = package.note_types[0].id if package.note_types else None
    return _workspace_data(state) or {}


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
    state = _backend_state()
    source = Path(payload.path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail="선택한 파일을 찾을 수 없습니다.")
    template_temporary: Path | None = None
    previous_package, previous_requires_save_as = state.package, state.requires_save_as
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
            if payload.included_columns is not None:
                selected_columns = payload.included_columns
                rows = [[row[column] if 0 <= column < len(row) else "" for column in selected_columns] for row in rows]
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
    state.package = package
    state.requires_save_as = True
    _rotate_preview_token(state)
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    state.selected_note_type_id = package.note_types[0].id
    return _workspace_data(state) or {}


@app.post("/api/packages/save")
def save_package(payload: SavePackageRequest) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    destination = Path(payload.path) if payload.path else package.source
    if state.requires_save_as and not payload.path:
        raise HTTPException(status_code=400, detail="편집 프로젝트는 처음 저장할 APKG 위치를 선택해야 합니다.")
    if destination.suffix.lower() != ".apkg":
        raise HTTPException(status_code=400, detail="APKG 형식으로만 저장할 수 있습니다.")
    selected_name = next((item.name for item in package.note_types if item.id == state.selected_note_type_id), None)
    previous_package, previous_requires_save_as = package, state.requires_save_as
    try:
        target, backup = save_apkg(package, destination, backup=not state.requires_save_as)
        state.package = read_apkg(target)
        state.requires_save_as = False
    except (OSError, sqlite3.DatabaseError, zipfile.BadZipFile, ApkgReadError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"APKG 저장에 실패했습니다: {exc}") from exc
    _cleanup_ephemeral_package(previous_package, previous_requires_save_as)
    saved_package = state.package
    if selected_name and saved_package:
        state.selected_note_type_id = next(
            (item.id for item in saved_package.note_types if item.name == selected_name),
            saved_package.note_types[0].id if saved_package.note_types else None,
        )
    return {"workspace": _workspace_data(state), "saved_to": str(target), "backup": str(backup) if backup else None}


@app.get("/api/media")
def list_media() -> list[dict]:
    package = _backend_state().package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    return media_items(package)


@app.get("/api/media/health")
def inspect_media_health() -> dict:
    package = _backend_state().package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    return media_health(package)


@app.post("/api/media/import")
def add_media(payload: MediaImportRequest) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    if not payload.paths:
        raise HTTPException(status_code=400, detail="추가할 미디어 파일을 선택해주세요.")
    try:
        added = import_media(package, payload.paths, template_asset=payload.template_asset)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"workspace": _workspace_data(state), "items": added}


@app.patch("/api/media/{stored_name}")
def rename_media_file(stored_name: str, payload: MediaRenameRequest) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    if stored_name not in package.media:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾지 못했습니다.")
    old_name = package.media[stored_name]
    try:
        item = rename_media(package, stored_name, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "workspace": _workspace_data(state),
        "item": item,
        "old_name": old_name,
        "new_name": item["name"],
    }


@app.delete("/api/media/{stored_name}")
def delete_media(stored_name: str, force: bool = False) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    item = next((entry for entry in media_items(package) if entry["stored_name"] == stored_name), None)
    if item is None:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾지 못했습니다.")
    references = media_references_for(package, item["name"])
    if references and not force:
        locations = ", ".join(reference["location"] for reference in references[:3])
        extra = f" 외 {len(references) - 3}곳" if len(references) > 3 else ""
        raise HTTPException(status_code=409, detail=f"이 미디어는 {locations}{extra}에서 사용 중입니다. 강제로 삭제할 수 있습니다.")
    try:
        remove_media(package, stored_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"workspace": _workspace_data(state), "references": references}


@app.get("/api/media/{stored_name}")
def download_media(stored_name: str, request: Request) -> Response:
    package = _backend_state().package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    item = next((entry for entry in media_items(package) if entry["stored_name"] == stored_name), None)
    if item is None:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾지 못했습니다.")
    staged_path = package.pending_media.get(stored_name)
    if staged_path and staged_path.is_file():
        data = staged_path.read_bytes()
    else:
        with zipfile.ZipFile(package.source) as archive:
            data = decode_media_payload(archive.read(stored_name))
    return _media_response(data, filename=item["name"], range_header=request.headers.get("range"))


@app.get("/api/preview-media/{token}/{stored_name}")
def download_preview_media(token: str, stored_name: str, request: Request) -> Response:
    """Serve a capability-scoped media byte stream to an opaque preview iframe."""
    state = _backend_state()
    package = state.package
    if package is None or not secrets.compare_digest(token, state.preview_token):
        raise HTTPException(status_code=404, detail="미리보기 미디어를 찾지 못했습니다.")
    item = next((entry for entry in media_items(package) if entry["stored_name"] == stored_name), None)
    if item is None:
        raise HTTPException(status_code=404, detail="미리보기 미디어를 찾지 못했습니다.")
    staged_path = package.pending_media.get(stored_name)
    if staged_path and staged_path.is_file():
        data = staged_path.read_bytes()
    else:
        with zipfile.ZipFile(package.source) as archive:
            data = decode_media_payload(archive.read(stored_name))
    response = _media_response(data, filename=item["name"], range_header=request.headers.get("range"))
    if request.headers.get("origin") == "null":
        response.headers["Access-Control-Allow-Origin"] = "null"
        response.headers["Vary"] = "Origin"
    return response


@app.post("/api/projects/import")
def import_edit_project(payload: ImportProjectRequest) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        note_type = import_project(package, payload.path)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state.requires_save_as = True
    return {"workspace": _workspace_data(state), "note_type_id": note_type.id}


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
    token_pattern = re.compile(r"(\{\{(?:[#^/])?\s*)" + re.escape(old_name) + r"(\s*(?::[^{}]+)?\s*\}\})")
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
    token_pattern = re.compile(r"\{\{(?:[#^/])?\s*" + re.escape(old_name) + r"(?:\s*:[^{}]+)?\s*\}\}")
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
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="노트 유형 이름을 입력해 주세요.")
    if any(item.name.casefold() == name.casefold() for item in package.note_types):
        raise HTTPException(status_code=400, detail="같은 이름의 노트 유형이 이미 있습니다.")
    source = _get_note_type(note_type_id)
    copied = save_as_note_type(package, source, name, move_cards=payload.move_cards)
    state.selected_note_type_id = copied.id
    return _workspace_data(state) or {}


@app.delete("/api/note-types/{note_type_id}")
def delete_note_type(note_type_id: str) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
        raise HTTPException(status_code=404, detail="먼저 APKG 파일을 열어주세요.")
    try:
        remove_note_type(package, note_type_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if state.selected_note_type_id == note_type_id:
        state.selected_note_type_id = package.note_types[0].id if package.note_types else None
    return _workspace_data(state) or {}


@app.post("/api/note-types/{note_type_id}/move-notes")
def move_notes(note_type_id: str, payload: NoteTypeMoveNotes) -> dict:
    state = _backend_state()
    package = state.package
    if package is None:
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
        moved = move_notes_between_types(package, source, destination, mapping)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state.selected_note_type_id = destination.id
    return {"workspace": _workspace_data(state), "moved": moved}


@app.get("/api/note-types/{note_type_id}/preview")
def preview_card(
    request: Request,
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
    special_values = {"Type": note_type.name, "Card": template.name}
    front = render_template(template.front, note_type.fields, values, special_values=special_values)
    body = front if side == "front" else render_template(
        template.back,
        note_type.fields,
        values,
        front,
        is_answer=True,
        special_values=special_values,
    )
    helper_css = (
        f"{_replay_button_css}"
        ".anki-audio:not(.replay-button){display:inline-grid;place-items:center;width:36px;height:36px;"
        "margin:0 0 0 10px;border:1px solid #f4b183;border-radius:999px;background:#fff7ef;color:#d44709;"
        "font:700 16px/1 system-ui,sans-serif;cursor:pointer}"
        ".anki-audio.playing:not(.replay-button){background:#d44709;color:#fff}"
    )
    markup = f"<style>{helper_css}{note_type.css}</style>{body}"
    return {
        "html": _embed_preview_media(
            markup,
            str(request.base_url).rstrip("/"),
            _backend_state().package,
        )
    }


_MEDIA_TYPE_LABELS = {
    "audio": "음성",
    "image": "이미지",
    "video": "영상",
    "font": "폰트",
    "other": "기타",
}


@app.get("/api/note-types/{note_type_id}/export/{kind}")
def download_export(
    note_type_id: str,
    kind: Literal["tsv", "design", "bundle", "media", "project"],
    media_type: Literal["audio", "image", "video", "font", "other"] | None = None,
    names: list[str] | None = Query(default=None),
) -> FileResponse:
    package = _backend_state().package
    note_type = _get_note_type(note_type_id)
    media_label = f"_{_MEDIA_TYPE_LABELS[media_type]}" if kind == "media" and media_type else ""
    suffix, filename = {
        "tsv": (".tsv", f"{note_type.name}_input.tsv"),
        "design": (".json", f"{note_type.name}_design.json"),
        "bundle": (".apkg", f"{note_type.name}_수정본.apkg"),
        "media": (".zip", f"{note_type.name}_미디어{media_label}.zip"),
        "project": (".zip", f"{note_type.name}_편집프로젝트.zip"),
    }[kind]
    temporary = tempfile.NamedTemporaryFile(prefix="anki-helper-", suffix=suffix, delete=False)
    temporary.close()
    target = Path(temporary.name)
    try:
        if kind == "tsv":
            export_tsv(note_type, target)
        elif kind == "design":
            export_design(note_type, target)
        elif kind == "media":
            if package is None:
                raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
            export_media(package, target, media_type, set(names) if names else None)
        elif kind == "project":
            if package is None:
                raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
            export_project(package, note_type, target)
        else:
            if package is None:  # Protected by _get_note_type; keep type check explicit.
                raise HTTPException(status_code=404, detail="패키지를 찾지 못했습니다.")
            save_apkg(deepcopy(package), target, backup=False)
    except ValueError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
