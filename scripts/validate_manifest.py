#!/usr/bin/env python3
"""Validate a manifest.json file against manifest.schema.json.

Usage: validate_manifest.py <manifest.json> <schema.json>
Prints nothing on success, prints the error and exits nonzero on failure.
"""
import json
import sys

from jsonschema import Draft7Validator


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: validate_manifest.py <manifest> <schema>", file=sys.stderr)
        return 2
    manifest_path, schema_path = argv[1], argv[2]
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    v = Draft7Validator(schema)
    errors = sorted(v.iter_errors(manifest), key=lambda e: list(e.absolute_path))
    if not errors:
        return 0
    for e in errors:
        path = "/".join(str(p) for p in e.absolute_path) or "(root)"
        print(f"{path}: {e.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
