#!/usr/bin/env python3
"""Package only deliberate planning artifacts, reproducibly."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    ROOT / "README.md",
    ROOT / "AGENTS.md",
    ROOT / "docs/work-plan.md",
    ROOT / "docs/overview.html",
    *sorted((ROOT / "docs/spec").glob("*.md")),
    *sorted((ROOT / "docs/spec").glob("*.json")),
]
out = ROOT / "artifacts/oracle-top-planning.zip"
manifest_path = ROOT / "artifacts/planning-manifest.json"
out.parent.mkdir(exist_ok=True)
manifest = {
    "schemaVersion": 1,
    "ready": json.loads((ROOT / "docs/spec/readiness.json").read_text())["ready"],
    "files": {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in FILES
    },
}
manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, data in [
        *[(str(p.relative_to(ROOT)), p.read_bytes()) for p in FILES],
        ("planning-manifest.json", manifest_bytes),
    ]:
        info = zipfile.ZipInfo(name, date_time=(2026, 9, 30, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(manifest["files"]) | {"planning-manifest.json"}
    for name, digest in manifest["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest
manifest_path.write_bytes(manifest_bytes)
print(f"PACKAGED {out} ({len(FILES)} source files; ready={manifest['ready']})")
