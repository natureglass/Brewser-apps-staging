// Origin classification. Brewser apps are served same-origin, so ANY absolute
// http(s):// (or protocol-relative //host) URL whose origin isn't declared in
// the manifest's `allowed_origins[]` is treated as external egress. Relative /
// package-local URLs are fine. `allowed_origins` is the exact, per-app allowlist
// (staging manifest.schema.json field) — this is the strongest, lowest-FP lever
// the scanner has for the exfil surface.

const ABSOLUTE_RE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

export function normalizeOrigin(url) {
  try {
    const u = new URL(url);
    return (u.protocol + '//' + u.host).toLowerCase();
  } catch {
    return null;
  }
}

// Build the allowlist set from manifest.allowed_origins (array of `https?://…`).
export function buildAllowlist(allowedOrigins) {
  const set = new Set();
  for (const o of allowedOrigins || []) {
    const norm = normalizeOrigin(o);
    if (norm) set.add(norm);
  }
  return set;
}

// True when a STRING LITERAL URL points off-package to a non-allowlisted origin.
// Relative URLs, data:/blob:, and same-package paths return false.
export function isExternalUrl(url, allowlist) {
  if (typeof url !== 'string' || url === '') return false;
  const trimmed = url.trim();
  // Scheme-relative or absolute with a host.
  if (ABSOLUTE_RE.test(trimmed)) {
    // Protocol-relative //host -> assume https for origin resolution.
    const candidate = trimmed.startsWith('//') ? 'https:' + trimmed : trimmed;
    const norm = normalizeOrigin(candidate);
    if (!norm) return false; // unparseable — not provably external
    // Non-network schemes never egress.
    if (/^(data|blob|about|javascript|mailto|tel):/i.test(candidate)) return false;
    return !allowlist.has(norm);
  }
  // Bare `host.tld/...` with no scheme but a dot before the first slash is
  // frequently an origin in disguise (e.g. fetch('evil.com/x')). Only treat it
  // as external if it clearly looks like a hostname, not a relative path.
  if (!trimmed.startsWith('/') && !trimmed.startsWith('.') && /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(trimmed)) {
    const norm = normalizeOrigin('https://' + trimmed);
    return norm ? !allowlist.has(norm) : false;
  }
  return false;
}

export function isAbsolute(url) {
  return typeof url === 'string' && ABSOLUTE_RE.test(url.trim());
}
