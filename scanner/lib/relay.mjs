// Brewser realtime relay (`wss://ws.brewser.io`) awareness.
//
// The relay namespaces rooms by an `app` query parameter that the CLIENT
// supplies. On the Switch runtime that claim is verified — app code cannot
// open a socket of its own, so the runtime stamps the manifest id it loaded
// the app under and the relay enforces the match. On the web there is no
// equivalent: every app is served from the same play.brewser.io origin, so
// app A can read app B's bundle and nothing a page sends can distinguish
// them. The relay therefore CANNOT reject a web app claiming another app's
// namespace, and joining it grants full read/write of that app's room —
// its broadcasts, its shared state, and the ability to seize state
// ownership and lock the real app out.
//
// Submission-time detection is the control that covers that gap, and it is
// a good fit for static analysis: a legitimate app hardcodes its own id, so
// a literal mismatch is unambiguous and a computed value is rare enough to
// be worth a human look.

/** Hosts whose `app` query parameter is an app-identity claim. */
export const RELAY_HOSTS = new Set(['ws.brewser.io']);

/** True when any string fragment mentions a relay host. */
export function mentionsRelayHost(text) {
  if (typeof text !== 'string' || text === '') return false;
  const lower = text.toLowerCase();
  for (const host of RELAY_HOSTS) {
    if (lower.includes(host)) return true;
  }
  return false;
}

/**
 * Read the `app` parameter out of a relay URL.
 *
 * Returns:
 *   - `{ host, app }`   a relay URL carrying a literal app id
 *   - `{ host, app: null }` a relay URL with no (or an empty) app parameter
 *   - `null`            not a relay URL at all
 */
export function relayAppClaim(url) {
  if (typeof url !== 'string' || url === '') return null;
  let parsed;
  try {
    // Tolerate protocol-relative and scheme-less forms the same way the
    // origin classifier does — `//ws.brewser.io/?app=x` is still a claim.
    const candidate = url.trim().startsWith('//') ? 'wss:' + url.trim() : url.trim();
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const host = parsed.host.toLowerCase();
  if (!RELAY_HOSTS.has(host)) return null;
  const app = parsed.searchParams.get('app');
  return { host, app: app && app.length > 0 ? app : null };
}
