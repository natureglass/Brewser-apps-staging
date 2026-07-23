// Finding factory. Every analyzer produces findings through here so evidence is
// ALWAYS truncated (never a full payload in the JSON or the DB) and the shape is
// uniform. `severity` defaults to the rule's base but callers pass the final
// (possibly escalated) severity.
import { ruleTitle, ruleBase } from './rules.mjs';

export const EVIDENCE_MAX = 120;

export function truncate(str, max = EVIDENCE_MAX) {
  if (str == null) return '';
  let s = String(str).replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

export function makeFinding({ rule_id, severity, file, line, detail, evidence, title }) {
  return {
    rule_id,
    severity: severity || ruleBase(rule_id),
    title: title || ruleTitle(rule_id),
    detail: detail || '',
    file: file || '',
    line: typeof line === 'number' && line > 0 ? line : 0,
    evidence: truncate(evidence),
  };
}
