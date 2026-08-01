// Hand-rolled hash router (PLAN.md §2/§7): format `#/<panelId>/<subpath?>`.
// Deliberately not a dependency — see PLAN.md §2's ~40 line budget.

export interface Route {
  panelId: string | null;
  subpath: string | null;
}

const EMPTY_ROUTE: Route = { panelId: null, subpath: null };

/** Parse a raw `location.hash` string (with or without the leading `#`) into a Route. */
export function parseHash(hash: string): Route {
  const withoutHash = hash.replace(/^#/, '');
  const withoutLeadingSlashes = withoutHash.replace(/^\/+/, '');
  if (!withoutLeadingSlashes) return EMPTY_ROUTE;

  const [panelId = '', ...rest] = withoutLeadingSlashes.split('/');
  const subpath = rest.length > 0 ? decodeURIComponent(rest.join('/')) : null;
  return {
    panelId: panelId ? decodeURIComponent(panelId) : null,
    subpath: subpath || null,
  };
}

/** Build a `#/panelId/subpath` hash string for a route. */
export function buildHash(panelId: string, subpath?: string | null): string {
  const encodedPanel = encodeURIComponent(panelId);
  return subpath ? `#/${encodedPanel}/${encodeURIComponent(subpath)}` : `#/${encodedPanel}`;
}

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value when nothing has changed, or React re-renders forever ("Maximum
// update depth exceeded"). Cache the parsed Route against the raw hash
// string it was parsed from and only reparse when the hash actually changes.
let cachedHash: string | null = null;
let cachedRoute: Route = EMPTY_ROUTE;

/** Read the current route from `window.location.hash`, memoized against the raw hash. */
export function getCurrentRoute(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseHash(hash);
  }
  return cachedRoute;
}

/** Navigate by setting `window.location.hash`; triggers the browser's `hashchange`. */
export function navigate(panelId: string, subpath?: string | null): void {
  window.location.hash = buildHash(panelId, subpath);
}

/** Subscribe to route changes; returns an unsubscribe function. */
export function onRouteChange(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
