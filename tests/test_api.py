from __future__ import annotations

import importlib
import tempfile
import unittest
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

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
            self.assertIn("/api/media/0", preview_html)

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
            saved = client.post("/api/packages/save", json={"path": str(save_path)})
            self.assertEqual(200, saved.status_code, saved.text)
            self.assertTrue(save_path.is_file())
            self.assertEqual(str(save_path), saved.json()["saved_to"])
            self.assertFalse(saved.json()["workspace"]["requires_save_as"])

            deleted = client.delete(f"/api/note-types/{note_type_id}/fields/2")
            self.assertEqual(200, deleted.status_code, deleted.text)
            self.assertEqual(["Extra", "Question"], [field["name"] for field in deleted.json()["note_types"][0]["fields"]])

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
            badge_url = f"/api/media/{badge_item['stored_name']}"

            self.assertNotIn('src="_badge.svg"', preview)
            self.assertNotIn('url("_badge.svg")', preview)
            self.assertEqual(3, preview.count(badge_url))

    def test_preview_uses_anki_compatible_replay_button(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            preview = client.get(
                f"/api/note-types/{note_type_id}/preview",
                params={"side": "back"},
            ).json()["html"]
            self.assertIn("class='replay-button anki-audio sound'", preview)
            self.assertIn("<svg viewBox='0 0 48 48'", preview)

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
            self.assertIn("/api/media/", preview)
            self.assertEqual(1, preview.count("class='replay-button anki-audio sound'"))

    def test_preview_resolves_dynamic_template_media_assignments(self) -> None:
        asset = self.root / "badge.svg"
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")

        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            client.post("/api/media/import", json={"paths": [str(asset)], "template_asset": True})
            client.patch(
                f"/api/note-types/{note_type_id}/templates/0",
                json={"front": '<script>const filename = "_badge.svg"; image.src = filename</script>'},
            )
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]

            self.assertIn('"_badge.svg":', preview)
            self.assertIn('patch(HTMLImageElement.prototype,"src")', preview)
            self.assertLess(preview.index('patch(HTMLImageElement.prototype,"src")'), preview.index("image.src = filename"))

    def test_preview_preserves_storage_between_iframe_documents(self) -> None:
        with TestClient(backend.app) as client:
            _workspace, note_type_id = self._open_workspace(client)
            preview = client.get(f"/api/note-types/{note_type_id}/preview").json()["html"]
            self.assertIn("host.__ankiHelperPreviewState", preview)
            self.assertIn("states.storage", preview)
            self.assertIn("Storage.prototype.getItem=function", preview)

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
            self.assertIn("/api/media/", stylesheet_preview)


if __name__ == "__main__":
    unittest.main()
