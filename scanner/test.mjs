#!/usr/bin/env node
// Regression suite. Runs the real scan.mjs CLI against every fixture and asserts
// the verdict + required/forbidden rule ids. Also asserts the harness contract:
// exit code is always 0 and the artifact always carries the `limitations` note.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './lib/rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN = path.join(__dirname, 'scan.mjs');
const FIX = path.join(__dirname, 'fixtures');

const CASES = [
  { dir: 'clean', verdict: 'GOOD', must: [], mustNot: ['auth-exfil-dataflow', 'decode-exec', 'external-egress', 'cross-namespace-storage'] },
  { dir: 'auth-exfil', verdict: 'DANGEROUS', must: ['auth-exfil-dataflow', 'auth-token-read'], mustNot: [] },
  { dir: 'obvious-bad', verdict: 'DANGEROUS', must: ['decode-exec', 'external-egress'], mustNot: [] },
  { dir: 'obfuscated', verdict: 'DANGEROUS', must: ['constructor-escape', 'string-array-obfuscation', 'computed-sink-name'], mustNot: [] },
  { dir: 'undeclared-peripheral', verdict: 'SUSPICIOUS', must: ['peripheral-undeclared'], mustNot: ['auth-exfil-dataflow'] },
];

function runScan(dir) {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'brewser-scan-')), 'findings.json');
  const pkg = path.join(FIX, dir);
  let exitCode = 0;
  try {
    execFileSync('node', [SCAN, '--package', pkg, '--manifest', path.join(pkg, 'manifest.json'), '--out', out], { stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status == null ? -1 : e.status;
  }
  const artifact = JSON.parse(readFileSync(out, 'utf8'));
  return { artifact, exitCode };
}

let failures = 0;
const log = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures++; };

for (const c of CASES) {
  console.log('\n# ' + c.dir);
  const { artifact, exitCode } = runScan(c.dir);
  const ids = new Set(artifact.findings.map((f) => f.rule_id));

  log(exitCode === 0, 'exit code is 0 (got ' + exitCode + ')');
  log(artifact.verdict === c.verdict, 'verdict is ' + c.verdict + ' (got ' + artifact.verdict + ')');
  log(typeof artifact.limitations === 'string' && /not proof of safety/i.test(artifact.limitations), 'carries the not-proof-of-safety limitations note');
  log(typeof artifact.scanner_version === 'string' && artifact.scanner_version.length > 0, 'has scanner_version');
  log(typeof artifact.package_hash === 'string' && artifact.package_hash.length === 64, 'has a sha256 package_hash');
  for (const id of c.must) log(ids.has(id), 'trips rule ' + id);
  for (const id of c.mustNot) log(!ids.has(id), 'does NOT trip rule ' + id);
}

// Full-catalogue coverage: the all-patterns fixture must trip EVERY non-harness
// rule (guards the whole catalogue against silent regressions — e.g. an analyzer
// that throws and skips a file, which is exactly how the YieldStatement crash and
// the .toString.call devtools miss slipped through before).
{
  console.log('\n# all-patterns (full catalogue coverage)');
  const { artifact, exitCode } = runScan('all-patterns');
  const got = new Set(artifact.findings.map((f) => f.rule_id));
  const harness = new Set(['scan-error', 'findings-truncated', 'file-parse-error']);
  const expected = Object.keys(RULES).filter((r) => !harness.has(r));
  const missing = expected.filter((r) => !got.has(r));
  log(exitCode === 0, 'exit code is 0');
  log(artifact.verdict === 'DANGEROUS', 'verdict is DANGEROUS (got ' + artifact.verdict + ')');
  log(!got.has('file-parse-error'), 'no file-parse-error (no analyzer threw/skipped a file)');
  log(missing.length === 0, 'trips every non-harness rule' + (missing.length ? ' — MISSING: ' + missing.join(', ') : ' (' + expected.length + ')'));
}

// Determinism: the same package hashes the same across two runs.
const a = runScan('obfuscated').artifact.package_hash;
const b = runScan('obfuscated').artifact.package_hash;
console.log('\n# determinism');
log(a === b && a.length === 64, 'package_hash is stable across runs');

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
