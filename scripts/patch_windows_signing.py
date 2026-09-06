"""Inject an Authenticode thumbprint into the Tauri release config."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> None:
    thumbprint = os.environ.get("CERT_THUMBPRINT", "").strip()
    if not thumbprint:
        raise SystemExit("CERT_THUMBPRINT is required")

    path = Path("frontend/src-tauri/tauri.release.conf.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    windows = data.setdefault("bundle", {}).setdefault("windows", {})
    windows["certificateThumbprint"] = thumbprint
    windows["digestAlgorithm"] = "sha256"
    windows["timestampUrl"] = "http://timestamp.digicert.com"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Imported certificate {thumbprint}")


if __name__ == "__main__":
    sys.exit(main())
