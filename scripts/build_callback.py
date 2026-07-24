#!/usr/bin/env python3
"""Build the HMAC-signed status callback for one submission.

Writes three files inside the directory given by --out-dir:
  body   : the exact JSON body to send
  ts     : the unix timestamp header value
  sig    : the X-Brewser-Signature header value (sha256=<hex>)

Reads the shared secret from stdin (never as a CLI arg — arg lists are visible
in `ps` even on GitHub-hosted runners).

Usage:
  build_callback.py --out-dir DIR [--scan-verdict V] [--scan-findings-file F] \
                    <package_id> <version> <zip_sha256> \
                    <ok|error> [deploy_sha] [error_msg]

The signature covers `<ts>.<body>`, matching what Brewser_Sub_Rest::route_callback
verifies with hash_equals on the WordPress side.

The optional security-scan fields (`scan_verdict`, `scan_findings_b64`) are
folded into the SAME signed body, not sent as unsigned side-channel headers —
the WP side verifies the raw body bytes, so anything it later reads must be
inside the signature.

`scan_findings_b64` is the findings JSON **base64-encoded**, NOT the raw object.
This is deliberate: the findings' `evidence` snippets are literal malicious code
(`eval(atob(...))`, `fetch('https://…')`, `localStorage['brewser_auth']`), and
sending them raw makes the callback POST body itself look like an attack — a
host WAF / upload-AV (mod_security, Imunify360) will 403 the callback, so the
verdict never lands and the row stays stuck at `submitted`. Base64 keeps those
patterns out of the request bytes while the HMAC still covers everything. Both
scan fields default to empty so error-result callbacks (no scan ran) keep the
historic shape plus inert keys, which route_callback reads only via isset().

Canonical trailing-newline rule: BOTH sides strip exactly one trailing \\r\\n
or \\n from the secret before hashing. Nothing else — no leading trim, no
internal whitespace collapse, no other whitespace classes. That tolerates the
common GitHub-secret-pasted-with-newline hazard without touching anything
else in the byte stream.

Diagnostics: always prints SHA-256 fingerprints of the secret and the signed
string to stderr (visible in the Actions log). Never prints the secret or
signed string themselves. Compare against the WP-side fingerprints surfaced
by the "Callback debug" toggle in the plugin settings to isolate which side
of the wire diverged.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", required=True)
    p.add_argument("--scan-verdict", default="")
    p.add_argument("--scan-findings-file", default="")
    p.add_argument("package_id")
    p.add_argument("version")
    p.add_argument("zip_sha256")
    p.add_argument("result", choices=["ok", "error"])
    p.add_argument("deploy_sha", nargs="?", default="")
    p.add_argument("error_msg", nargs="?", default="")
    args = p.parse_args(argv[1:])

    # Load the scan findings object (if any). A missing/unreadable/oversize file
    # is treated as "no findings" — the verdict string still rides in the body,
    # and the scanner already fail-safes to SUSPICIOUS on its own errors, so we
    # never fabricate a GOOD here.
    scan_findings = None
    if args.scan_findings_file:
        try:
            with open(args.scan_findings_file, "r", encoding="utf-8") as f:
                scan_findings = json.load(f)
        except Exception as e:  # noqa: BLE001 — any read/parse failure is non-fatal
            print("[build_callback] scan-findings unreadable: {}".format(e), file=sys.stderr)
            scan_findings = None

    # Canonical: strip ONLY trailing CR / LF. Do not use .strip() — that also
    # strips leading whitespace and other whitespace classes, which would
    # drift from the WP-side rule (WP trims neither internal whitespace nor
    # anything but trailing \r\n).
    raw = sys.stdin.read()
    secret = raw.rstrip("\r\n")
    if not secret:
        print("no secret on stdin", file=sys.stderr)
        return 2

    # Base64 the findings so raw malicious-looking evidence never appears in the
    # request body (see the module docstring — otherwise a host WAF/AV 403s the
    # callback and the verdict never lands).
    scan_findings_b64 = ""
    if scan_findings is not None:
        compact = json.dumps(scan_findings, separators=(",", ":"), sort_keys=True)
        scan_findings_b64 = base64.b64encode(compact.encode("utf-8")).decode("ascii")

    body = json.dumps({
        "package_id":        args.package_id,
        "version":           args.version,
        "zip_sha256":        args.zip_sha256,
        "result":            args.result,
        "error":             args.error_msg,
        "deploy_commit_sha": args.deploy_sha,
        "scan_verdict":      args.scan_verdict,
        "scan_findings_b64": scan_findings_b64,
    }, separators=(",", ":"), sort_keys=True)

    ts           = str(int(time.time()))
    signed_input = ts + "." + body
    sig          = "sha256=" + hmac.new(secret.encode(), signed_input.encode(), hashlib.sha256).hexdigest()

    # Fingerprints — safe to log. Never emit the secret or signed_input.
    secret_fp = hashlib.sha256(secret.encode()).hexdigest()
    signed_fp = hashlib.sha256(signed_input.encode()).hexdigest()
    print(
        "[build_callback] secret_fp={sfp} secret_len={sl}"
        " signed_fp={ifp} signed_len={il} ts={ts}".format(
            sfp=secret_fp, sl=len(secret), ifp=signed_fp, il=len(signed_input), ts=ts
        ),
        file=sys.stderr,
    )

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "body"), "w", encoding="utf-8") as f:
        f.write(body)
    with open(os.path.join(args.out_dir, "ts"), "w", encoding="utf-8") as f:
        f.write(ts)
    with open(os.path.join(args.out_dir, "sig"), "w", encoding="utf-8") as f:
        f.write(sig)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
