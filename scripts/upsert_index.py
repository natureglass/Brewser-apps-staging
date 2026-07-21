#!/usr/bin/env python3
"""Upsert an entry into the root index.json for one deployed submission.

Writes { id, name, version, owner, updated_at, entry, logo, description },
keyed by id. Latest-wins: if an entry with the same id already exists it is
replaced. Output is a JSON array sorted by id so diffs stay small across
deploys.

The `entry`, `logo`, `description` fields are added so my.brewser.tech can
render a card without a follow-up per-app manifest fetch. The page is still
expected to tolerate old entries missing these fields (they only refresh on
the next submission for that package_id) and fall back to the per-app
manifest.

description is truncated to DESCRIPTION_MAX chars at write time so index.json
stays small even when the manifest ships a very long description; consumers
that need the full text fetch /apps/<id>/manifest.json.

Usage: upsert_index.py <manifest.json> <submission.json> <index.json>
Creates <index.json> if it doesn't exist.
"""

DESCRIPTION_MAX = 500
import datetime
import json
import os
import sys


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: upsert_index.py <manifest> <submission> <index>", file=sys.stderr)
        return 2
    manifest_path, submission_path, index_path = argv[1], argv[2], argv[3]

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    with open(submission_path, "r", encoding="utf-8") as f:
        submission = json.load(f)

    index = []
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, list):
                index = loaded
        except json.JSONDecodeError:
            # Corrupt index.json: start fresh rather than crash. The previous
            # entries can be re-derived by re-running deploys anyway.
            index = []

    description = manifest.get("description", "") or ""
    if len(description) > DESCRIPTION_MAX:
        # Preserve word boundaries where possible; otherwise cut at the cap.
        cut = description[:DESCRIPTION_MAX].rstrip()
        # Trim a trailing partial word if the char after the cap is not a
        # space (avoids "beauti…" mid-word if easy to do; otherwise keep it).
        if len(description) > DESCRIPTION_MAX and not description[DESCRIPTION_MAX].isspace():
            last_space = cut.rfind(" ")
            if last_space > DESCRIPTION_MAX * 0.6:
                cut = cut[:last_space]
        description = cut + "…"  # ellipsis

    entry = {
        "id":          manifest["id"],
        "name":        manifest.get("name", ""),
        "version":     manifest.get("version", ""),
        "owner":       submission.get("owner", ""),
        "updated_at":  datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        # Phase 2 addendum for my.brewser.tech. Old entries missing these are
        # tolerated by the reader (falls back to /apps/<id>/manifest.json).
        "entry":       manifest.get("entry", "index.html"),
        "logo":        manifest.get("logo", ""),
        "description": description,
    }
    index = [e for e in index if isinstance(e, dict) and e.get("id") != entry["id"]]
    index.append(entry)
    index.sort(key=lambda e: e.get("id", ""))

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
