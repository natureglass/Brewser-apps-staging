# Brewser App Security Scanner

Static **triage** for submitted Brewser app packages. Runs in CI at intake (before
the deploy callback), walks the unpacked package, and emits a single JSON findings
artifact with a verdict: **GOOD**, **SUSPICIOUS**, or **DANGEROUS**.

> **This is a triage layer, not a proof of safety.**
> A **GOOD** verdict means *"no known-bad pattern matched"* — it does **not** mean
> the app is safe or has been cleared. A human still reviews anything that isn't
> clearly clean. Every artifact carries this framing in its `limitations` field,
> and every UI surface that shows a verdict repeats it. Treat GOOD as "nothing
> tripped," never as "approved."

## What it looks for

Brewser apps use **standard Web APIs only** (they also run in Chrome), so the
scanner reasons about ordinary web sinks plus a few Brewser-specific facts:

- The **shared session envelope** at `localStorage['brewser_auth']`. Reading it is
  allowed; **reading it and transmitting it off-device is the single
  highest-severity pattern** (`auth-exfil-dataflow`).
- The manifest's **`allowed_origins[]`** is the exact per-app egress allowlist —
  any absolute `http(s)://` request to an origin not in it is flagged.
- The manifest's flat **`permissions[]`** declares peripheral intent (WebUSB /
  WebSerial / WebHID / WebBluetooth / Web NFC). There are **no** VID/PID fields, so
  peripheral cross-referencing is a family-name heuristic: a peripheral API used
  without a matching permission is SUSPICIOUS, and DANGEROUS if it also egresses.

Full rule catalogue: [`lib/rules.mjs`](lib/rules.mjs). Highlights: dynamic code
construction (`eval`/`Function`/string-`setTimeout`), decode-then-execute chains,
external egress + auth-token dataflow (light intra-function taint), obfuscation
(string-array rotation, computed sink names like `window['fe'+'tch']`,
`.constructor.constructor` escape), time/host/platform/random-gated payloads,
entropy + magic-byte-mismatch on assets, SVG active content, and miner signatures.

### Severity is calibrated for a low false-positive rate

`eval`/`Function` of a non-literal is **SUSPICIOUS**, not DANGEROUS — emscripten,
Unity and Cocos runtimes use them heavily, so a lone hit means "confirm this is the
framework," not "block." `.innerHTML = x` and lone high-entropy strings are
**INFO**. **DANGEROUS** is reserved for genuinely strong signals: decode-then-exec,
auth/storage exfil, constructor-escape, miners, and content masquerading as a
different file type. Combinations escalate (e.g. an auth read **plus** egress in the
same dataflow forces DANGEROUS).

## Usage

```sh
node scan.mjs --package <unpacked-app-dir> --manifest <manifest.json> --out <findings.json>
              [--allowlist <origins.json>] [--max-bytes <n>]
```

- Pure function of the input tree — deterministic and re-runnable.
- **Always exits `0`.** A scan is informational; it must never fail the intake job.
- On any internal error it still writes a valid `findings.json` with
  `verdict: "SUSPICIOUS"` and a `scan-error` finding. **It never degrades to GOOD.**
- No dependency on GitHub-Actions env vars — everything comes via CLI flags, so it
  is independently invocable (e.g. by a future re-scan reconciler that re-runs an
  expanded catalogue against already-published apps).

### Output shape

```jsonc
{
  "verdict": "GOOD | SUSPICIOUS | DANGEROUS",
  "score": 0,                       // numeric, for worst-first sorting
  "scanned_at": "ISO-8601 UTC",
  "scanner_version": "1.0.0",
  "package_hash": "sha256 of the tree",
  "counts": { "info": 0, "suspicious": 0, "dangerous": 0 },
  "rationale": "one-line explanation of the verdict",
  "truncated": false,               // true if findings were capped for size
  "findings": [
    {
      "rule_id": "auth-exfil-dataflow",
      "severity": "DANGEROUS",
      "title": "Auth token transmitted off-device",
      "detail": "…one or two sentences…",
      "file": "assets/main.js",
      "line": 142,
      "evidence": "…truncated to ~120 chars, never a full payload…"
    }
  ],
  "limitations": "Static heuristic scan. GOOD means no known-bad pattern matched, not proof of safety. Human review still required."
}
```

Evidence is always truncated; a full payload is never written to the artifact or the
database.

## How it's wired into CI

Because `submissions.yml` unpacks each app **inline in a bash loop** (one temp dir
per submission), the scanner runs as a plain `node` step inside that loop — like the
Python helpers — not as a `uses:` composite action (which can't run inside a loop).
The workflow reads the verdict, and `scripts/build_callback.py` folds `scan_verdict`
+ `scan_findings` into the **same HMAC-signed callback body** that the WordPress
plugin verifies. All scanner logic lives here in `scanner/`, so the rule catalogue
can iterate without touching the intake workflow.

The scan is informational: it never blocks the deploy or the callback. Blocking is a
human decision made on the WordPress side (a DANGEROUS verdict soft-blocks Publish
with an explicit, audited override).

## Development

```sh
npm ci          # install pinned deps from the committed lockfile
npm test        # run the fixture regression suite (node test.mjs)
```

`fixtures/` holds one package per rule band (clean / auth-exfil / obvious-bad /
obfuscated / undeclared-peripheral); [`fixtures/README.md`](fixtures/README.md) maps
each to the rules it must trip. **Keep the suite green** — it's the regression net.
To add a rule: edit `lib/` + register it in `lib/rules.mjs`, add a fixture and a
`test.mjs` case, and confirm real apps still scan cleanly.

Layout:

```
scan.mjs            entry point (CLI, walker, output contract, exit-0/degrade harness)
lib/walk.mjs        deterministic package walker + tree hash
lib/js-analyze.mjs  AST surface rules + light intra-function taint (the core)
lib/html-analyze.mjs  HTML/SVG active-content extraction → feeds the JS analyzer
lib/css-analyze.mjs   external url()/@import
lib/asset-analyze.mjs entropy + magic-byte + trailing-data (stego) + smuggled base64
lib/manifest.mjs    allowed_origins allowlist + peripheral cross-reference
lib/rules.mjs       the rule catalogue (rule_id → base severity + title)
lib/score.mjs       counts, cross-file escalation, verdict + rationale
lib/{severity,finding,entropy,origins,signatures}.mjs   shared helpers
```
