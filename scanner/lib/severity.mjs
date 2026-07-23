// Severity model shared across every analyzer. Three tiers only; the numeric
// rank is what scoring/escalation and the "highest wins" verdict sort on.
export const INFO = 'INFO';
export const SUSPICIOUS = 'SUSPICIOUS';
export const DANGEROUS = 'DANGEROUS';

export const RANK = { INFO: 1, SUSPICIOUS: 2, DANGEROUS: 3 };

// Per-severity numeric weight fed into the aggregate `score` (for worst-first
// sorting in the admin queue). Deliberately spread so one DANGEROUS always
// outsorts any pile of SUSPICIOUS/INFO.
export const WEIGHT = { INFO: 1, SUSPICIOUS: 10, DANGEROUS: 100 };

export function maxSeverity(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

// Bump a severity up one tier (DANGEROUS is the ceiling).
export function escalate(sev) {
  if (sev === INFO) return SUSPICIOUS;
  return DANGEROUS;
}

// Map the highest severity present to the package verdict string.
export function verdictFor(sev) {
  if (sev === DANGEROUS) return 'DANGEROUS';
  if (sev === SUSPICIOUS) return 'SUSPICIOUS';
  return 'GOOD';
}
