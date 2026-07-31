// HTML + SVG analyzer. Extracts every active-content surface and feeds inline
// JS through the JS analyzer. SVG is parsed the same way because it is an
// active-content format (inline <script>, on* handlers).
import { parse as parseHtml } from 'node-html-parser';
import { analyzeJs } from './js-analyze.mjs';
import { makeFinding } from './finding.mjs';
import { INFO, SUSPICIOUS } from './severity.mjs';
import { isExternalUrl } from './origins.mjs';

function lineFromOffset(text, offset) {
  if (typeof offset !== 'number' || offset < 0) return 0;
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function nodeOffset(node) {
  if (node && node.range && typeof node.range[0] === 'number') return node.range[0];
  return -1;
}

export function analyzeHtml(text, file, ctx, isSvg = false) {
  const findings = [];
  const peripheralsUsed = new Set();
  const capabilitiesUsed = new Set();
  const add = (f) => findings.push(makeFinding(f));

  let root;
  try {
    root = parseHtml(text, { comment: false, lowerCaseTagName: true });
  } catch (e) {
    add({ rule_id: 'file-parse-error', severity: INFO, file, line: 0,
      detail: 'Could not parse HTML/SVG (' + e.name + ').', evidence: e.message });
    return { findings, peripheralsUsed, capabilitiesUsed };
  }

  // Inline + external <script>.
  for (const s of root.querySelectorAll('script')) {
    const srcAttr = s.getAttribute('src');
    const line = lineFromOffset(text, nodeOffset(s));
    if (srcAttr) {
      if (isExternalUrl(srcAttr, ctx.allowlist)) {
        add({ rule_id: 'external-egress', severity: SUSPICIOUS, file, line,
          detail: '<script src> loads code from external origin ' + srcAttr + '.', evidence: srcAttr });
      }
    } else {
      const js = s.rawText || s.text || '';
      if (js.trim()) {
        const sub = analyzeJs(js, file + ' <inline script>', ctx);
        for (const f of sub.findings) { if (!f.line) f.line = line; findings.push(f); }
        for (const p of sub.peripheralsUsed) peripheralsUsed.add(p);
        for (const c of sub.capabilitiesUsed) capabilitiesUsed.add(c);
      }
    }
    if (isSvg) {
      add({ rule_id: 'svg-active-content', severity: SUSPICIOUS, file, line,
        detail: 'SVG contains a <script> element — SVG is active content and can execute JS.', evidence: '<script> in SVG' });
    }
  }

  // Inline event-handler attributes (onclick, onload, …) + javascript: URLs +
  // remote embeds. Walk every element once.
  const walk = (el) => {
    if (el.nodeType === 1 || (el.tagName && el.attributes)) {
      const attrs = el.attributes || {};
      const line = lineFromOffset(text, nodeOffset(el));
      for (const [name, val] of Object.entries(attrs)) {
        const lname = name.toLowerCase();
        if (lname.startsWith('on') && val && val.trim()) {
          const js = val;
          const sub = analyzeJs(js, file + ' [' + lname + ']', ctx);
          for (const f of sub.findings) { if (!f.line) f.line = line; findings.push(f); }
          for (const p of sub.peripheralsUsed) peripheralsUsed.add(p);
          for (const c of sub.capabilitiesUsed) capabilitiesUsed.add(c);
          if (isSvg) {
            add({ rule_id: 'svg-active-content', severity: SUSPICIOUS, file, line,
              detail: 'SVG element carries an inline ' + lname + ' handler.', evidence: lname + '="' + val.slice(0, 60) + '"' });
          }
        }
        // javascript: URLs.
        if ((lname === 'href' || lname === 'src' || lname === 'action' || lname === 'formaction') &&
            /^\s*javascript:/i.test(val || '')) {
          add({ rule_id: 'html-injection-sink', severity: INFO, file, line,
            detail: 'javascript: URL in ' + lname + ' attribute.', evidence: val });
        }
        // Remote src/data on iframe/object/embed/img.
        if ((lname === 'src' || lname === 'data') && val && isExternalUrl(val, ctx.allowlist)) {
          const tag = (el.tagName || '').toLowerCase();
          if (['iframe', 'object', 'embed', 'img', 'source', 'video', 'audio'].includes(tag)) {
            add({ rule_id: 'external-egress', severity: tag === 'iframe' || tag === 'object' || tag === 'embed' ? SUSPICIOUS : INFO,
              file, line, detail: '<' + tag + '> loads from external origin ' + val + '.', evidence: val });
          }
        }
      }
      // Full-viewport transparent / pointer overlay heuristic (clickjacking).
      const style = (attrs.style || '').toLowerCase();
      const tag = (el.tagName || '').toLowerCase();
      if ((tag === 'iframe' || tag === 'div') && style &&
          /opacity\s*:\s*0(\.0*)?\b/.test(style) &&
          /(position\s*:\s*(fixed|absolute))/.test(style)) {
        add({ rule_id: 'clickjacking-overlay', severity: SUSPICIOUS, file, line,
          detail: 'A positioned, fully-transparent <' + tag + '> — a clickjacking/overlay shell pattern.', evidence: attrs.style });
      }
    }
    for (const child of el.childNodes || []) walk(child);
  };
  walk(root);

  // <meta http-equiv="refresh" content="0;url=external">
  for (const m of root.querySelectorAll('meta')) {
    if ((m.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') {
      const content = m.getAttribute('content') || '';
      const match = content.match(/url\s*=\s*(.+)$/i);
      if (match && isExternalUrl(match[1].trim().replace(/^['"]|['"]$/g, ''), ctx.allowlist)) {
        add({ rule_id: 'meta-refresh-external', severity: SUSPICIOUS, file, line: lineFromOffset(text, nodeOffset(m)),
          detail: 'meta refresh redirects to an external origin.', evidence: content });
      }
    }
  }

  return { findings, peripheralsUsed, capabilitiesUsed };
}
