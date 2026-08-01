// Tiny React binding for router.ts (kept separate so router.ts itself stays
// framework-free and within PLAN.md §2's ~40 line hash-router budget).
import { useSyncExternalStore } from 'react';
import { getCurrentRoute, onRouteChange, type Route } from '../router';

export function useRoute(): Route {
  return useSyncExternalStore(onRouteChange, getCurrentRoute, getCurrentRoute);
}
