// CSS analyzer (low priority). Flags url() pointing off-package and @import of
// remote stylesheets — data-exfil-via-CSS is rare but real.
import { makeFinding } from './finding.mjs';
import { INFO } from './severity.mjs';
import { isExternalUrl } from './origins.mjs';

function lineFromIndex(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

export function analyzeCss(text, file, ctx) {
  const findings = [];
  const add = (f) => findings.push(makeFinding(f));

  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[2].trim();
    if (isExternalUrl(url, ctx.allowlist)) {
      add({ rule_id: 'css-external-url', severity: INFO, file, line: lineFromIndex(text, m.index),
        detail: 'CSS url() references external origin ' + url + '.', evidence: m[0] });
    }
  }

  const importRe = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi;
  while ((m = importRe.exec(text)) !== null) {
    const url = m[2].trim();
    if (isExternalUrl(url, ctx.allowlist)) {
      add({ rule_id: 'css-external-url', severity: INFO, file, line: lineFromIndex(text, m.index),
        detail: 'CSS @import of a remote stylesheet ' + url + '.', evidence: m[0] });
    }
  }

  return { findings };
}
