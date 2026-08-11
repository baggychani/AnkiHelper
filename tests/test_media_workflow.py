from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from anki_helper.anki_package import (
    create_package_from_table,
    export_bundle,
    export_media,
    export_project,
    import_media,
    media_items,
    read_apkg,
    save_apkg,
)


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

    def test_multi_file_import_is_atomic(self) -> None:
        missing = self.root / "missing.svg"
        with self.assertRaises(ValueError):
            import_media(self.package, [self.asset, missing], template_asset=True)
        self.assertEqual({}, self.package.media)
        self.assertEqual({}, self.package.pending_media)


if __name__ == "__main__":
    unittest.main()
