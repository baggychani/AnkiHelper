from __future__ import annotations

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

        self.assertEqual('<span class="cloze">[city]</span> and Ankara', question)
        self.assertEqual('<span class="cloze">Istanbul</span> and Ankara', answer)

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
