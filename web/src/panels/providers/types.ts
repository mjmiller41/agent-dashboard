// Wire types matching server/src/routes/providers.ts's JSON responses
// (PLAN.md §6/§6a). Kept local to the panel rather than in @agent-dashboard/shared
// since these describe a server-side connection API, not a workspace file
// schema — shared/ is specifically the workspace-file zod-schema package
// (PLAN.md §4).

export interface ApiKeySpec {
  placeholder: string;
  helpUrl: string;
  baseUrlConfigurable?: boolean;
  optional?: boolean;
}

export interface OAuthSummary {
  kind: 'pkce-loopback' | 'pkce-fixed-port' | 'pkce-code-paste' | 'device-code';
  scopes?: string[];
}

export type AuthMethodKind = 'oauth-pkce' | 'oauth-device' | 'api-key';

export interface ProviderSummary {
  id: string;
  name: string;
  logoId: string;
  auth: AuthMethodKind[];
  apiKey?: ApiKeySpec;
  oauth?: OAuthSummary;
  firstParty: boolean;
  recommended: boolean;
  connected: boolean;
  method?: 'oauth' | 'api-key';
  maskedKey?: string;
  connectedAt?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  modelCount?: number;
  message?: string;
}
