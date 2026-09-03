from __future__ import annotations

import sqlite3
import tempfile
import unittest
import zipfile
import json
from importlib.util import find_spec
from pathlib import Path

from anki_helper.anki_package import (
    _safe_media_name,
    _unique_media_name,
    _compress_anki21b,
    _decompress_anki21b,
    _encode_modern_media_index,
    _protobuf_parts,
    _read_legacy_collection,
    Template,
    cloze_ordinals,
    create_package_from_table,
    decode_media_payload,
    export_bundle,
    export_media,
    export_project,
    import_media,
    inspect_table_source,
    media_health,
    media_reference_filename,
    media_items,
    read_apkg,
    remove_media,
    rename_media,
    render_template,
    save_apkg,
    split_field_content,
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

    def test_export_media_can_filter_by_type(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        sound = self.root / "answer.mp3"
        sound.write_bytes(b"complete audio payload")
        import_media(self.package, [sound])

        audio_archive = self.root / "audio.zip"
        export_media(self.package, audio_archive, "audio")
        with zipfile.ZipFile(audio_archive) as archive:
            self.assertEqual(["media/answer.mp3"], archive.namelist())

        image_archive = self.root / "image.zip"
        export_media(self.package, image_archive, "image")
        with zipfile.ZipFile(image_archive) as archive:
            self.assertEqual(["media/_badge.svg"], archive.namelist())

        all_archive = self.root / "all.zip"
        export_media(self.package, all_archive)
        with zipfile.ZipFile(all_archive) as archive:
            self.assertEqual(["media/_badge.svg", "media/answer.mp3"], sorted(archive.namelist()))

    def test_oga_media_is_classified_and_exported_as_audio(self) -> None:
        sound = self.root / "answer.oga"
        sound.write_bytes(b"OggS\x00audio")
        added = import_media(self.package, [sound])

        self.assertEqual("audio", added[0]["type"])
        archive_path = self.root / "audio.zip"
        export_media(self.package, archive_path, "audio")
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(["media/answer.oga"], archive.namelist())

    def test_fonts_follow_anki_underscore_template_name(self) -> None:
        font = self.root / "KNMaiyuan-Regular.ttf"
        font.write_bytes(b"OTTO")
        added = import_media(self.package, [font])
        self.assertEqual("_KNMaiyuan-Regular.ttf", added[0]["name"])
        self.assertEqual("font", added[0]["type"])

        already_prefixed = self.root / "_Existing.woff2"
        already_prefixed.write_bytes(b"wOF2")
        second = import_media(self.package, [already_prefixed])
        self.assertEqual("_Existing.woff2", second[0]["name"])

    def test_font_import_keeps_a_name_the_design_already_references(self) -> None:
        font = self.root / "KNMaiyuan-Regular.ttf"
        font.write_bytes(b"OTTO")
        self.package.note_types[0].css = '@font-face{font-family:"KN";src:url("KNMaiyuan-Regular.ttf")}'

        added = import_media(self.package, [font])

        self.assertEqual("KNMaiyuan-Regular.ttf", added[0]["name"])
        self.assertEqual([], media_health(self.package)["missing"])

    def test_exports_reject_unsafe_media_names_before_creating_archives(self) -> None:
        added = import_media(self.package, [self.asset])
        self.package.media[added[0]["stored_name"]] = "../escaped.svg"

        exports = (
            (self.root / "media.zip", lambda path: export_media(self.package, path)),
            (self.root / "project.zip", lambda path: export_project(self.package, self.package.note_types[0], path)),
            (self.root / "bundle.zip", lambda path: export_bundle(self.package, self.package.note_types[0], path)),
        )
        for target, export in exports:
            with self.subTest(target=target.name), self.assertRaisesRegex(ValueError, "내보낼 수 없는 미디어"):
                export(target)
            self.assertFalse(target.exists())

    def test_media_export_rejects_casefold_collisions(self) -> None:
        second = self.root / "icon.svg"
        second.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        first_item, second_item = import_media(self.package, [self.asset, second])
        self.package.media[first_item["stored_name"]] = "Badge.svg"
        self.package.media[second_item["stored_name"]] = "badge.svg"

        archive_path = self.root / "media.zip"
        with self.assertRaisesRegex(ValueError, "겹치는 미디어 파일 이름"):
            export_media(self.package, archive_path)
        self.assertFalse(archive_path.exists())

    def test_reads_normalized_collection_using_unicase_collated_columns(self) -> None:
        """Newer Anki exports declare `fields.name`/`templates.name` as COLLATE unicase.

        Python's stdlib sqlite3 does not know that collation, so any query
        touching those columns must have it registered on the connection first
        (see the fix alongside this test) or every read of a modern APKG whose
        collection uses that collation fails with `sqlite3.OperationalError:
        no query solution`.
        """
        def protobuf_string(field: int, value: str) -> bytes:
            encoded = value.encode("utf-8")
            tag = (field << 3) | 2
            return bytes([tag, len(encoded)]) + encoded

        database_path = self.root / "normalized.anki2"
        connection = sqlite3.connect(database_path)
        # Only needed to author the fixture; the read path under test opens its
        # own fresh connection and must register this collation itself.
        connection.create_collation("unicase", lambda left, right: (left > right) - (left < right))
        try:
            connection.executescript(
                """
                CREATE TABLE col (id integer PRIMARY KEY, models text);
                CREATE TABLE notetypes (id integer PRIMARY KEY, name text, config blob);
                CREATE TABLE fields (
                    ntid integer NOT NULL, ord integer NOT NULL,
                    name text NOT NULL COLLATE unicase, config blob NOT NULL,
                    PRIMARY KEY (ntid, ord)
                ) without rowid;
                CREATE TABLE templates (
                    ntid integer NOT NULL, ord integer NOT NULL,
                    name text NOT NULL COLLATE unicase, config blob NOT NULL,
                    PRIMARY KEY (ntid, ord)
                ) without rowid;
                CREATE TABLE notes (id integer PRIMARY KEY, mid integer, flds text);
                """
            )
            connection.execute("INSERT INTO col VALUES (1, '')")
            connection.execute("INSERT INTO notetypes VALUES (1, 'Basic', ?)", (protobuf_string(3, ".card {}"),))
            connection.execute("INSERT INTO fields VALUES (1, 0, 'Front', x'')")
            connection.execute("INSERT INTO fields VALUES (1, 1, 'Back', x'')")
            connection.execute(
                "INSERT INTO templates VALUES (1, 0, 'Card 1', ?)",
                (protobuf_string(1, "{{Front}}") + protobuf_string(2, "{{Back}}"),),
            )
            connection.execute("INSERT INTO notes VALUES (100, 1, 'question\x1fanswer')")
            connection.commit()
        finally:
            connection.close()

        package = _read_legacy_collection(database_path, database_path, {}, set(), "collection.anki21b")
        self.assertEqual(1, len(package.note_types))
        note_type = package.note_types[0]
        self.assertEqual(["Front", "Back"], [field.name for field in note_type.fields])
        self.assertEqual([["question", "answer"]], note_type.notes)

    @unittest.skipIf(find_spec("zstandard") is None, "zstandard is required for modern Anki media")
    def test_modern_anki_compressed_media_payload_is_decoded(self) -> None:
        import zstandard

        original = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
        compressed = zstandard.ZstdCompressor().compress(original)

        self.assertEqual(original, decode_media_payload(compressed))

    @unittest.skipIf(find_spec("zstandard") is None, "zstandard is required for modern Anki media")
    def test_modern_package_media_changes_keep_anki_protobuf_format(self) -> None:
        import_media(self.package, [self.asset], template_asset=True)
        save_apkg(self.package, backup=False)
        modern_source = self.root / "modern.apkg"
        with zipfile.ZipFile(self.package.source) as source, zipfile.ZipFile(modern_source, "w", zipfile.ZIP_DEFLATED) as output:
            database = source.read("collection.anki2")
            badge = source.read("0")
            output.writestr("collection.anki21b", _compress_anki21b(database))
            output.writestr("media", _compress_anki21b(_encode_modern_media_index([("_badge.svg", badge)])))
            output.writestr("0", _compress_anki21b(badge))

        package = read_apkg(modern_source)
        sound = self.root / "answer.mp3"
        sound.write_bytes(b"complete audio payload")
        import_media(package, [sound])
        saved = self.root / "modern-saved.apkg"
        save_apkg(package, saved, backup=False)

        with zipfile.ZipFile(saved) as archive:
            media_index = _decompress_anki21b(archive.read("media"))
            with self.assertRaises((UnicodeDecodeError, json.JSONDecodeError)):
                json.loads(media_index.decode("utf-8"))
            entries = _protobuf_parts(media_index)[1]
            names = [_protobuf_parts(entry)[1][0].decode("utf-8") for entry in entries]
            self.assertEqual(["_badge.svg", "answer.mp3"], names)
            self.assertTrue(archive.read("0").startswith(b"\x28\xb5\x2f\xfd"))
            self.assertTrue(archive.read("1").startswith(b"\x28\xb5\x2f\xfd"))
            self.assertEqual(badge, decode_media_payload(archive.read("0")))
            self.assertEqual(b"complete audio payload", decode_media_payload(archive.read("1")))

        reopened = read_apkg(saved)
        self.assertEqual(["_badge.svg", "answer.mp3"], sorted(reopened.media.values()))

        remove_media(reopened, "0")
        trimmed = self.root / "modern-trimmed.apkg"
        save_apkg(reopened, trimmed, backup=False)
        trimmed_package = read_apkg(trimmed)
        self.assertEqual({"0": "answer.mp3"}, trimmed_package.media)
        with zipfile.ZipFile(trimmed) as archive:
            self.assertEqual(b"complete audio payload", decode_media_payload(archive.read("0")))
            self.assertNotIn("1", archive.namelist())

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

    def test_table_import_stores_multiline_cells_as_anki_line_breaks(self) -> None:
        created = create_package_from_table(
            ["Front", "Back"], [["첫 줄\r\n둘째 줄", "answer\n둘째"]],
            deck_name="New deck", note_type_name="Basic", front_field=0, back_field=1,
        )
        try:
            self.assertEqual(["첫 줄<br>둘째 줄", "answer<br>둘째"], created.note_types[0].notes[0])
            self.assertEqual("New deck", created.deck_name)
        finally:
            created.source.unlink(missing_ok=True)

    def test_template_sections_do_not_duplicate_sound_fields(self) -> None:
        markup = render_template(
            "{{#Back}}<div class='answer-sound'>{{Back}}</div>{{/Back}}",
            self.package.note_types[0].fields,
            ["question", "[sound:answer.mp3]"],
        )

        self.assertEqual(
            "<div class='answer-sound'><span class=\"sound\" data-sound=\"answer.mp3\">"
            "🔊 answer.mp3</span></div>",
            markup,
        )
        self.assertEqual(
            "hidden",
            render_template(
                "{{#Back}}visible{{/Back}}{{^Back}}hidden{{/Back}}",
                self.package.note_types[0].fields,
                ["question", ""],
            ),
        )

    def test_preview_renders_common_anki_filters_and_special_fields(self) -> None:
        fields = self.package.note_types[0].fields
        values = ["<b>Question</b>", "東京[とうきょう]"]

        front = render_template(
            "{{text:Front}} · {{furigana:Back}} · {{type:Back}} · {{Type}} · {{Card}}",
            fields,
            values,
            special_values={"Type": "Basic", "Card": "Card 1"},
        )
        answer = render_template("{{type:Back}}", fields, values, is_answer=True)

        self.assertIn("Question", front)
        self.assertNotIn("<b>", front)
        self.assertIn("<ruby>東京<rt>とうきょう</rt></ruby>", front)
        self.assertIn('id="typeans" type="text"', front)
        self.assertIn("Basic · Card 1", front)
        self.assertEqual('<code id="typeans">東京[とうきょう]</code>', answer)

    def test_preview_renders_basic_cloze_on_question_and_answer(self) -> None:
        fields = self.package.note_types[0].fields
        values = ["{{c1::Istanbul::city}} and {{c2::Ankara}}", ""]

        question = render_template("{{cloze:Front}}", fields, values)
        answer = render_template("{{cloze:Front}}", fields, values, is_answer=True)

        self.assertEqual(
            '<span class="cloze" data-ordinal="1">[city]</span>'
            ' and <span class="cloze-inactive" data-ordinal="2">Ankara</span>',
            question,
        )
        self.assertEqual(
            '<span class="cloze" data-ordinal="1">Istanbul</span>'
            ' and <span class="cloze-inactive" data-ordinal="2">Ankara</span>',
            answer,
        )

    def test_preview_renders_the_selected_cloze_card(self) -> None:
        note_type = self.package.note_types[0]
        template = Template(name="Cloze", front="{{cloze:Front}}", back="{{cloze:Front}}")
        values = ["{{c1::Istanbul::city}} and {{c3::Ankara}}", ""]

        self.assertEqual([1, 3], cloze_ordinals(template, note_type.fields, values))
        third = render_template(template.front, note_type.fields, values, cloze_ordinal=3)
        self.assertEqual(
            '<span class="cloze-inactive" data-ordinal="1">Istanbul</span>'
            ' and <span class="cloze" data-ordinal="3">[...]</span>',
            third,
        )

    def test_cloze_ordinals_ignores_fields_without_the_cloze_filter(self) -> None:
        note_type = self.package.note_types[0]
        plain = Template(name="Card 1", front="{{Front}}", back="{{Back}}")

        self.assertEqual([], cloze_ordinals(plain, note_type.fields, ["{{c1::Istanbul}}", ""]))

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
        arbitrary_asset = self.root / "model.bin"
        arbitrary_asset.write_bytes(b"model")
        import_media(self.package, [self.asset, arbitrary_asset], template_asset=True)
        self.package.note_types[0].templates[0].front = (
            '<script>const characters = ["_badge.svg", "_model.bin"]; '
            'document.getElementById("random-character").classList.add("visible")</script>'
        )

        report = media_health(self.package)

        self.assertIn("_badge.svg", report["references"])
        self.assertIn("_model.bin", report["references"])
        self.assertEqual([], report["static_unreferenced"])
        self.assertEqual("script", report["references"]["_badge.svg"][0]["source"])
        self.assertEqual([], report["missing"])

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

    def test_rename_media_rewrites_references_and_rejects_extension_change(self) -> None:
        special = self.root / "badge 100%.svg"
        special.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        sound = self.root / "answer.mp3"
        sound.write_bytes(b"audio")
        import_media(self.package, [special], template_asset=True)
        import_media(self.package, [sound])
        note_type = self.package.note_types[0]
        note_type.templates[0].front = '<img src="_badge%20100%25.svg" alt="">{{Front}}'
        note_type.templates[0].back = '<script>const file = "_badge 100%.svg";</script>{{Back}}'
        note_type.css = '@font-face { src: url("_badge 100%.svg"); }'
        note_type.notes[0][1] = "[sound:answer.mp3]"
        stored = next(key for key, name in self.package.media.items() if name == "_badge 100%.svg")
        sound_stored = next(key for key, name in self.package.media.items() if name == "answer.mp3")

        renamed = rename_media(self.package, stored, "_logo.svg")
        self.assertEqual("_logo.svg", renamed["name"])
        self.assertEqual("_logo.svg", self.package.media[stored])
        self.assertIn('src="_logo.svg"', note_type.templates[0].front)
        self.assertIn('"_logo.svg"', note_type.templates[0].back)
        self.assertIn('url("_logo.svg")', note_type.css)

        sound_renamed = rename_media(self.package, sound_stored, "reply.mp3")
        self.assertEqual("reply.mp3", sound_renamed["name"])
        self.assertEqual("[sound:reply.mp3]", note_type.notes[0][1])

        stem_only = rename_media(self.package, sound_stored, "spoken")
        self.assertEqual("spoken.mp3", stem_only["name"])
        self.assertEqual("[sound:spoken.mp3]", note_type.notes[0][1])

        with self.assertRaises(ValueError):
            rename_media(self.package, sound_stored, "reply.wav")
        other = self.root / "other.mp3"
        other.write_bytes(b"other")
        import_media(self.package, [other])
        with self.assertRaises(ValueError):
            rename_media(self.package, sound_stored, "other.mp3")

    def test_rename_media_works_for_saved_apkg_entries(self) -> None:
        sound = self.root / "answer.mp3"
        sound.write_bytes(b"audio-bytes")
        import_media(self.package, [sound])
        self.package.note_types[0].notes[0][1] = "[sound:answer.mp3]"
        saved = self.root / "saved.apkg"
        save_apkg(self.package, saved, backup=False)
        reopened = read_apkg(saved)
        stored = next(key for key, name in reopened.media.items() if name == "answer.mp3")

        renamed = rename_media(reopened, stored, "reply.mp3")
        self.assertEqual("reply.mp3", renamed["name"])
        self.assertEqual("reply.mp3", reopened.media[stored])
        self.assertEqual("[sound:reply.mp3]", reopened.note_types[0].notes[0][1])
        self.assertGreater(renamed["size"], 0)
        self.assertEqual({}, reopened.pending_media)

    @unittest.skipIf(find_spec("openpyxl") is None, "openpyxl is required for XLSX import tests")
    def test_xlsx_table_source_reads_workbook_sheets(self) -> None:
        from openpyxl import Workbook

        xlsx_path = self.root / "table.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Sheet1"
        sheet["A1"] = "Front"
        sheet["B1"] = "Back"
        sheet["A2"] = "hello"
        sheet["B2"] = "world"
        workbook.create_sheet("Notes")
        workbook.save(xlsx_path)
        workbook.close()

        preview = inspect_table_source(xlsx_path)

        self.assertEqual("xlsx", preview.kind)
        self.assertEqual(["Sheet1", "Notes"], preview.sheet_names)
        self.assertEqual(["Front", "Back"], preview.rows[0])
        self.assertEqual(["hello", "world"], preview.rows[1])


if __name__ == "__main__":
    unittest.main()
