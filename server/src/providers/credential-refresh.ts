// Shared "ensure the credential is fresh before use" helper (PLAN.md §6a:
// "the credential layer auto-refreshes: proactively when expiresAt is near").
// Extracted out of routes/providers.ts (Phase 3) so routes/chat.ts (Phase 4)
// can reuse the exact same refresh logic instead of duplicating it — see
// DECISIONS.md "Phase 4".
import type { CredentialStore, StoredCredential } from './credentials.ts';
import { coalescedRefresh } from './oauth.ts';
import type { ProviderDescriptor } from './registry.ts';

const EXPIRY_SKEW_MS = 60_000;

/**
 * Returns `cred` unchanged unless it's an OAuth credential nearing (or past)
 * expiry and the provider descriptor has a `refresh` function, in which case
 * it refreshes (coalescing concurrent refreshes for the same provider),
 * persists the rotated tokens, and returns the refreshed credential.
 */
export async function ensureFreshCredential(
  descriptor: ProviderDescriptor,
  store: CredentialStore,
  cred: StoredCredential,
): Promise<StoredCredential> {
  if (cred.method !== 'oauth' || !cred.refreshToken || !cred.expiresAt) return cred;
  if (cred.expiresAt - Date.now() > EXPIRY_SKEW_MS) return cred;
  const refresh = descriptor.oauth && 'refresh' in descriptor.oauth ? descriptor.oauth.refresh : undefined;
  if (!refresh) return cred;
  const refreshed = await coalescedRefresh(descriptor.id, () => refresh(cred));
  await store.update(descriptor.id, () => refreshed);
  return { ...refreshed, method: cred.method, connectedAt: cred.connectedAt };
}
