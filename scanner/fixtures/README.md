# Scanner fixtures

Each subdirectory is a minimal app package (a `manifest.json` plus source) that
exercises a specific band of the rule catalogue. `../test.mjs` runs the real
`scan.mjs` CLI against every fixture and asserts the verdict + that the expected
`rule_id`s fire. Keep this suite green — it is the regression net.

| Fixture | Expected verdict | Rules it must trip | What it proves |
|---|---|---|---|
| `clean/` | **GOOD** | (none) | A normal app — own-namespace storage, a fetch to a manifest-declared `allowed_origins` entry, canvas/WebGL2 — produces no findings. Guards against false positives. |
| `auth-exfil/` | **DANGEROUS** | `auth-exfil-dataflow`, `auth-token-read` | Reads `localStorage['brewser_auth']` and ships it to an off-package origin *through a function boundary* — exercises both the intra-function taint and the file-level read+egress escalation. |
| `obvious-bad/` | **DANGEROUS** | `decode-exec`, `external-egress`, `settimeout-string` | `eval(atob(...))` / `new Function(atob(...))` decode-then-execute, an inline `onclick` handler, and a plain external `fetch`. Tests HTML inline-script + handler extraction feeding the JS analyzer. |
| `obfuscated/` | **DANGEROUS** | `constructor-escape`, `string-array-obfuscation`, `computed-sink-name`, `charcode-reconstruction` | obfuscator.io-style hex string array, `window['fe'+'tch']` / `self['ev'+'al']` computed sink names, the `[].constructor.constructor` eval-escape, and `String.fromCharCode` reconstruction. |
| `undeclared-peripheral/` | **SUSPICIOUS** | `peripheral-undeclared` | Calls `navigator.usb.requestDevice()` with no matching manifest permission and **no** egress — must stay SUSPICIOUS, not escalate to DANGEROUS. Proves the manifest cross-reference and that undeclared-without-egress does not over-escalate. |

## Adding a fixture

1. Create `fixtures/<name>/` with a `manifest.json` and the source that trips
   the rule. Use only standard Web APIs (never custom `brewser.*`).
2. Add a row to the table above and an entry to the `CASES` array in
   `../test.mjs` (expected verdict + required rule ids + any rule ids that must
   NOT appear).
3. Run `npm test` from `scanner/`.
