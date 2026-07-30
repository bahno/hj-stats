/**
 * The app is a single page with no router, so a shareable link is just query
 * parameters. Two components own different ones — the view lives in App, the
 * lookup's gender/event/type/athlete live in AthleteLookup — so every write
 * merges into what is already there rather than replacing the whole string.
 */
export function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/** Sets each named parameter; a null or empty value removes it. */
export function writeParams(patch: Record<string, string | null>): void {
  const params = readParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  // replaceState, not pushState: changing the event picker is not navigation, and
  // a Back button that walked through every event you tried would be worse than
  // no history at all.
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}
