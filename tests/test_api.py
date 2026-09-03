from __future__ import annotations

import importlib
import io
import re
import tempfile
import unittest
import zipfile
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

from anki_helper.anki_package import create_package_from_table, export_project, import_media, save_apkg


API_TESTS_AVAILABLE = find_spec("fastapi") is not None and find_spec("httpx2") is not None
if API_TESTS_AVAILABLE:
    from fastapi.testclient import TestClient

    from anki_helper import backend


@unittest.skipUnless(API_TESTS_AVAILABLE, "FastAPI and httpx2 are required for API integration tests")
class BackendApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.package = create_package_from_table(
            ["Front", "Back"],
            [["question", "[sound:answer.mp3]"]],
            deck_name="API test",
            note_type_name="Basic",
            front_field=0,
            back_field=1,
        )
        self.audio_bytes = b"ID3\x04\x00\x00\x00\x00\x00\x08test-audio-payload"
        self.audio_path = self.root / "answer.mp3"
        self.audio_path.write_bytes(self.audio_bytes)
        import_media(self.package, [self.audio_path])
        save_apkg(self.package, backup=False)
        self.previous_state = backend.app.state.workspace
        backend.app.state.workspace = backend.BackendState()

    def tearDown(self) -> None:
        current = backend.app.state.workspace
        if current.package is not None:
            for staged_path in current.package.pending_media.values():
                staged_path.unlink(missing_ok=True)
        backend.app.state.workspace = self.previous_state
        for staged_path in self.package.pending_media.values():
            staged_path.unlink(missing_ok=True)
        self.package.source.unlink(missing_ok=True)
        self.temporary.cleanup()

    def _open_workspace(self, client: TestClient) -> tuple[dict, str]:
        opened = client.post("/api/packages/open", json={"path": str(self.package.source)})
        self.assertEqual(200, opened.status_code, opened.text)
        workspace = opened.json()
        note_type_id = workspace["selected_note_type_id"]
        self.assertIsNotNone(note_type_id)
        return workspace, note_type_id  # type: ignore[return-value]

    def test_health_empty_workspace_and_import_safe_entrypoint(self) -> None:
        with patch("anki_helper.backend.main") as mocked_main:
            module = importlib.import_module("anki_helper.__main__")
            importlib.reload(module)
        mocked_main.assert_not_called()

        with TestClient(backend.app) as client:
            self.assertEqual({"ok": True}, client.get("/api/health").json())
            self.assertIsNone(client.get("/api/workspace").json())

    def test_open_preview_and_range_media_round_trip(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)

            preview = client.get(
                f"/api/note-types/{note_type_id}/preview",
                params={"side": "back"},
            )
            self.assertEqual(200, preview.status_code, preview.text)
            preview_html = preview.json()["html"]
            self.assertEqual(1, preview_html.count("class='replay-button anki-audio sound'"))
            match = re.search(r"/api/preview-media/([^/]+)/0", preview_html)
            self.assertIsNotNone(match, preview_html)
            token = match.group(1)  # type: ignore[union-attr]
            preview_media = client.get(f"/api/preview-media/{token}/0", headers={"Origin": "null"})
            self.assertEqual(200, preview_media.status_code, preview_media.text)
            self.assertEqual("null", preview_media.headers.get("access-control-allow-origin"))
            self.assertEqual(self.audio_bytes, preview_media.content)
            self.assertEqual(404, client.get("/api/preview-media/not-the-token/0").status_code)
            regular_media = client.get("/api/media/0", headers={"Origin": "null"})
            self.assertIsNone(regular_media.headers.get("access-control-allow-origin"))

            items = client.get("/api/media")
            self.assertEqual(200, items.status_code, items.text)
            stored_name = items.json()[0]["stored_name"]
            ranged = client.get(f"/api/media/{stored_name}", headers={"Range": "bytes=1-4"})
            self.assertEqual(206, ranged.status_code, ranged.text)
            self.assertEqual(self.audio_bytes[1:5], ranged.content)
            self.assertEqual(f"bytes 1-4/{len(self.audio_bytes)}", ranged.headers["content-range"])
            self.assertEqual("bytes", ranged.headers["accept-ranges"])
            self.assertEqual("no-store", ranged.headers["cache-control"])

            suffix = client.get(f"/api/media/{stored_name}", headers={"Range": "bytes=-3"})
            self.assertEqual(206, suffix.status_code, suffix.text)
            self.assertEqual(self.audio_bytes[-3:], suffix.content)

        self.assertIsNone(backend.app.state.workspace.package)
        self.assertIsNone(backend.app.state.workspace.selected_note_type_id)

    def test_save_package_and_field_crud(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)

            added = client.post(f"/api/note-types/{note_type_id}/fields", json={"name": "Extra"})
            self.assertEqual(200, added.status_code, added.text)
            fields = added.json()["note_types"][0]["fields"]
            self.assertEqual(["Front", "Back", "Extra"], [field["name"] for field in fields])

            renamed = client.patch(f"/api/note-types/{note_type_id}/fields/0", json={"name": "Question"})
            self.assertEqual(200, renamed.status_code, renamed.text)
            self.assertEqual("Question", renamed.json()["note_types"][0]["fields"][0]["name"])

            updated_note = client.patch(
                f"/api/note-types/{note_type_id}/notes/0/fields/0",
                json={"value": "updated question"},
            )
            self.assertEqual(200, updated_note.status_code, updated_note.text)
            self.assertEqual("updated question", updated_note.json()["note_types"][0]["notes"][0][0])

            reordered = client.post(
                f"/api/note-types/{note_type_id}/fields/2/reorder",
                json={"new_order": 0},
            )
            self.assertEqual(200, reordered.status_code, reordered.text)
            self.assertEqual(["Extra", "Question", "Back"], [field["name"] for field in reordered.json()["note_types"][0]["fields"]])

            save_path = self.root / "saved.apkg"
            backup_dir = self.root / "backups"
            backup_dir.mkdir()
            with patch("anki_helper.anki_package._backup_dir", return_value=backup_dir):
                saved = client.post("/api/packages/save", json={"path": str(save_path)})
            self.assertEqual(200, saved.status_code, saved.text)
            self.assertTrue(save_path.is_file())
            self.assertEqual(str(save_path), saved.json()["saved_to"])
            self.assertFalse(saved.json()["workspace"]["requires_save_as"])

            deleted = client.delete(f"/api/note-types/{note_type_id}/fields/2")
            self.assertEqual(200, deleted.status_code, deleted.text)
            self.assertEqual(["Extra", "Question"], [field["name"] for field in deleted.json()["note_types"][0]["fields"]])

    def test_field_rename_and_delete_update_conditional_template_sections(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)

            templated = client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": "{{#Back}}Extra: {{Back}}{{/Back}}", "back": None},
            )
            self.assertEqual(200, templated.status_code, templated.text)

            renamed = client.patch(f"/api/note-types/{note_type_id}/fields/1", json={"name": "Answer"})
            self.assertEqual(200, renamed.status_code, renamed.text)
            front_after_rename = renamed.json()["note_types"][0]["templates"][0]["front"]
            self.assertEqual("{{#Answer}}Extra: {{Answer}}{{/Answer}}", front_after_rename)

            deleted = client.delete(f"/api/note-types/{note_type_id}/fields/1")
            self.assertEqual(200, deleted.status_code, deleted.text)
            front_after_delete = deleted.json()["note_types"][0]["templates"][0]["front"]
            self.assertEqual("Extra: ", front_after_delete)

    def test_project_import_marks_workspace_dirty(self) -> None:
        project_path = self.root / "project.zip"
        export_project(self.package, self.package.note_types[0], project_path)

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            imported = client.post("/api/projects/import", json={"path": str(project_path)})
            self.assertEqual(200, imported.status_code, imported.text)
            payload = imported.json()
            self.assertEqual(note_type_id, payload["note_type_id"])
            self.assertTrue(payload["workspace"]["requires_save_as"])

    def test_xlsx_inspect_and_create_from_table(self) -> None:
        openpyxl = find_spec("openpyxl")
        self.assertIsNotNone(openpyxl, "openpyxl is required for XLSX import tests")
        from openpyxl import Workbook

        xlsx_path = self.root / "cards.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Cards"
        sheet.append(["Front", "Back"])
        sheet.append(["hello", "world"])
        workbook.save(xlsx_path)
        workbook.close()

        with TestClient(backend.app) as client:
            inspected = client.post("/api/tables/inspect", json={"path": str(xlsx_path), "sheet_name": "Cards"})
            self.assertEqual(200, inspected.status_code, inspected.text)
            preview = inspected.json()
            self.assertEqual("xlsx", preview["kind"])
            self.assertEqual("Cards", preview["selected_sheet"])
            self.assertEqual(["Front", "Back"], preview["sample_rows"][0])
            self.assertEqual(["hello", "world"], preview["sample_rows"][1])

            created = client.post(
                "/api/tables/create",
                json={
                    "path": str(xlsx_path),
                    "sheet_name": "Cards",
                    "first_row_is_header": True,
                    "field_names": ["Front", "Back"],
                    "deck_name": "Imported deck",
                    "note_type_name": "Imported",
                    "front_field": 0,
                    "back_field": 1,
                },
            )
            self.assertEqual(200, created.status_code, created.text)
            workspace = created.json()
            self.assertTrue(workspace["requires_save_as"])
            self.assertEqual("Imported", workspace["note_types"][0]["name"])
            self.assertEqual([["hello", "world"]], workspace["note_types"][0]["notes"])

    def test_create_from_table_skips_excluded_columns(self) -> None:
        openpyxl = find_spec("openpyxl")
        self.assertIsNotNone(openpyxl, "openpyxl is required for XLSX import tests")
        from openpyxl import Workbook

        xlsx_path = self.root / "cards_with_notes.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Cards"
        sheet.append(["Front", "Internal Note", "Back"])
        sheet.append(["hello", "skip me", "world"])
        workbook.save(xlsx_path)
        workbook.close()

        with TestClient(backend.app) as client:
            created = client.post(
                "/api/tables/create",
                json={
                    "path": str(xlsx_path),
                    "sheet_name": "Cards",
                    "first_row_is_header": True,
                    "field_names": ["Front", "Back"],
                    "deck_name": "Imported deck",
                    "note_type_name": "Imported",
                    "front_field": 0,
                    "back_field": 1,
                    "included_columns": [0, 2],
                },
            )
            self.assertEqual(200, created.status_code, created.text)
            workspace = created.json()
            note_type = workspace["note_types"][0]
            self.assertEqual(["Front", "Back"], [field["name"] for field in note_type["fields"]])
            self.assertEqual([["hello", "world"]], note_type["notes"])

    def test_media_delete_requires_force_when_referenced(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            imported = client.post("/api/media/import", json={"paths": [str(asset)], "template_asset": True})
            self.assertEqual(200, imported.status_code, imported.text)
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": '<img src="_badge.svg">'},
            )
            stored_name = client.get("/api/media").json()[0]["stored_name"]

            blocked = client.delete(f"/api/media/{stored_name}")
            self.assertEqual(409, blocked.status_code, blocked.text)

            forced = client.delete(f"/api/media/{stored_name}?force=true")
            self.assertEqual(200, forced.status_code, forced.text)
            self.assertEqual(1, forced.json()["workspace"]["media_count"])
            remaining = client.get("/api/media").json()
            self.assertEqual(["answer.mp3"], [item["name"] for item in remaining])

    def test_media_export_respects_type_filter(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            imported = client.post("/api/media/import", json={"paths": [str(asset)], "template_asset": True})
            self.assertEqual(200, imported.status_code, imported.text)

            filtered = client.get(f"/api/note-types/{note_type_id}/export/media", params={"media_type": "audio"})
            self.assertEqual(200, filtered.status_code, filtered.text)
            self.assertIn("_미디어_음성.zip", unquote(filtered.headers.get("content-disposition", "")))
            with zipfile.ZipFile(io.BytesIO(filtered.content)) as archive:
                self.assertEqual(["media/answer.mp3"], archive.namelist())

            complete = client.get(f"/api/note-types/{note_type_id}/export/media")
            self.assertEqual(200, complete.status_code, complete.text)
            disposition = unquote(complete.headers.get("content-disposition", ""))
            self.assertIn("_미디어.zip", disposition)
            self.assertNotIn("_미디어_음성.zip", disposition)
            with zipfile.ZipFile(io.BytesIO(complete.content)) as archive:
                self.assertEqual(["media/_badge.svg", "media/answer.mp3"], sorted(archive.namelist()))

    def test_media_export_rejects_unsafe_media_name_with_client_error(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            item = client.get("/api/media").json()[0]
            package = backend.app.state.workspace.package
            assert package is not None
            package.media[item["stored_name"]] = "../escaped.mp3"

            response = client.get(f"/api/note-types/{note_type_id}/export/media")
            self.assertEqual(400, response.status_code, response.text)
            self.assertIn("내보낼 수 없는 미디어", response.json()["detail"])

    def test_media_rename_updates_references(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            imported = client.post("/api/media/import", json={"paths": [str(asset)], "template_asset": True})
            self.assertEqual(200, imported.status_code, imported.text)
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": '<img src="_badge.svg">{{Front}}'},
            )
            client.patch(
                f"/api/note-types/{note_type_id}/notes/0/fields/1",
                json={"value": "[sound:answer.mp3]"},
            )
            badge = next(item for item in client.get("/api/media").json() if item["name"] == "_badge.svg")
            sound = next(item for item in client.get("/api/media").json() if item["name"] == "answer.mp3")

            renamed = client.patch(f"/api/media/{badge['stored_name']}", json={"name": "_logo.svg"})
            self.assertEqual(200, renamed.status_code, renamed.text)
            self.assertEqual("_badge.svg", renamed.json()["old_name"])
            self.assertEqual("_logo.svg", renamed.json()["new_name"])
            template = client.get("/api/workspace").json()["note_types"][0]["templates"][0]["front"]
            self.assertIn('src="_logo.svg"', template)

            blocked = client.patch(f"/api/media/{sound['stored_name']}", json={"name": "answer.wav"})
            self.assertEqual(400, blocked.status_code, blocked.text)

    def test_move_notes_between_note_types_with_field_mapping(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, source_id = self._open_workspace(client)
            cloned = client.post(
                f"/api/note-types/{source_id}/clone",
                json={"name": "Target", "move_cards": False},
            )
            self.assertEqual(200, cloned.status_code, cloned.text)
            target_id = cloned.json()["selected_note_type_id"]
            self.assertNotEqual(source_id, target_id)

            # Leave the clone empty so the move appends only the source cards.
            package = backend.app.state.workspace.package
            assert package is not None
            destination = next(item for item in package.note_types if item.id == target_id)
            destination.notes = []
            package.note_ids[target_id] = []

            moved = client.post(
                f"/api/note-types/{source_id}/move-notes",
                json={"destination_id": target_id, "mapping": {"0": 1, "1": 0}},
            )
            self.assertEqual(200, moved.status_code, moved.text)
            payload = moved.json()
            self.assertEqual(1, payload["moved"])
            self.assertEqual(target_id, payload["workspace"]["selected_note_type_id"])

            types = {item["id"]: item for item in payload["workspace"]["note_types"]}
            self.assertEqual([], types[source_id]["notes"])
            self.assertEqual([["[sound:answer.mp3]", "question"]], types[target_id]["notes"])

            deleted = client.delete(f"/api/note-types/{source_id}")
            self.assertEqual(200, deleted.status_code, deleted.text)
            remaining = deleted.json()["note_types"]
            self.assertEqual(1, len(remaining))
            self.assertEqual("Target", remaining[0]["name"])

            same = client.post(
                f"/api/note-types/{target_id}/move-notes",
                json={"destination_id": target_id, "mapping": {"0": 0}},
            )
            self.assertEqual(400, same.status_code, same.text)

    def test_preview_embeds_pending_design_assets(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.post("/api/media/import", json={"paths": [str(asset)], "template_asset": True})
            client.patch(
                f"/api/note-types/{note_type_id}/css",
                json={"css": '.badge { background-image: url("_badge.svg"); }'},
            )
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": '<img src="_badge.svg">'},
            )
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]
            badge_item = next(item for item in client.get("/api/media").json() if item["name"] == "_badge.svg")
            badge_url = re.compile(rf"/api/preview-media/[^/]+/{re.escape(badge_item['stored_name'])}")

            self.assertNotIn('src="_badge.svg"', preview)
            self.assertNotIn('url("_badge.svg")', preview)
            self.assertEqual(3, len(badge_url.findall(preview)))

    def test_preview_uses_anki_compatible_replay_button(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            preview = client.get(
                f"/api/note-types/{note_type_id}/preview",
                params={"side": "back"},
            ).json()["html"]
            self.assertIn("class='replay-button anki-audio sound'", preview)
            self.assertIn("aria-label='음성 재생'><span><svg", preview)
            self.assertIn("<svg class='playImage' viewBox='0 0 64 64'", preview)
            self.assertIn("<circle cx='32' cy='32' r='29'/>", preview)
            self.assertIn(".replay-button span{display:inline-flex", preview)

    def test_preview_does_not_autoplay_frontside_audio_again_on_answer(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.patch(
                f"/api/note-types/{note_type_id}/notes/0/fields/0",
                json={"value": "[sound:answer.mp3]"},
            )
            preview = client.get(
                f"/api/note-types/{note_type_id}/preview",
                params={"side": "back"},
            ).json()["html"]

            self.assertEqual(2, preview.count("class='replay-button anki-audio sound'"))
            self.assertEqual(1, preview.count("data-autoplay='false'"))

    def test_preview_resolves_quoted_sound_filenames_safely(self) -> None:
        sound = self.root / "teacher's answer.mp3"
        sound.write_bytes(b"audio")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.post("/api/media/import", json={"paths": [str(sound)]})
            client.patch(
                f"/api/note-types/{note_type_id}/notes/0/fields/1",
                json={"value": "[sound:teacher's answer.mp3]"},
            )
            preview = client.get(
                f"/api/note-types/{note_type_id}/preview",
                params={"side": "back"},
            ).json()["html"]
            self.assertIn("/api/preview-media/", preview)
            self.assertEqual(1, preview.count("class='replay-button anki-audio sound'"))

    def test_preview_resolves_dynamic_template_media_assignments(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        stylesheet = self.root / "theme.css"
        stylesheet.write_text('.badge{background:url("_badge.svg")}', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.post(
                "/api/media/import",
                json={"paths": [str(asset), str(stylesheet)], "template_asset": True},
            )
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={
                    "front": (
                        '<script>const filename = "./_badge.svg"; image.src = filename;'
                        'image.srcset = `${filename} 1x, _badge.svg 2x`;'
                        'const panel = document.createElement("div");'
                        'panel.style.backgroundImage = `url("${filename}")`; document.body.append(panel);'
                        'const style = document.createElement("style");'
                        'style.textContent = `.badge{background:url("${filename}")}`; document.head.append(style);'
                        'const link = document.createElement("link"); link.rel = "stylesheet";'
                        'link.href = "_theme.css"; document.head.append(link);'
                        "</script>"
                    )
                },
            )
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]

            self.assertIn('"_badge.svg":', preview)
            self.assertRegex(preview, r'"_theme\.css":\s*"data:text/css;base64,')
            self.assertIn('image.srcset = `${filename} 1x, _badge.svg 2x`', preview)
            self.assertIn('patch(HTMLImageElement.prototype,"src")', preview)
            self.assertIn('patch(HTMLImageElement.prototype,"srcset",resolveSrcset)', preview)
            self.assertIn('patch(CSSStyleDeclaration.prototype,property,resolveCss)', preview)
            self.assertIn('attributeFilter:["src","srcset","poster","href","style"]', preview)
            self.assertIn("element instanceof HTMLStyleElement", preview)
            self.assertLess(preview.index('patch(HTMLImageElement.prototype,"src")'), preview.index("image.src = filename"))
            self.assertIn("https://preview.invalid/", preview)
            self.assertIn('plain.split("/").filter(Boolean).pop()', preview)
            self.assertNotIn("document.baseURI", preview)
            self.assertRegex(preview, r'const filename = "http://[^"]+/api/preview-media/[^"]+"')
            self.assertRegex(preview, r'link\.href = "data:text/css;base64,')

    def test_preview_uses_opaque_iframe_storage_without_parent_access(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]
            self.assertNotIn("window.parent", preview)
            self.assertIn('Object.defineProperty(window,"localStorage"', preview)
            self.assertIn('Object.defineProperty(window,"sessionStorage"', preview)

    def test_preview_rewrites_linked_stylesheet_assets(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        stylesheet = self.root / "theme.css"
        stylesheet.write_text('.badge { background-image: url("_badge.svg"); }', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.post("/api/media/import", json={"paths": [str(asset), str(stylesheet)], "template_asset": True})
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": '<link rel="stylesheet" href="_theme.css">'},
            )
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]

            encoded = preview.split("data:text/css;base64,", 1)[1].split('"', 1)[0]
            stylesheet_preview = __import__("base64").b64decode(encoded).decode("utf-8")
            self.assertIn("/api/preview-media/", stylesheet_preview)


if __name__ == "__main__":
    unittest.main()
