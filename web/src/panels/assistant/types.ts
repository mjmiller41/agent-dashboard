// Wire/UI types for the Assistant panel (PLAN.md §6 "Assistant panel").
// Kept local to the panel — like panels/providers/types.ts, these describe a
// server-side streaming API, not a workspace-file zod schema (shared/ is
// specifically the workspace-file schema package, PLAN.md §4).

export interface ToolCallInfo {
  id: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  status: 'running' | 'done' | 'error';
  errorText?: string;
}

export interface ChatUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallInfo[];
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ConnectedProviderSummary {
  id: string;
  name: string;
}
