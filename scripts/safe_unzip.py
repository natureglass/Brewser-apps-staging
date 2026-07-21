#!/usr/bin/env python3
"""Unzip a bundle into a target directory, rejecting anything unsafe.

Rejected: absolute paths, drive-letter paths, paths with '..' segments,
backslashes in member names, NUL bytes, symlinks (any entry whose
external_attr high bits encode S_IFLNK, regardless of the create_system
byte — some zip tools set non-UNIX opsys but still emit the mode bits),
zip bombs (aggregate uncompressed size cap and entry count cap).

Usage: safe_unzip.py <bundle.zip> <target-dir>
Exits nonzero with an error message on the first policy violation, so the
workflow surfaces exactly which entry failed.
"""
import os
import stat
import sys
import zipfile

# Zip-bomb caps. Compressed cap is enforced by the plugin (default 25 MB);
# the uncompressed side is what would exhaust the runner's disk, so gate it
# independently. 200 MB / 5000 entries is generous for any legit brewser app
# (the largest current shipping bundle is ~40 MB uncompressed).
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_ENTRIES            = 5000


def is_symlink(info: zipfile.ZipInfo) -> bool:
    # Upper 16 bits of external_attr carry the Unix file mode. Check the
    # mode bits regardless of create_system: some Windows or unknown-opsys
    # zip tools still preserve UNIX mode bits when round-tripping through a
    # UNIX filesystem, and false positives here are safer than allowing a
    # symlink through on a technicality.
    return stat.S_ISLNK((info.external_attr >> 16) & 0xFFFF)


def check_name(name: str) -> str | None:
    if not name:
        return "empty entry name"
    if "\x00" in name:
        return "NUL byte in entry name"
    if "\\" in name:
        return "backslash in entry name (Windows path)"
    if name.startswith("/"):
        return "absolute path"
    if len(name) >= 2 and name[1] == ":":
        return "drive-letter path"
    for seg in name.split("/"):
        if seg == "..":
            return "traversal '..' segment"
    return None


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: safe_unzip.py <bundle.zip> <target-dir>", file=sys.stderr)
        return 2
    zip_path, target = argv[1], argv[2]

    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()

        # Cheap up-front caps — no reason to touch disk for something that
        # already blew the entry budget.
        if len(infos) > MAX_ENTRIES:
            print(f"zip has {len(infos)} entries; cap is {MAX_ENTRIES}", file=sys.stderr)
            return 1
        declared_total = sum(max(0, info.file_size) for info in infos)
        if declared_total > MAX_UNCOMPRESSED_BYTES:
            print(f"declared uncompressed size {declared_total} exceeds cap {MAX_UNCOMPRESSED_BYTES}", file=sys.stderr)
            return 1

        # First pass: inspect every entry BEFORE extracting anything.
        for info in infos:
            problem = check_name(info.filename)
            if problem:
                print(f"{info.filename}: {problem}", file=sys.stderr)
                return 1
            if is_symlink(info):
                print(f"{info.filename}: symbolic link entry rejected", file=sys.stderr)
                return 1

        # Second pass: extract, tracking actual bytes written (which may
        # exceed the header-declared file_size if the zip is dishonest).
        target_abs = os.path.abspath(target)
        written = 0
        for info in infos:
            dest = os.path.abspath(os.path.join(target_abs, info.filename))
            if not (dest == target_abs or dest.startswith(target_abs + os.sep)):
                print(f"{info.filename}: extract path escapes target", file=sys.stderr)
                return 1
            if info.is_dir():
                os.makedirs(dest, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as out:
                    while True:
                        chunk = src.read(1 << 16)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > MAX_UNCOMPRESSED_BYTES:
                            print(f"{info.filename}: uncompressed content exceeds cap {MAX_UNCOMPRESSED_BYTES}", file=sys.stderr)
                            return 1
                        out.write(chunk)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
