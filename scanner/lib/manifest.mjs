// Manifest cross-reference (§1.5). The manifest has NO structured usb/serial/
// hid/bluetooth VID/PID fields (verified against the staging manifest.schema.json
// v1.29.110) — peripheral intent is a flat `permissions: string[]` of curated
// term NAMES, and `allowed_origins: string[]` is the exact exfil allowlist.
//
// So: the allowed_origins lever is exact; the peripheral lever is a family-name
// heuristic (does any declared permission string mention the API family?).
import { makeFinding } from './finding.mjs';
import { INFO } from './severity.mjs';
import { buildAllowlist } from './origins.mjs';

const PERIPHERAL_FAMILIES = ['usb', 'serial', 'hid', 'bluetooth', 'nfc'];

export function loadManifestContext(manifestText, packageId) {
  let manifest = {};
  let parseError = null;
  try {
    manifest = JSON.parse(manifestText);
  } catch (e) {
    parseError = e.message;
  }

  const allowedOrigins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  const permissions = (Array.isArray(manifest.permissions) ? manifest.permissions : []).map((p) => String(p).toLowerCase());

  // Family is "declared" if any permission string mentions it (heuristic).
  const declaredPeripheralFamilies = new Set();
  for (const fam of PERIPHERAL_FAMILIES) {
    if (permissions.some((p) => p.includes(fam))) declaredPeripheralFamilies.add(fam);
  }

  const selfNamespace = manifest.id ? String(manifest.id) : (packageId || '');

  return {
    manifest,
    parseError,
    allowlist: buildAllowlist(allowedOrigins),
    permissions,
    declaredPeripheralFamilies,
    selfNamespace,
  };
}

// Post-analysis notes: peripherals declared but never used (harmless, INFO).
export function manifestNotes(ctx, peripheralsUsedGlobal) {
  const findings = [];
  for (const fam of ctx.declaredPeripheralFamilies) {
    if (!peripheralsUsedGlobal.has(fam)) {
      findings.push(makeFinding({ rule_id: 'declared-unused-peripheral', severity: INFO,
        file: 'manifest.json', line: 0,
        detail: 'The manifest declares a "' + fam + '" permission but no code uses that peripheral API. Harmless, but worth confirming the declaration is intended.',
        evidence: fam }));
    }
  }
  return findings;
}
