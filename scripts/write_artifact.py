#!/usr/bin/env python3
"""Write artifacts/<id>.json for a freshly-deployed staging app.

This is the per-app file inventory the Brewser runtime's download flow fetches
(my.brewser.tech/artifacts/<id>.json) to learn which files to install. Without
it a STAGED app can be listed in a developer's "My Apps" but never installed on
the console — the installer has no manifest of files to pull.

The output shape matches the production brewser-apps artifacts exactly (produced
there by scripts/build_catalog.py) and the runtime's parseArtifacts contract:

    { "id": "<package-id>", "sizeBytes": <int>, "files": [ "<sorted rel path>", ... ] }

so a staged app installs identically to a published one.

Usage:
    python write_artifact.py <package_id> [apps_dir=apps] [artifacts_dir=artifacts]

Scans apps/<package_id>/ recursively, skipping hidden files/dirs (any path
component starting with '.'), and writes artifacts/<package_id>.json with sorted
relative paths + the total uncompressed size. Exit 0 on success; non-zero (with a
message on stderr) when the app dir is missing or empty — the deploy step treats
that as a warning, never a hard failure.
"""
import json
import sys
from pathlib import Path


def scan_files(app_dir):
    """Return (sorted relative paths, total size in bytes) for all non-hidden
    files under app_dir. Mirrors brewser-apps/scripts/build_catalog.py."""
    files = []
    total = 0
    for p in app_dir.rglob("*"):
        rel = p.relative_to(app_dir)
        # Skip anything hidden at any depth (.git, .DS_Store, dotfiles).
        if any(part.startswith(".") for part in rel.parts):
            continue
        if not p.is_file():
            continue
        files.append("/".join(rel.parts))
        total += p.stat().st_size
    files.sort()
    return files, total


def main(argv):
    if len(argv) < 2 or not argv[1]:
        print("usage: write_artifact.py <package_id> [apps_dir] [artifacts_dir]", file=sys.stderr)
        return 2
    pkg = argv[1]
    apps_dir = Path(argv[2]) if len(argv) > 2 else Path("apps")
    artifacts_dir = Path(argv[3]) if len(argv) > 3 else Path("artifacts")

    app_dir = apps_dir / pkg
    if not app_dir.is_dir():
        print(f"write_artifact: {app_dir} not found", file=sys.stderr)
        return 1

    files, size_bytes = scan_files(app_dir)
    if not files:
        print(f"write_artifact: {app_dir} has no files to inventory", file=sys.stderr)
        return 1

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    payload = {"id": pkg, "sizeBytes": size_bytes, "files": files}
    out = artifacts_dir / f"{pkg}.json"
    with out.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"write_artifact: wrote {out} ({len(files)} files, {size_bytes} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
