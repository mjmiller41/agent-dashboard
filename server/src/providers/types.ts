// Shared types for the provider system (PLAN.md §6/§6a). Small and
// dependency-free so credentials.ts, oauth.ts, firstparty.ts, adapters/*,
// and registry.ts can all import it without a circular dependency.

/** Auth methods a provider descriptor can offer, in preference order (PLAN.md §6). */
export type AuthMethodKind = 'oauth-pkce' | 'oauth-device' | 'api-key';

export interface ModelInfo {
  id: string;
  name?: string | undefined;
  contextLength?: number | undefined;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number | undefined;
  modelCount?: number | undefined;
  message?: string | undefined;
}
