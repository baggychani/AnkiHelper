from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from anki_helper.anki_package import (
    Field,
    create_package_from_table,
    move_notes_between_types,
    read_apkg,
    remap_note_rows,
    remove_note_type,
    save_apkg,
    save_as_note_type,
)


class NoteTypeMoveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.package = create_package_from_table(
            ["Front", "Back"],
            [["hello", "world"], ["one", "two"]],
            deck_name="Move test",
            note_type_name="Basic",
            front_field=0,
            back_field=1,
        )

    def tearDown(self) -> None:
        for staged_path in self.package.pending_media.values():
            staged_path.unlink(missing_ok=True)
        self.package.source.unlink(missing_ok=True)
        self.temporary.cleanup()

    def _empty_clone(self, name: str = "Cloze-like"):
        source = self.package.note_types[0]
        destination = save_as_note_type(self.package, source, name, move_cards=False)
        destination.notes = []
        self.package.note_ids[destination.id] = []
        return source, destination

    def test_remap_note_rows_matches_by_name_then_order(self) -> None:
        source = self.package.note_types[0]
        destination = save_as_note_type(self.package, source, "Renamed", move_cards=False)
        destination.fields = [Field("Back", 0), Field("Front", 1), Field("Extra", 2)]
        remapped = remap_note_rows(source, destination, [["q", "a"]])
        self.assertEqual([["a", "q", ""]], remapped)

    def test_remap_note_rows_honors_explicit_mapping(self) -> None:
        source = self.package.note_types[0]
        destination = save_as_note_type(self.package, source, "Mapped", move_cards=False)
        remapped = remap_note_rows(source, destination, [["left", "right"]], mapping={0: 1, 1: 0})
        self.assertEqual([["right", "left"]], remapped)

    def test_move_notes_between_types_transfers_rows_and_ids(self) -> None:
        source, destination = self._empty_clone()
        source_ids = list(self.package.note_ids[source.id])
        self.assertEqual(2, len(source.notes))
        self.assertEqual(2, len(source_ids))

        moved = move_notes_between_types(self.package, source, destination, {0: 0, 1: 1})
        self.assertEqual(2, moved)
        self.assertEqual([], source.notes)
        self.assertEqual([], self.package.note_ids[source.id])
        self.assertEqual([["hello", "world"], ["one", "two"]], destination.notes)
        self.assertEqual(source_ids, self.package.note_ids[destination.id])

    def test_move_notes_with_crossed_field_mapping(self) -> None:
        source, destination = self._empty_clone("Swapped")
        moved = move_notes_between_types(self.package, source, destination, {0: 1, 1: 0})
        self.assertEqual(2, moved)
        self.assertEqual([["world", "hello"], ["two", "one"]], destination.notes)

    def test_move_notes_rejects_same_type_and_noops_when_empty(self) -> None:
        source = self.package.note_types[0]
        with self.assertRaises(ValueError):
            move_notes_between_types(self.package, source, source)
        destination = save_as_note_type(self.package, source, "Empty target", move_cards=True)
        self.assertEqual([], source.notes)
        self.assertEqual(0, move_notes_between_types(self.package, source, destination))

    def test_empty_source_can_be_removed_after_move_and_survives_save(self) -> None:
        source, destination = self._empty_clone("Keep")
        move_notes_between_types(self.package, source, destination, {0: 0, 1: 1})
        remove_note_type(self.package, source.id)
        self.assertEqual(["Keep"], [item.name for item in self.package.note_types])

        saved = self.root / "moved.apkg"
        save_apkg(self.package, saved, backup=False)
        reopened = read_apkg(saved)
        self.assertEqual(1, len(reopened.note_types))
        self.assertEqual("Keep", reopened.note_types[0].name)
        self.assertEqual([["hello", "world"], ["one", "two"]], reopened.note_types[0].notes)
        self.assertEqual(2, len(reopened.note_ids[reopened.note_types[0].id]))


if __name__ == "__main__":
    unittest.main()
