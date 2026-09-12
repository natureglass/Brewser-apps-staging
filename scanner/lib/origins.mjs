// Origin classification. Brewser apps are served same-origin, so ANY absolute
// http(s):// / ws(s):// (or protocol-relative //host) URL whose origin isn't
// declared in the manifest's `allowed_origins[]` is treated as external egress.
// Relative / package-local URLs are fine. `allowed_origins` is the exact,
// per-app allowlist (staging manifest.schema.json field) — this is the
// strongest, lowest-FP lever the scanner has for the exfil surface.
//
// The grammar below is shared verbatim with two other layers and must stay in
// lockstep with both:
//   * the Brewser runtime (`BrowserPermissionPolicy`), which ENFORCES a
//     non-empty list at launch, and
//   * the WordPress submit validator (`Brewser_Sub_Validate::allowed_origins`),
//     which is what a developer's typed entry has to survive.
// A rule that disagrees with the runtime either flags a request the console
// will happily make, or clears one it will refuse.
//
//   scheme://[*.]host[:port]
//
//   - scheme is http/https/ws/wss; ws->http and wss->https fold together, so a
//     WebSocket endpoint may be declared in either spelling. Without this fold
//     every app using WebSockets is flagged as external egress, because
//     `new WebSocket()` is routed through the same sink check and a `wss://`
//     URL could never match an `https://` entry.
//   - the port is part of the origin, as on the web. A default port is dropped
//     on both sides so `https://x:443` and `https://x` compare equal.
//   - a leading `*.` matches one or more subdomain labels but NOT the apex
//     (CSP's host-wildcard semantics). Needed because CDN-backed media apps
//     cannot enumerate edge hostnames — a Twitch HLS variant resolves to a
//     different `*.hls.ttvnw.net` node by region and by hour.
//   - a wildcard must leave at least two labels behind it: `https://*.com`
//     (or a bare `*`) authorises a whole public suffix, which is no narrower
//     than having no allowlist at all.

const ABSOLUTE_RE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

const ORIGIN_PATTERN_RE = /^(https?|wss?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+))?\/?$/;

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

function foldScheme(scheme) {
  const s = String(scheme).toLowerCase();
  if (s === 'ws' || s === 'ws:') return 'http:';
  if (s === 'wss' || s === 'wss:') return 'https:';
  return s.endsWith(':') ? s : s + ':';
}

function normalizePort(scheme, port) {
  return port && port === DEFAULT_PORTS[scheme] ? '' : port;
}

// Canonical `scheme://host[:port]` for an absolute URL, or null.
export function normalizeOrigin(url) {
  try {
    const u = new URL(url);
    const scheme = foldScheme(u.protocol);
    const port = normalizePort(scheme, u.port);
    return (scheme + '//' + u.hostname + (port ? ':' + port : '')).toLowerCase();
  } catch {
    return null;
  }
}

export function parseOriginPattern(entry) {
  if (typeof entry !== 'string') return null;
  const m = ORIGIN_PATTERN_RE.exec(entry.trim().toLowerCase());
  if (!m) return null;
  const scheme = foldScheme(m[1]);
  const wildcard = m[2] !== undefined;
  const host = m[3];
  if (wildcard && !host.includes('.')) return null;
  return { scheme, host, port: normalizePort(scheme, m[4] || ''), wildcard };
}

// A Set-like allowlist: `.size` for the "did they declare anything" checks,
// `.matches(url)` for the per-URL test.
class Allowlist {
  constructor(patterns) {
    this.patterns = patterns;
  }

  get size() {
    return this.patterns.length;
  }

  matches(url) {
    let scheme, hostname, port;
    try {
      const u = new URL(url);
      scheme = foldScheme(u.protocol);
      hostname = u.hostname.toLowerCase();
      port = normalizePort(scheme, u.port);
    } catch {
      return false;
    }
    for (const p of this.patterns) {
      if (p.scheme !== scheme || p.port !== port) continue;
      if (p.wildcard ? hostname.endsWith('.' + p.host) : hostname === p.host) return true;
    }
    return false;
  }
}

// Build the allowlist from manifest.allowed_origins. Entries that do not parse
// are dropped — an unparseable entry is not a permission, so the strictest
// reading (flag requests it might have covered) is the safe one.
export function buildAllowlist(allowedOrigins) {
  const patterns = [];
  for (const o of allowedOrigins || []) {
    const p = parseOriginPattern(o);
    if (p) patterns.push(p);
  }
  return new Allowlist(patterns);
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
    // Non-network schemes never egress.
    if (/^(data|blob|about|javascript|mailto|tel):/i.test(candidate)) return false;
    if (normalizeOrigin(candidate) === null) return false; // unparseable — not provably external
    return !allowlist.matches(candidate);
  }
  // Bare `host.tld/...` with no scheme but a dot before the first slash is
  // frequently an origin in disguise (e.g. fetch('evil.com/x')). Only treat it
  // as external if it clearly looks like a hostname, not a relative path.
  if (!trimmed.startsWith('/') && !trimmed.startsWith('.') && /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(trimmed)) {
    const candidate = 'https://' + trimmed;
    return normalizeOrigin(candidate) === null ? false : !allowlist.matches(candidate);
  }
  return false;
}

export function isAbsolute(url) {
  return typeof url === 'string' && ABSOLUTE_RE.test(url.trim());
}
