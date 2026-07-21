# my.brewser.tech — manual test list

Phase 2 developer-portal front-end. Runs entirely on the browser; no CI.
Each case: what to do, what to see. Devtools are your friend. Every case
should PASS on both a normal desktop browser AND, when the shell is ready,
inside the Brewser Switch runtime.

Preconditions before running any of this:

- **Pages served.** `https://my.brewser.tech/` resolves to this repo (CNAME
  configured, DNS propagated, Pages built).
- **Auth origin allowlisted.** In WordPress, **Brewser → Play Auth →
  Allowed origins** contains `https://my.brewser.tech` on its own line.
- **Submission page exists.** `https://brewser.tech/submit/` hosts the
  `[brewser_submit_app]` shortcode (or update `SUBMIT_URL` in `index.html`
  to whatever the operator picked).

## 1. Signed-out view (cold visitor)

Open a private / incognito window (fresh localStorage). Visit
`https://my.brewser.tech/`.

Expect: page loads. Only the "Sign in with Google" card is visible in the
main area. No catalog, no app names, no ownership hash exposed anywhere in
the HTML source. Auth bar (top-right) is empty. Footer visible.

## 2. Sign-in via popup

From the signed-out view, click **Sign in with Google**.

Expect: `500 × 620` popup opens on `brewser.tech`. Complete Google sign-in.
Popup postMessages back and closes. Page re-renders: auth avatar/name in
the top-right, cards for your owned staging apps (if any) below. No page
navigation — everything happens in place.

Devtools check: `localStorage.getItem('brewser_auth')` returns a JSON string
with the expected `{token, user:{sub,name,email,picture,exp}}` shape.

## 3. Switch-bridge simulation (pre-seeded localStorage)

In devtools (with the tab closed), set:

```js
localStorage.setItem('brewser_auth', JSON.stringify({
  token: 'FAKE.TOKEN.PARTS',
  user: {
    sub: '104834891248918273467',       // some real Google sub of yours
    name: 'Alex Daskalakis',
    email: 'alex@example.com',
    picture: '',
    exp: Math.floor(Date.now()/1000) + 3600
  }
}));
```

Reload `my.brewser.tech`.

Expect: no popup interaction. Cards render immediately based on the seeded
session. This is the Switch-runtime code path (the runtime pre-seeds the
key at page boot from its own device-code session).

## 4. Owner filter — positive

Sign in as User A (has apps `com.<user_a>.foo`, `com.<user_a>.bar`).

Expect: exactly those cards appear. No card for any app owned by a different
Google account.

Devtools sanity check: computed owner fingerprint from your `sub` matches
the `owner` field of your app entries in `/index.json`. To eyeball, in the
console:

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.parse(localStorage.brewser_auth).user.sub))
  .then(b => console.log([...new Uint8Array(b)].map(n => n.toString(16).padStart(2,'0')).join('')));
```

## 5. Owner filter — negative

Sign out. Sign in as a different Google account with no submitted apps (or
with different apps).

Expect: the first user's cards are gone. Either the second user's own apps
appear or, if none, the "No staging apps yet" empty state renders with a
link to the submission page. **Never** shows the previous user's apps.

## 6. Expired token → silent cleanup

Devtools: set `brewser_auth` with `user.exp` set to a past timestamp, e.g.:

```js
var s = JSON.parse(localStorage.brewser_auth); s.user.exp = 1000; localStorage.brewser_auth = JSON.stringify(s);
```

Reload.

Expect: signed-out view renders. `localStorage.getItem('brewser_auth')`
returns `null`. **No error banner** — expired sessions are handled silently.

## 7. Malformed envelope → silent cleanup

Devtools: `localStorage.brewser_auth = 'not-json'` and reload.
Then: `localStorage.brewser_auth = '{"token":"x"}'` (missing `user`), reload.

Expect: signed-out view both times. The key is removed on read. No error
banner.

## 8. Launch opens the deployed app

Signed in, click any card.

Expect: opens `/apps/<package-id>/<entry>` in a new tab and the app loads.
For an existing sample: `/apps/com.natureglass.serpent/index.html`.

## 9. Cache-bust freshness

Submit a new app through the WP shortcode; wait for the workflow's deploy
commit to land (single `deploy: <pkg>@<ver>` commit). Refresh
`my.brewser.tech` without clearing the browser cache.

Expect: the new card appears within seconds. If it doesn't, check Devtools
Network — the `/index.json?ts=<epoch>` request must return the freshest
copy (not `304 Not Modified` from an intermediate CDN). The `?ts=` bust
plus the `cache: 'no-store'` fetch mode should force it every time.

## 10. Missing-fields fallback (pre-Phase 2 index entries)

The current `index.json` at the time of writing has entries lacking
`entry`, `logo`, and `description` (they were written before this phase's
`upsert_index.py` change).

Load the page. Expect: cards still render. Under the hood the portal
issued a `/apps/<pkg>/manifest.json` fetch per card and populated logo +
description from there.

Simulate a full failure (block that manifest URL in Devtools Network,
"Offline" or a block rule).

Expect: card still visible with the pill "syncing…" chip, package id +
version + a fallback logo tile. Launch button still points at
`/apps/<pkg>/index.html` (best-guess default).

Once the workflow has redeployed those apps once more (with the new
upsert_index.py), the index entries will include `entry`/`logo`/`description`
and no per-app manifest fetch is needed.

## 11. Flat-fill visual constraint

DevTools → Elements → any card → Computed pane. Search for:

- `background-image` → must be `none` on every element.
- `box-shadow` → must be `none` everywhere.
- `filter` and `backdrop-filter` → must be `none` everywhere.
- Focus rings use `outline`, not shadow.

Tab through the page with keyboard only (no mouse). Every interactive
element (sign-in button, avatar, cards, empty-state link, retry button)
gets a visible cyan outline on focus and responds to Enter.

## 12. Popup blocked

Set the browser to block popups site-wide, then click Sign in.

Expect: an error strip "Popup was blocked — allow popups for this site
and try again." Retry button reloads and reruns the boot sequence.

## 13. Google avatar image blocked

Devtools Network → block `*.googleusercontent.com`. Reload signed-in.

Expect: auth avatar renders the initial-letter tile (first letter of name
or email) instead of a broken image. No layout shift. Amendment 2 verified.

## 14. WebCrypto absent (fallback path)

Devtools console:

```js
Object.defineProperty(crypto, 'subtle', { value: undefined });
```

Reload signed-in.

Expect: cards render normally. The pure-JS SHA-256 fallback ran; no
console error. This simulates the Brewser Switch runtime path where
`crypto.subtle` may be absent.

Optional smoke: paste the vector `console.log(sha256Hex('abc'))` (calling
the local `sha256Hex` from devtools if you expose it) should print
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. (You'd
need to temporarily surface the closure for that — this is diagnostic only.)

## 15. CNAME + .nojekyll didn't get squashed by a deploy

After any workflow-driven deploy, check:

- `git log -- CNAME` shows only GitHub's initial commit — the workflow has
  never modified it. The workflow's `git add -A "$target" "index.json"`
  scopes staging to per-app + the index only; nothing else at the repo
  root is touched.
- `.nojekyll` is still present at the repo root.
- Loading a URL with an underscore path inside a deployed app (e.g.
  `/apps/<pkg>/_framework/foo.js` for a hypothetical Unity export) returns
  `200` and the file bytes — not a `404` from Jekyll silently dropping it.

## 16. Sign-out

Click the auth avatar.

Expect: `localStorage.brewser_auth` is removed; page re-renders to the
signed-out view; auth bar clears.
