// OpenAI ChatGPT-Codex-backend adapter (PLAN.md §6a "custom adapter"). Used
// when OAuth mode (a) — token-exchange for a plain `sk-` API key — isn't
// available on the account (issue #11: this is the common case, not the
// exception). Standard OpenAI Responses API request shape, but against
// chatgpt.com/backend-api/codex with the OAuth access_token as bearer and a
// `chatgpt-account-id` header. Full streaming chat is Phase 4 — this module
// only needs a live "Test" call and a model list for Phase 3.
import { OPENAI_OAUTH } from '../firstparty.ts';
import type { ModelInfo, ProviderTestResult } from '../types.ts';

const DEFAULT_TEST_MODEL = 'gpt-5.1-codex';

export async function codexResponsesTest(
  accessToken: string,
  accountId: string | undefined,
): Promise<ProviderTestResult> {
  const start = Date.now();
  const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    },
    body: JSON.stringify({
      model: DEFAULT_TEST_MODEL,
      instructions: 'Reply with the single word: ok',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Reply with the single word: ok' }],
        },
      ],
      tools: null,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: null,
      store: false,
      stream: false,
      include: [],
    }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
  return { ok: true, latencyMs };
}

/** No public model-listing endpoint for the Codex backend — curated static list
 *  of the models the Codex CLI itself offers. See DECISIONS.md "Phase 3". */
export function codexListModels(): ModelInfo[] {
  return [
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex mini' },
  ];
}
