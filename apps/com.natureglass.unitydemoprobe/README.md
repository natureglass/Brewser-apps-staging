# Unity Demo Probe

_v1.0.3_

**Unity Demos** is a measurement tool for Brewser, not a game. It loads a curated matrix of **real Unity WebGL debug builds** (spanning Unity 2021 LTS through Unity 6) one at a time and records exactly how far each one gets before it stalls, crashes, or completes.

 Pick a build from the table and press **A** to launch it. The harness watches the whole load and writes a per-run **NDJSON log** to `sdmc:/switch/brewser/logs/unity-demos/` capturing:

 - **Loader & framework output** — every console line the Unity build emits.
- **Uncaught errors** with the top stack frames.
- **Missing-API hits** — flagged as **KNOWN-GAP** (already stubbed) or **NEW-GAP** (undiscovered).
- **Load milestones**, capacity failures, and 5-second heartbeats.
- A running **verdict** — e.g. *COMPLETED*, *WASM-UNAVAILABLE*, *CAPACITY*, *CRASHED*, *STALLED*.

 Each row shows its Unity version, renderer (BiRP or URP), GL level, and whether debug symbols are **full** or **stripped**, plus the most recent verdict badge so you can see at a glance which builds already ran.

 **How it works:** before the Unity loader runs, the harness installs a small, fully-disclosed set of monkey-patches (a WebAssembly-streaming polyfill, a `crossOriginIsolated` getter, and stubs for `SharedArrayBuffer`/`Atomics`/`Worker`). Every patched call still records a gap, so the log never over-claims that a missing browser API was truly filled in. On jitless runtimes such as Citron every build stops at **WASM-UNAVAILABLE** after the loader-stage gaps are harvested; on real Tegra hardware with JIT the full path runs and gives genuine first-frame timings.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
