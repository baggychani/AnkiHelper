from __future__ import annotations

import tempfile
import unittest
import zipfile
from importlib.util import find_spec
from pathlib import Path

from anki_helper.anki_package import (
    _safe_media_name,
    _unique_media_name,
    create_package_from_table,
    decode_media_payload,
    export_bundle,
    export_media,
    export_project,
    import_media,
    media_health,
    media_reference_filename,
    media_items,
    read_apkg,
    save_apkg,
    split_field_content,
)

backend = None
if find_spec("fastapi") is not None:
    from anki_helper import backend


class MediaWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.asset = self.root / "badge.svg"
        self.asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        self.package = create_package_from_table(
            ["Front", "Back"], [["question", "answer"]],
            deck_name="Media test", note_type_name="Basic", front_field=0, back_field=1,
        )

    def tearDown(self) -> None:
        for staged_path in self.package.pending_media.values():
            staged_path.unlink(missing_ok=True)
        self.package.source.unlink(missing_ok=True)
        self.temporary.cleanup()

    def test_pending_media_is_exported_and_saved(self) -> None:
        added = import_media(self.package, [self.asset], template_asset=True)
        self.assertEqual("_badge.svg", added[0]["name"])

        media_archive = self.root / "media.zip"
        bundle_archive = self.root / "bundle.zip"
        project_archive = self.root / "project.zip"
        export_media(self.package, media_archive)
        export_bundle(self.package, self.package.note_types[0], bundle_archive)
        export_project(self.package, self.package.note_types[0], project_archive)

        for archive_path in (media_archive, bundle_archive, project_archive):
            with zipfile.ZipFile(archive_path) as archive:
                self.assertIn("media/_badge.svg", archive.namelist())

        save_apkg(self.package, backup=False)
        reopened = read_apkg(self.package.source)
        self.assertEqual(["_badge.svg"], [item["name"] for item in media_items(reopened)])

    @unittest.skipIf(find_spec("zstandard") is None, "zstandard is required for modern Anki media")
    def test_modern_anki_compressed_media_payload_is_decoded(self) -> None:
        import zstandard

        original = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
        compressed = zstandard.ZstdCompressor().compress(original)

        self.assertEqual(original, decode_media_payload(compressed))

    def test_new_deck_template_includes_pending_media(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        self.package.note_types[0].templates[0].front = '<img src="_badge.svg" alt="">{{Front}}'
        created = create_package_from_table(
            ["Front", "Back"], [["new question", "new answer"]],
            deck_name="New deck", note_type_name="Basic", front_field=0, back_field=1,
            template=self.package.note_types[0], template_package=self.package,
        )
        try:
            self.assertEqual(["_badge.svg"], [item["name"] for item in media_items(created)])
            self.assertIn('_badge.svg', created.note_types[0].templates[0].front)
        finally:
            created.source.unlink(missing_ok=True)

    @unittest.skipIf(backend is None, "FastAPI is required for backend preview tests")
    def test_preview_embeds_pending_design_assets(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        previous_package = backend._package
        backend._package = self.package
        try:
            preview = backend._embed_preview_media(
                '<style>.badge { background-image: url("_badge.svg"); }</style><img src="_badge.svg">'
            )
        finally:
            backend._package = previous_package

        self.assertNotIn('src="_badge.svg"', preview)
        self.assertNotIn('url("_badge.svg")', preview)
        self.assertEqual(3, preview.count("http://127.0.0.1:8765/api/media/0"))

    @unittest.skipIf(backend is None, "FastAPI is required for backend preview tests")
    def test_preview_resolves_dynamic_template_media_assignments(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        previous_package = backend._package
        backend._package = self.package
        try:
            preview = backend._embed_preview_media('<script>const filename = "_badge.svg"; image.src = filename</script>')
        finally:
            backend._package = previous_package

        self.assertIn('const assets={"_badge.svg": "http://127.0.0.1:8765/api/media/0"}', preview)
        self.assertIn('patch(HTMLImageElement.prototype,"src")', preview)
        self.assertLess(preview.index('patch(HTMLImageElement.prototype,"src")'), preview.index('image.src = filename'))

    @unittest.skipIf(backend is None, "FastAPI is required for backend preview tests")
    def test_preview_preserves_storage_between_iframe_documents(self) -> None:
        previous_package = backend._package
        backend._package = self.package
        try:
            preview = backend._embed_preview_media("<div></div>")
        finally:
            backend._package = previous_package

        self.assertIn('host.__ankiHelperPreviewState', preview)
        self.assertIn('states.storage', preview)
        self.assertIn('Storage.prototype.getItem=function', preview)

    @unittest.skipIf(backend is None, "FastAPI is required for backend preview tests")
    def test_preview_rewrites_linked_stylesheet_assets(self) -> None:
        stylesheet = self.root / "theme.css"
        stylesheet.write_text('.badge { background-image: url("_badge.svg"); }', encoding="utf-8")
        import_media(self.package, [self.asset, stylesheet], template_asset=True)
        previous_package = backend._package
        backend._package = self.package
        try:
            preview = backend._embed_preview_media('<link rel="stylesheet" href="_theme.css">')
        finally:
            backend._package = previous_package

        encoded = preview.split("data:text/css;base64,", 1)[1].split('"', 1)[0]
        stylesheet_preview = __import__("base64").b64decode(encoded).decode("utf-8")
        self.assertIn("http://127.0.0.1:8765/api/media/0", stylesheet_preview)

    @unittest.skipIf(backend is None, "FastAPI is required for backend preview tests")
    def test_media_delete_requires_force_when_referenced(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        self.package.note_types[0].templates[0].front = '<img src="_badge.svg">'
        previous_package = backend._package
        backend._package = self.package
        try:
            with self.assertRaises(backend.HTTPException) as raised:
                backend.delete_media("0")
            self.assertEqual(409, raised.exception.status_code)
            backend.delete_media("0", force=True)
        finally:
            backend._package = previous_package
        self.assertEqual({}, self.package.media)

    def test_media_health_resolves_url_encoded_references_and_reports_missing(self) -> None:
        special = self.root / "badge 100%.svg"
        unused = self.root / "unused.mp3"
        special.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        unused.write_bytes(b"not-a-real-mp3")
        import_media(self.package, [special], template_asset=True)
        import_media(self.package, [unused])
        self.package.note_types[0].templates[0].front = '<img src="_badge%20100%25.svg"><img src="_missing.svg">'

        report = media_health(self.package)

        self.assertEqual("_badge 100%.svg", media_reference_filename("_badge%20100%25.svg"))
        self.assertIn("_badge 100%.svg", report["references"])
        self.assertEqual("_missing.svg", report["missing"][0]["filename"])
        self.assertEqual(["unused.mp3"], [item["name"] for item in report["unused"]])

    def test_media_health_recognizes_template_script_asset_names(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        self.package.note_types[0].templates[0].front = '<script>const characters = ["_badge.svg"]</script>'

        report = media_health(self.package)

        self.assertIn("_badge.svg", report["references"])
        self.assertEqual([], report["static_unreferenced"])
        self.assertEqual("script", report["references"]["_badge.svg"][0]["source"])

    def test_import_normalizes_sync_unsafe_filename_and_case_collisions(self) -> None:
        self.assertEqual("a_b_.svg", _safe_media_name("a:b?.svg"))
        self.assertEqual("Badge-2.svg", _unique_media_name("Badge.svg", {"badge.svg"}))

    def test_field_media_split_preserves_embedded_video(self) -> None:
        text, media = split_field_content('설명 <video src="clip.mp4" controls><source src="clip.mp4"></video>')
        self.assertEqual("설명", text)
        self.assertIn('<video src="clip.mp4"', media)

    def test_multi_file_import_is_atomic(self) -> None:
        missing = self.root / "missing.svg"
        with self.assertRaises(ValueError):
            import_media(self.package, [self.asset, missing], template_asset=True)
        self.assertEqual({}, self.package.media)
        self.assertEqual({}, self.package.pending_media)


if __name__ == "__main__":
    unittest.main()
