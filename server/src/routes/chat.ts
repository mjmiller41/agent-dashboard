// POST /api/chat — streaming assistant endpoint (PLAN.md §5/§6). Body:
// {providerId, model, messages, workspaceTools}. Resolves the connected
// provider's credential (refreshing it if it's a near-expiry OAuth token),
// builds a real AI SDK LanguageModel via the provider descriptor's
// aiSdkFactory, and streams the response back as the AI SDK's UI-message
// SSE/data-stream protocol (PLAN.md: "streamText → SSE/data stream").
//
// `conversationId` is an additive field not in PLAN.md's literal body list —
// it's how the client identifies which on-disk chat-history conversation
// (PLAN.md §6 "persist last 20 conversations") a given request belongs to;
// see DECISIONS.md "Phase 4".
import { Hono } from 'hono';
import { stepCountIs, streamText, type ModelMessage } from 'ai';
import { z } from 'zod';
import type { ChatHistoryStore } from '../chat/history.ts';
import { buildSystemPrompt } from '../chat/system-prompt.ts';
import { buildWorkspaceTools } from '../chat/tools.ts';
import { ensureFreshCredential } from '../providers/credential-refresh.ts';
import type { CredentialStore } from '../providers/credentials.ts';
import { findProvider } from '../providers/registry.ts';
import type { Workspace } from '../workspace.ts';

const MAX_TOOL_STEPS = 8;

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const ChatRequestSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  workspaceTools: z.boolean(),
  conversationId: z.string().min(1).optional(),
});

export function createChatRoutes(
  store: CredentialStore,
  workspace: Workspace,
  history: ChatHistoryStore,
): Hono {
  const routes = new Hono();

  routes.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'request body must be JSON' }, 400);
    }

    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid chat request', issues: parsed.error.issues }, 400);
    }
    const { providerId, model, messages, workspaceTools, conversationId } = parsed.data;

    const descriptor = findProvider(providerId);
    if (!descriptor) return c.json({ error: `unknown provider: ${providerId}` }, 404);

    const cred = await store.get(providerId);
    if (!cred) return c.json({ error: `${providerId} is not connected` }, 400);

    let languageModel;
    try {
      const fresh = await ensureFreshCredential(descriptor, store, cred);
      languageModel = await descriptor.aiSdkFactory(fresh, model, store);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `failed to build a model for ${providerId}: ${message}` }, 502);
    }

    const modelMessages: ModelMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    const tools = workspaceTools ? buildWorkspaceTools(workspace) : undefined;

    const result = streamText({
      model: languageModel,
      system: buildSystemPrompt(workspaceTools),
      messages: modelMessages,
      ...(tools ? { tools, stopWhen: stepCountIs(MAX_TOOL_STEPS) } : {}),
      // Aborts server-side generation when the client disconnects (stop
      // button / navigating away) — @hono/node-server ties this signal to
      // the underlying HTTP request's abort/close event.
      abortSignal: c.req.raw.signal,
      onFinish: async ({ text }) => {
        if (!conversationId) return;
        const now = new Date().toISOString();
        const existing = await history.get(conversationId);
        await history.save({
          id: conversationId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          providerId,
          model,
          messages: [...messages, { role: 'assistant', content: text }],
        });
      },
      onError: ({ error }) => {
        console.error('chat streamText error:', error instanceof Error ? error.message : error);
      },
    });

    return result.toUIMessageStreamResponse();
  });

  return routes;
}
