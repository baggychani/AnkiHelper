from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from anki_helper.anki_package import (
    apply_ankidesign,
    ankidesign_media_conflicts,
    create_package_from_table,
    export_ankidesign,
    import_media,
    read_ankidesign,
    read_apkg,
    save_apkg,
)


def _write_design(path: Path, *, front: str, back: str, css: str, media: dict[str, bytes], templates: list[dict[str, str]] | None = None) -> None:
    document = {
        "format": "anki-helper/ankidesign-v1",
        "templates": templates or [{"name": "Card 1", "front": front, "back": back}],
        "css": css,
        "media": list(media),
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(document))
        for name, data in media.items():
            archive.writestr(f"media/{name}", data)


class AnkiDesignTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.package = create_package_from_table(
            ["단어", "뜻"],
            [["苹果", "사과"]],
            deck_name="단어장",
            note_type_name="기본",
            front_field=0,
            back_field=1,
        )
        self.icon = self.root / "heart.svg"
        self.icon.write_bytes(b"<svg>heart</svg>")
        import_media(self.package, [self.icon])
        self.package.note_types[0].templates[0].front = '<img src="heart.svg">{{단어}}'
        self.package.note_types[0].templates[0].back = "{{FrontSide}}<hr>{{뜻}}"
        self.package.note_types[0].css = ".card { background: url(heart.svg); }"
        save_apkg(self.package, backup=False)
        self.package = read_apkg(self.package.source)

    def tearDown(self) -> None:
        for staged in self.package.pending_media.values():
            staged.unlink(missing_ok=True)
        self.package.source.unlink(missing_ok=True)
        self.temporary.cleanup()

    def _media_bytes(self, name: str) -> bytes:
        stored = next(stored_name for stored_name, current in self.package.media.items() if current == name)
        staged = self.package.pending_media.get(stored)
        if staged:
            return staged.read_bytes()
        with zipfile.ZipFile(self.package.source) as archive:
            return archive.read(stored)

    def test_export_includes_only_media_named_in_the_card_code(self) -> None:
        unused = self.root / "unused.svg"
        unused.write_bytes(b"<svg>unused</svg>")
        import_media(self.package, [unused])
        self.package.note_types[0].templates[0].front += '<img src="missing.svg">'
        destination = self.root / "deck.ankidesign"
        _written, missing = export_ankidesign(self.package, self.package.note_types[0], destination)
        self.assertEqual(["missing.svg"], missing)
        design = read_ankidesign(destination)
        self.assertEqual({"heart.svg": b"<svg>heart</svg>"}, design.media)
        self.assertIn("{{단어}}", design.templates[0].front)
        self.assertEqual(".card { background: url(heart.svg); }", design.css)

    def test_import_rewrites_mapped_fields_without_touching_notes(self) -> None:
        path = self.root / "imported.ankidesign"
        _write_design(
            path,
            front='{{#Word}}<img src="flag.svg">{{Word}}{{/Word}}',
            back="{{FrontSide}}<hr>{{cloze:Meaning}}",
            css=".card { color: red; }",
            media={"flag.svg": b"<svg>flag</svg>"},
        )
        design = read_ankidesign(path)
        note_type = self.package.note_types[0]
        original_notes = [list(row) for row in note_type.notes]
        original_fields = [field.name for field in note_type.fields]
        apply_ankidesign(note_type=note_type, package=self.package, design=design, mapping={"Word": "단어", "Meaning": "뜻"}, overwrite_media=False)
        self.assertEqual(original_notes, note_type.notes)
        self.assertEqual(original_fields, [field.name for field in note_type.fields])
        self.assertEqual('{{#단어}}<img src="flag.svg">{{단어}}{{/단어}}', note_type.templates[0].front)
        self.assertEqual("{{FrontSide}}<hr>{{cloze:뜻}}", note_type.templates[0].back)
        self.assertEqual(".card { color: red; }", note_type.css)
        self.assertIn("flag.svg", self.package.media.values())

    def test_same_name_keeps_existing_bytes_unless_overwrite_is_chosen(self) -> None:
        path = self.root / "conflict.ankidesign"
        _write_design(path, front='<img src="heart.svg">', back="{{뜻}}", css="", media={"heart.svg": b"<svg>new</svg>"})
        design = read_ankidesign(path)
        self.assertEqual(["heart.svg"], ankidesign_media_conflicts(self.package, design))
        apply_ankidesign(self.package, self.package.note_types[0], design, {}, overwrite_media=False)
        self.assertEqual(b"<svg>heart</svg>", self._media_bytes("heart.svg"))
        apply_ankidesign(self.package, self.package.note_types[0], design, {}, overwrite_media=True)
        stored = next(stored_name for stored_name, name in self.package.media.items() if name == "heart.svg")
        self.assertEqual(b"<svg>new</svg>", self.package.pending_media[stored].read_bytes())

    def test_identical_media_is_not_a_conflict(self) -> None:
        path = self.root / "same.ankidesign"
        _write_design(path, front='<img src="heart.svg">', back="", css="", media={"heart.svg": b"<svg>heart</svg>"})
        self.assertEqual([], ankidesign_media_conflicts(self.package, read_ankidesign(path)))

    def test_importing_another_card_template_is_saved_with_the_notes(self) -> None:
        path = self.root / "two-cards.ankidesign"
        _write_design(
            path,
            front="",
            back="",
            css=".card {}",
            media={},
            templates=[
                {"name": "앞면", "front": "{{단어}}", "back": "{{뜻}}"},
                {"name": "뒷면", "front": "{{뜻}}", "back": "{{단어}}"},
            ],
        )
        apply_ankidesign(self.package, self.package.note_types[0], read_ankidesign(path), {"단어": "단어", "뜻": "뜻"}, overwrite_media=False)
        save_apkg(self.package, backup=False)
        reopened = read_apkg(self.package.source)
        templates = reopened.note_types[0].templates
        self.assertEqual(["앞면", "뒷면"], [template.name for template in templates])
        self.assertEqual(["{{단어}}", "{{뜻}}"], [template.front for template in templates])
        database = self.root / "collection.anki2"
        with zipfile.ZipFile(self.package.source) as archive:
            database.write_bytes(archive.read("collection.anki2"))
        connection = sqlite3.connect(database)
        try:
            self.assertEqual(2, connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0])
        finally:
            connection.close()

    def test_rejects_a_file_that_is_not_ankidesign(self) -> None:
        path = self.root / "notes.json"
        path.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            read_ankidesign(path)
