# Brewser Apps — Staging

The **staging area** for [Brewser](https://brewser.io) apps — the place where apps sit and get tested *before* they go public.

When someone submits an app through [brewser.io](https://brewser.io), it lands here first. It isn't listed in the public catalogue yet — instead, it becomes available to **signed-in users inside Brewser Runtime**, so it can be tried out on a real Nintendo Switch before publishing.

---

## What lives here

Apps in staging are essentially previews. They're finished enough to test, but haven't been published to the public catalogue. Keeping them here means:

- Developers can run their app on actual hardware and confirm it behaves the way they expect.
- Nothing reaches the public catalogue until it has been scanned, checked, and approved.

Every submission passes **automated security scanning** — static analysis and taint tracking — before it can be approved. The scanner and its verdicts live right here in this repo ([`scanner/`](scanner/), [`scans/`](scans/)), so the review process happens out in the open. Submissions are validated against [`manifest.schema.json`](manifest.schema.json).

To see staging apps in Brewser Runtime, just **sign in** with your account. Regular visitors only see published apps. Every staging app is also reachable through a **direct link** — `my.brewser.io/<app>/`, shown in your publisher dashboard — handy for trying a build in the browser or sharing it with testers before it goes public.

> Note that staging is **unlisted, not private**: app files are public in this repository; they're simply not exposed in the brewser.io catalogue until approved.

This repo is also served via GitHub Pages at **my.brewser.io**, which hosts the runtime's update-check snapshot (`versions.json`).

---

## Where apps go next

Once an app has been tested and approved, it moves out of staging and into the **[published catalogue](https://github.com/natureglass/Brewser-apps)** — from that point on, anyone can find and run it.

---

## Publishing your own app

Submitting and managing apps happens on the **[brewser.io](https://brewser.io/submit/)** website. Sign in, submit, test your app here in staging, and publish when you're happy with it.

---

## Documentation

Technical details about submissions, testing, and how apps are built live at:

**[docs.brewser.io](https://docs.brewser.io/)**

---

## Related repositories

| Repository | Purpose |
|---|---|
| [Brewser](https://github.com/natureglass/Brewser) | The runtime — the shell you launch on your Switch |
| [Brewser-apps](https://github.com/natureglass/Brewser-apps) | The published app catalogue — where approved apps land |
| [Brewser-press](https://github.com/natureglass/Brewser-press) | Press kit — logos, screenshots, GIFs, showreel, factsheet |

---

## Disclaimer

Brewser is an independent homebrew project and is not affiliated with, endorsed by, sponsored by, licensed by, or approved by Nintendo. Nintendo Switch is a trademark of Nintendo Co., Ltd.

Brewser does not include, distribute, or provide Nintendo software, firmware, games, ROMs, encryption keys, copyrighted assets, exploits, or tools/instructions for bypassing technological protection measures. Users and contributors are responsible for complying with applicable laws and third-party terms.