"""Emit real backend preview HTML for the Playwright browser tests."""

import json
import tempfile
from pathlib import Path

from anki_helper.anki_package import DeckPackage
from anki_helper import backend


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        badge = root / "badge.svg"
        badge.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>')
        theme = root / "theme.css"
        theme.write_text('.linked { background-image: url("badge.svg"); }')
        package = DeckPackage(
            source=root / "fixture.apkg", note_types=[], media={"0": "badge.svg", "1": "theme.css"},
            archive_entries=set(), database_name="collection.anki2", note_ids={},
            pending_media={"0": badge, "1": theme},
        )
        # Joining pieces prevents the Python string rewriter from doing the
        # runtime resolver's work. These assignments execute as card scripts.
        front = '''<div id="side">front</div><script>(() => {
          const filename = ["badge", "svg"].join(".");
          const img = new Image(); img.id = "dynamic"; img.src = filename;
          document.getElementById("qa").appendChild(img);
          sessionStorage.setItem("front", "remembered");
          localStorage.setItem("local", "retained");
          fetch(filename).then(r => r.text()).then(text => {
            document.getElementById("side").dataset.fetched = String(text.includes("<svg"));
          });
        })();</script>'''
        back = '''<div id="side">back</div><script>(() => {
          document.getElementById("side").dataset.session = sessionStorage.getItem("front");
          document.getElementById("side").dataset.local = localStorage.getItem("local");
          const img = new Image(); img.id = "dynamic"; img.src = ["badge", "svg"].join(".");
          document.getElementById("qa").appendChild(img);
        })();</script>'''
        base = f"http://127.0.0.1:8765/api/preview-media/{backend.app.state.workspace.preview_token}/"
        print(json.dumps({
            "front": backend._embed_preview_media(front, package=package),
            "back": backend._embed_preview_media(back, package=package),
            "assetUrl": base + "0",
            "svg": badge.read_text(),
        }))


if __name__ == "__main__":
    main()
