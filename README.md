# Brewser staging repo

Companion staging repo for the Brewser bundle plugin's Submissions module.
The Brewser WordPress plugin pushes intake submissions here via the Git Data
API; the workflow in this repo deploys each one to `apps/<package-id>/` and
maintains a root `index.json`. The plugin never performs remote git
operations of its own.

## Repo layout

```
.github/workflows/
  submissions.yml       — deploy workflow (triggers on intake/** push)
manifest.schema.json    — JSON Schema for per-app manifest.json (repo-root)
scripts/
  validate_manifest.py  — schema validation
  safe_unzip.py         — path-traversal + symlink + zip-bomb safe unzip
  upsert_index.py       — root index.json upsert
  build_callback.py     — HMAC-signed WP status callback
apps/<package-id>/      — deployed apps (created by the workflow)
intake/<package-id>/    — pending submissions from the plugin (removed by the workflow)
index.json              — root manifest index (created / upserted by the workflow)
index.html              — my.brewser.tech developer portal (served by GitHub Pages)
.nojekyll               — disables Jekyll processing so _-prefixed paths
                          inside app bundles (e.g. Unity WebGL exports) are
                          served verbatim
CNAME                   — custom domain (my.brewser.tech). Managed by
                          GitHub Pages; nothing in the workflow modifies it.
```

The workflow references the helper scripts and the schema at those exact
repo-root paths — do not nest them under `.github/workflows/`.

## index.json schema

Each entry is one submission's public projection:

```json
{
  "id":          "com.<username>.<slug>",
  "name":        "App display name",
  "version":     "1.2.3",
  "owner":       "<sha256 hex of the developer's Google sub>",
  "updated_at":  "2026-07-13T13:32:24Z",
  "entry":       "index.html",
  "logo":        "assets/logo.png",
  "description": "Short description, truncated to 500 chars at write time."
}
```

- `owner` is never the raw Google sub — only its lowercase hex SHA-256. This
  is the same value my.brewser.tech recomputes from the signed-in user's
  `sub` claim to filter the index to that user's submissions.
- `entry`, `logo`, `description` were added in Phase 2 for the portal front
  end so a card can render without a follow-up per-app manifest fetch.
  **Backward compatibility:** old entries missing these fields keep working
  — the portal falls back to `/apps/<id>/manifest.json`. Existing entries
  only update on their app's next submission.
- `description` is truncated to 500 chars at write time (word-boundary if
  possible); consumers that need the full text fetch the per-app manifest.

## GitHub Pages / custom domain

- `my.brewser.tech` is the CNAME target. The `CNAME` file at the repo root
  is managed by GitHub Pages; the deploy workflow deliberately does NOT
  `git add -A` at the repo root (it stages only `apps/<pkg>/` and
  `index.json`), so a locally-deleted `CNAME` cannot be pushed away by the
  workflow.
- `.nojekyll` is present so paths beginning with `_` inside app bundles
  survive to the CDN.
- **Sign-in precondition:** the brewser-auth plugin's **Allowed origins**
  setting on brewser.tech must include `https://my.brewser.tech`, or the
  sign-in popup will refuse with "session expired". This is a one-time
  setup step in **Brewser → Play Auth** on the WordPress admin.
- **Submission page:** the portal's empty state + signed-out view link to
  `https://brewser.tech/submit/`. That page must host the
  `[brewser_submit_app]` shortcode.

## Canonical secret format

`BREWSER_CALLBACK_SECRET` must be **alphanumeric only** — `[A-Za-z0-9]`,
length 16–128. The plugin's admin settings enforce that on the WP side; the
GitHub secret must match byte-for-byte.

Trailing-newline rule (both sides): the workflow's `scripts/build_callback.py`
and the plugin's settings sanitizer strip **exactly one trailing `\r` or `\n`**
from the secret before use. Nothing else — no leading trim, no internal
whitespace collapse. That tolerates the GitHub-secrets-pasted-with-newline
hazard without silently mutating any other bytes.

If a callback fails, first compare the SHA-256 fingerprints logged on each
side:

- Workflow: `[build_callback] secret_fp=… secret_len=… signed_fp=… …`
  (always printed to stderr, visible in the Actions log).
- WordPress: enable **Brewser → Submissions Settings → Callback debug**; the
  next `bad_sig` response body carries `data.debug.secret_fp` /
  `data.debug.signed_fp` / lengths. Turn debug off after diagnosis.

Divergent `secret_fp` → storage or paste drift (the two sides don't hold
the same secret bytes). Same `secret_fp`, divergent `signed_fp` → the
timestamp or body bytes drifted between signing and verification.

## Repo secrets required

Under Settings → Secrets and variables → Actions, add two repository secrets:

| Secret | Value |
|--------|-------|
| `BREWSER_CALLBACK_URL`    | `https://<your-site>/wp-json/brewser/v1/submissions/callback` |
| `BREWSER_CALLBACK_SECRET` | The value from **Brewser → Submissions Settings → Shared secret** |

If either is missing, the workflow still deploys but skips the callback and
logs a warning. Rotate the secret in WordPress and here in lockstep — a
mismatch will silently reject every callback with 401 until they match again.

## PAT scopes for the plugin

The plugin pushes to this repo via the Git Data API using a token you
configure in **Brewser → Submissions Settings → GitHub PAT**. Preferred:
a fine-grained token scoped to this one repo only, with:

- **Contents: Read and Write** (creates blobs + trees + commits, updates the
  `refs/heads/main` ref).
- Nothing else. No metadata, no actions, no PRs.

For rotation ergonomics the plugin also accepts the token via a wp-config
constant:

```php
define('BREWSER_SUB_GITHUB_TOKEN', 'github_pat_...');
```

## Non-fast-forward safety

The plugin's push is a plain fast-forward on `refs/heads/main` with
`force: false`. If two submissions collide, the loser retries the whole
sequence once. If it collides again the submission goes to `push_failed` and
Retry is available in the admin queue. This workflow's `concurrency` group
(`submissions-deploy`, no cancel) similarly ensures at most one deploy is
running at a time — a burst of intake pushes results in one deploy job that
processes ALL pending intake folders sequentially.

## Idempotence and self-healing

The workflow processes every `intake/*/submission.json` present at checkout,
not just the paths in the triggering commit. A submission that landed during
an earlier failed run and left its intake folder behind will be picked up by
the next run automatically. No manual re-triggering needed.

## What the workflow does per submission

1. Reads `intake/<pkg>/submission.json` for `zip_sha256` and `version`.
2. Recomputes `sha256(bundle.zip)` and rejects mismatch.
3. Validates `manifest.json` against `manifest.schema.json`.
4. Unzips into a temp dir with strict safety checks (no traversal, no
   absolute or drive-letter paths, no symlinks).
5. `rm -rf apps/<pkg>/` and moves the fresh unzipped content there. Copies
   `manifest.json` next to it. Latest-wins; no version history in the repo.
6. Upserts an entry into root `index.json` keyed by `id`:
   `{ id, name, version, owner, updated_at }`. Creates the file if missing.
   Sorted by `id` for stable diffs.
7. Deletes the processed `intake/<pkg>/` folder.
8. Commits: `deploy: <pkg-id>@<version>` (one commit per submission).
9. POSTs the HMAC-signed callback to WordPress: `X-Brewser-Signature` header
   = `sha256=<hex(hmac_sha256(ts + '.' + body, secret))>`,
   `X-Brewser-Timestamp` header (must land within ±5 min on the WP side).

After all pending submissions are processed the job pushes once.

## Verifying the install

1. Confirm the layout above is intact (workflow under `.github/workflows/`,
   schema + `scripts/` at the repo root) and commit.
2. Set the two repo secrets listed above.
3. In the plugin admin, configure the staging repo, branch, PAT, and shared
   secret (matching this repo's `BREWSER_CALLBACK_SECRET`).
4. Submit a small test bundle through the shortcode.
5. Watch the intake folder appear on `main`, watch the workflow run, then
   watch the admin's Submissions row flip to `pushed_to_staging` and the
   `apps/<pkg>/` folder land alongside a fresh `index.json` entry.

## What is NOT in this phase

The workflow does not promote to the production repo, does not run smoke
tests on the deployed app, and does not delete stale `apps/…` folders whose
originating submission was later rejected. All three are on the roadmap for
follow-up phases; the plugin's admin queue is the authoritative status for
now.
