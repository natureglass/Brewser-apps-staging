#!/usr/bin/env node
// Brewser app package scanner — static triage.
//
//   node scan.mjs --package <dir> --manifest <manifest.json> --out <findings.json>
//                 [--allowlist <origins.json>] [--max-bytes <n>]
//
// Design contract:
//  * Pure function of the input tree (deterministic, re-runnable).
//  * ALWAYS exits 0 — a scan is informational; the intake job must never fail
//    on a verdict. The WP admin is where a human decides to block.
//  * On ANY internal error it still writes a VALID findings.json with
//    verdict:"SUSPICIOUS" and a scan-error finding. It NEVER degrades to GOOD.
//  * No dependency on GitHub-Actions env vars — everything comes via CLI flags,
//    so the future re-scan reconciler can invoke it standalone.
//
// A GOOD verdict means "no known-bad pattern matched", NOT "cleared". That
// framing rides in the `limitations` string on every artifact.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { walkPackage, KIND } from './lib/walk.mjs';
import { loadManifestContext, manifestNotes } from './lib/manifest.mjs';
import { analyzeJs } from './lib/js-analyze.mjs';
import { analyzeHtml } from './lib/html-analyze.mjs';
import { analyzeCss } from './lib/css-analyze.mjs';
import { analyzeAsset, analyzeJsonAsset } from './lib/asset-analyze.mjs';
import { makeFinding } from './lib/finding.mjs';
import { INFO, SUSPICIOUS } from './lib/severity.mjs';
import { scoreFindings, rationaleFor, sortFindings } from './lib/score.mjs';
import { TYPOSQUAT_CDN } from './lib/signatures.mjs';

export const SCANNER_VERSION = '1.2.0';

const LIMITATIONS =
  'Static heuristic scan. A GOOD verdict means no known-bad pattern matched, ' +
  'NOT proof of safety. Human review is still required for every submission.';

const DEFAULT_MAX_BYTES = 512 * 1024;

function parseArgs(argv) {
  const args = { package: null, manifest: null, out: null, allowlist: null, maxBytes: DEFAULT_MAX_BYTES };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') args.package = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--allowlist') args.allowlist = argv[++i];
    else if (a === '--max-bytes') args.maxBytes = parseInt(argv[++i], 10) || DEFAULT_MAX_BYTES;
  }
  return args;
}

// The one timestamp in the artifact. Kept out of the hashed content so the
// package hash stays deterministic; the artifact itself is not hash-stable
// (scanned_at varies) which is fine — re-runs still produce the same findings.
function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function buildArtifact({ verdict, score, counts, rationale, findings, packageHash, truncated, capabilities }) {
  return {
    verdict,
    score,
    scanned_at: nowIso(),
    scanner_version: SCANNER_VERSION,
    package_hash: packageHash || '',
    counts,
    rationale,
    truncated: !!truncated,
    findings,
    // Non-security Web-API capabilities detected in the bundle (Phase 2b): a small
    // slug list (webgl/webaudio/webrtc/nfc/sensors) the WP achievements evaluator
    // reads. Never truncated (tiny); independent of the verdict.
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    limitations: LIMITATIONS,
  };
}

async function runScan(args) {
  const findings = [];
  const peripheralsUsed = new Set();
  // Non-security Web-API capabilities (webgl/webaudio/webrtc/nfc/sensors) for the
  // WP achievements evaluator (Phase 2b). Emitted in the artifact; does not affect
  // the verdict.
  const capabilitiesUsed = new Set();

  // Manifest context (allowlist + declared peripherals + self namespace).
  let manifestText = '{}';
  try {
    manifestText = await fs.readFile(args.manifest, 'utf8');
  } catch {
    findings.push(makeFinding({ rule_id: 'file-parse-error', severity: SUSPICIOUS,
      file: 'manifest.json', line: 0,
      detail: 'manifest.json could not be read at ' + args.manifest + ' — scanning with no allowlist (every external origin will flag).',
      evidence: '' }));
  }
  const ctx = loadManifestContext(manifestText, null);
  if (ctx.parseError) {
    findings.push(makeFinding({ rule_id: 'file-parse-error', severity: SUSPICIOUS,
      file: 'manifest.json', line: 0, detail: 'manifest.json is not valid JSON: ' + ctx.parseError, evidence: '' }));
  }

  // Optional allowlist override merged in.
  if (args.allowlist) {
    try {
      const extra = JSON.parse(await fs.readFile(args.allowlist, 'utf8'));
      const { buildAllowlist } = await import('./lib/origins.mjs');
      for (const o of buildAllowlist(Array.isArray(extra) ? extra : (extra.allowed_origins || []))) ctx.allowlist.add(o);
    } catch { /* ignore a bad override; the manifest allowlist still applies */ }
  }

  const { files, packageHash } = await walkPackage(args.package);

  for (const f of files) {
    // Path-based supply-chain signals.
    if (/(^|\/)node_modules\//.test(f.rel)) {
      findings.push(makeFinding({ rule_id: 'bundled-node-modules', severity: INFO, file: f.rel, line: 0,
        detail: 'Bundled node_modules / vendored dependency shipped in the package.', evidence: f.rel }));
    }
    const base = path.basename(f.rel).toLowerCase();
    for (const bad of TYPOSQUAT_CDN) {
      if (base.includes(bad)) {
        findings.push(makeFinding({ rule_id: 'typosquat-cdn', severity: SUSPICIOUS, file: f.rel, line: 0,
          detail: 'Filename resembles a known typosquat / suspicious dependency name ("' + bad + '").', evidence: f.rel }));
        break;
      }
    }

    try {
      if (f.kind === KIND.JS && f.isText) {
        const r = analyzeJs(f.text, f.rel, ctx);
        r.findings.forEach((x) => findings.push(x));
        r.peripheralsUsed.forEach((p) => peripheralsUsed.add(p));
        r.capabilitiesUsed.forEach((c) => capabilitiesUsed.add(c));
      } else if (f.kind === KIND.HTML && f.isText) {
        const r = analyzeHtml(f.text, f.rel, ctx, false);
        r.findings.forEach((x) => findings.push(x));
        r.peripheralsUsed.forEach((p) => peripheralsUsed.add(p));
        r.capabilitiesUsed.forEach((c) => capabilitiesUsed.add(c));
      } else if (f.kind === KIND.SVG && f.isText) {
        const r = analyzeHtml(f.text, f.rel, ctx, true);
        r.findings.forEach((x) => findings.push(x));
        r.peripheralsUsed.forEach((p) => peripheralsUsed.add(p));
        r.capabilitiesUsed.forEach((c) => capabilitiesUsed.add(c));
      } else if (f.kind === KIND.CSS && f.isText) {
        analyzeCss(f.text, f.rel, ctx).findings.forEach((x) => findings.push(x));
      } else if (f.kind === KIND.JSON) {
        // manifest.json is analyzed via ctx, not as an asset blob.
        if (path.basename(f.rel).toLowerCase() !== 'manifest.json' && f.isText) {
          analyzeJsonAsset(f.text, f.rel).forEach((x) => findings.push(x));
        }
      } else {
        analyzeAsset(f, ctx).forEach((x) => findings.push(x));
      }
    } catch (e) {
      // A single file blowing up must not sink the scan — record and move on.
      findings.push(makeFinding({ rule_id: 'file-parse-error', severity: INFO, file: f.rel, line: 0,
        detail: 'Analyzer threw on this file (' + e.name + '); skipped.', evidence: e.message }));
    }
  }

  // Manifest post-analysis notes (declared-but-unused peripherals).
  manifestNotes(ctx, peripheralsUsed).forEach((x) => findings.push(x));

  return { findings, packageHash, capabilities: [...capabilitiesUsed].sort() };
}

// Truncate the findings array (worst-first) so the artifact stays under the
// callback/output size cap. The complete file is still what we write to --out;
// truncation only bounds what the workflow inlines when it re-reads the size.
function maybeTruncate(sorted, maxBytes) {
  let json = JSON.stringify(sorted);
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return { findings: sorted, truncated: false };
  const kept = [];
  for (const f of sorted) {
    kept.push(f);
    if (Buffer.byteLength(JSON.stringify(kept), 'utf8') > maxBytes) { kept.pop(); break; }
  }
  kept.push(makeFinding({ rule_id: 'findings-truncated', severity: INFO, file: '', line: 0,
    detail: 'Findings list truncated to the ' + kept.length + ' most-severe entries to stay under the ' + maxBytes + '-byte cap. The complete file is available on the runner via findings-path.',
    evidence: '' }));
  return { findings: kept, truncated: true };
}

async function main() {
  const args = parseArgs(process.argv);
  let artifact;
  try {
    if (!args.package || !args.out) {
      throw new Error('usage: scan.mjs --package <dir> --manifest <file> --out <file>');
    }
    const { findings, packageHash, capabilities } = await runScan(args);
    const sorted = sortFindings(findings);
    const { findings: outFindings, truncated } = maybeTruncate(sorted, args.maxBytes);
    const { verdict, score, counts } = scoreFindings(outFindings);
    const rationale = rationaleFor(verdict, outFindings, counts);
    artifact = buildArtifact({ verdict, score, counts, rationale, findings: outFindings, packageHash, truncated, capabilities });
  } catch (e) {
    // Fail SAFE: never GOOD on a crash. Emit a valid SUSPICIOUS artifact.
    artifact = buildArtifact({
      verdict: 'SUSPICIOUS',
      score: 10,
      counts: { info: 0, suspicious: 1, dangerous: 0 },
      rationale: 'Suspicious: the scanner failed to complete (' + e.name + ') — fail-safe verdict, manual review required.',
      findings: [makeFinding({ rule_id: 'scan-error', severity: SUSPICIOUS, file: '', line: 0,
        detail: 'The scanner threw before completing: ' + e.name + '. Treated as SUSPICIOUS so nothing auto-clears.', evidence: e.message })],
      packageHash: '',
      truncated: false,
    });
  }

  const json = JSON.stringify(artifact, null, 2);
  if (args.out) {
    try {
      await fs.writeFile(args.out, json, 'utf8');
    } catch (e) {
      // Last resort: if we can't even write the file, print to stdout so the
      // wrapper can still capture something.
      process.stdout.write(json);
      process.stderr.write('scan.mjs: could not write --out (' + e.message + ')\n');
    }
  } else {
    process.stdout.write(json);
  }
  // ALWAYS exit 0.
  process.exit(0);
}

main();
