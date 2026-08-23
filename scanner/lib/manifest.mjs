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

// The `usb` permission is an UMBRELLA. This mirrors the Brewser runtime policy
// exactly (BrowserPermissionPolicy.setManifestPermissions in brewser-runtime):
// on Switch, WebUSB, Web MIDI, WebSerial and WebHID all ride the same `usb:hs`
// host transport, so declaring `usb` GRANTS `serial`, `hid` and `midi` too. It
// is a ONE-WAY implication — declaring `serial`/`hid`/`midi` alone does NOT
// grant `usb` or each other. Keeping this in lockstep with the runtime is what
// stops a legitimate `usb`-declaring app (e.g. matrixstudio, esp32experiments)
// being false-flagged for using navigator.serial / navigator.hid.
const USB_UMBRELLA_GRANTS = ['serial', 'hid', 'midi'];

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

  // Literally-declared families: a family is declared if any permission string
  // mentions it (heuristic). This is what the "declared but unused" note
  // iterates over — we only ask a developer to confirm perms they actually wrote.
  const declaredPeripheralFamilies = new Set();
  for (const fam of PERIPHERAL_FAMILIES) {
    if (permissions.some((p) => p.includes(fam))) declaredPeripheralFamilies.add(fam);
  }

  // Effectively-granted families: declared families PLUS the usb umbrella. This
  // is the set the "undeclared peripheral use" check consults, so the scanner's
  // notion of "covered" matches what the runtime will actually permit at launch.
  const grantedPeripheralFamilies = new Set(declaredPeripheralFamilies);
  if (grantedPeripheralFamilies.has('usb')) {
    for (const fam of USB_UMBRELLA_GRANTS) grantedPeripheralFamilies.add(fam);
  }

  const selfNamespace = manifest.id ? String(manifest.id) : (packageId || '');

  return {
    manifest,
    parseError,
    allowlist: buildAllowlist(allowedOrigins),
    permissions,
    declaredPeripheralFamilies,
    grantedPeripheralFamilies,
    selfNamespace,
  };
}

// Is a declared family satisfied by observed peripheral usage? Ordinarily this
// is a direct membership test, but the `usb` umbrella is satisfied by ANY
// USB-transport peripheral use (serial/hid/midi) — declaring `usb` and then
// using only navigator.serial is a legitimate, fully-exercised declaration.
function peripheralFamilyIsUsed(fam, used) {
  if (used.has(fam)) return true;
  if (fam === 'usb') return USB_UMBRELLA_GRANTS.some((f) => used.has(f));
  return false;
}

// Post-analysis notes: peripherals declared but never used (harmless, INFO).
export function manifestNotes(ctx, peripheralsUsedGlobal) {
  const findings = [];
  for (const fam of ctx.declaredPeripheralFamilies) {
    if (!peripheralFamilyIsUsed(fam, peripheralsUsedGlobal)) {
      findings.push(makeFinding({ rule_id: 'declared-unused-peripheral', severity: INFO,
        file: 'manifest.json', line: 0,
        detail: 'The manifest declares a "' + fam + '" permission but no code uses that peripheral API. Harmless, but worth confirming the declaration is intended.',
        evidence: fam }));
    }
  }
  return findings;
}
