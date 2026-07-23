// Scoring, cross-file escalation, and verdict. Most combination-escalation is
// done inline in the analyzers (same-dataflow, single-file). This does the
// aggregate: counts, numeric score, the handful of cross-file escalations, and
// the explainable rationale.
import { RANK, WEIGHT, DANGEROUS, SUSPICIOUS, INFO, verdictFor } from './severity.mjs';

// Group findings by file for the cross-file escalations.
function byFile(findings) {
  const m = new Map();
  for (const f of findings) {
    if (!m.has(f.file)) m.set(f.file, []);
    m.get(f.file).push(f);
  }
  return m;
}

export function scoreFindings(findings) {
  // Cross-file/one-level escalations (§1.6): computed-sink-name + external
  // egress in the same file escalates the computed-sink-name.
  const files = byFile(findings);
  for (const [, fs] of files) {
    const hasExternal = fs.some((f) => f.rule_id === 'external-egress' || f.rule_id === 'external-egress-assembled');
    if (hasExternal) {
      for (const f of fs) {
        if (f.rule_id === 'computed-sink-name' && f.severity === SUSPICIOUS) {
          f.severity = DANGEROUS;
          f.detail += ' [Escalated: same file performs off-package egress.]';
        }
      }
    }
  }

  const counts = { info: 0, suspicious: 0, dangerous: 0 };
  let highest = INFO;
  let score = 0;
  for (const f of findings) {
    if (f.severity === DANGEROUS) counts.dangerous++;
    else if (f.severity === SUSPICIOUS) counts.suspicious++;
    else counts.info++;
    score += WEIGHT[f.severity] || 0;
    if (RANK[f.severity] > RANK[highest]) highest = f.severity;
  }

  const verdict = findings.length === 0 ? 'GOOD' : verdictFor(highest);
  return { verdict, score, counts, highest };
}

export function rationaleFor(verdict, findings, counts) {
  if (verdict === 'DANGEROUS') {
    const top = findings.find((f) => f.severity === DANGEROUS);
    const where = top && top.file ? ' in ' + top.file + (top.line ? ':' + top.line : '') : '';
    return 'Dangerous: ' + (top ? top.title.toLowerCase() : 'known-bad pattern') + where + '.';
  }
  if (verdict === 'SUSPICIOUS') {
    const top = findings.find((f) => f.severity === SUSPICIOUS);
    return 'Suspicious: ' + counts.suspicious + ' signal(s) needing review' +
      (top ? '; e.g. ' + top.title.toLowerCase() : '') + '.';
  }
  return 'No known-bad pattern matched' +
    (counts.info ? ' (' + counts.info + ' informational note(s))' : '') +
    '. Not proof of safety — human review still required.';
}

// Deterministic worst-first ordering for the findings array in the artifact.
export function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    if (RANK[b.severity] !== RANK[a.severity]) return RANK[b.severity] - RANK[a.severity];
    if (a.rule_id !== b.rule_id) return a.rule_id < b.rule_id ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line || 0) - (b.line || 0);
  });
}
