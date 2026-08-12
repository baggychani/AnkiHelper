from __future__ import annotations

import importlib
import tempfile
import unittest
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

from anki_helper.anki_package import create_package_from_table, import_media, save_apkg


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
            opened = client.post("/api/packages/open", json={"path": str(self.package.source)})
            self.assertEqual(200, opened.status_code, opened.text)
            workspace = opened.json()
            self.assertEqual(1, workspace["media_count"])
            note_type_id = workspace["selected_note_type_id"]

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

        self.assertIsNone(backend.app.state.workspace.package)
        self.assertIsNone(backend.app.state.workspace.selected_note_type_id)


if __name__ == "__main__":
    unittest.main()
