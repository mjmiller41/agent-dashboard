// Integration tests for POST /api/chat routed through a real Hono app +
// real Workspace + real ChatHistoryStore, same style as providers.test.ts.
// The only thing faked is the network: a local http server stands in for
// an OpenAI-compatible chat endpoint (SSE chunks in the exact shape
// @ai-sdk/openai-compatible expects — see google/openai-compatible's own
// source, read before writing this), wired up via the real "custom"
// provider descriptor's real aiSdkFactory/credential path. No real paid
// API is called; no AI SDK internals are mocked — this exercises the real
// streamText → tool-loop → toUIMessageStreamResponse path end-to-end.
//
// The stop-button/abort path is not unit-tested here (see the build
// report) — Hono's in-process `app.request()` helper doesn't do real
// network I/O, so there's no meaningful way to abort mid-stream through
// it; that's verified live against the real dev server + Ollama instead.
import { Hono } from 'hono';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatHistoryStore } from '../chat/history.ts';
import { CredentialStore } from '../providers/credentials.ts';
import { Workspace } from '../workspace.ts';
import { createChatRoutes } from './chat.ts';

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function textStream(...pieces: string[]): string {
  const deltas = pieces.map((content) =>
    sseChunk({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }),
  );
  return [
    ...deltas,
    sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n',
  ].join('');
}

function toolCallStream(toolName: string, args: Record<string, unknown>): string {
  return [
    sseChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    'data: [DONE]\n\n',
  ].join('');
}

let fakeModelServer: http.Server;
let fakeModelBaseUrl: string;
let responseQueue: string[];
let requestCount: number;

beforeAll(async () => {
  fakeModelServer = http.createServer((req, res) => {
    requestCount++;
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const next = responseQueue.shift() ?? textStream('(unexpected extra request)');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(next);
    });
  });
  await new Promise<void>((resolve) => fakeModelServer.listen(0, '127.0.0.1', resolve));
  const { port } = fakeModelServer.address() as AddressInfo;
  fakeModelBaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fakeModelServer.close(() => resolve()));
});

let workspaceDir: string;
let appDataDir: string;
let workspace: Workspace;
let store: CredentialStore;
let history: ChatHistoryStore;
let app: Hono;

beforeEach(async () => {
  requestCount = 0;
  responseQueue = [];
  workspaceDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-chat-ws-'));
  appDataDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-chat-appdata-'));
  await writeFile(
    path.join(workspaceDir, 'sprints.json'),
    JSON.stringify({
      current: { name: 'Sprint 1', startsOn: '2026-01-01', endsOn: '2026-01-14' },
      tasks: [{ id: 't1', title: 'Ship the thing', status: 'doing', order: 0 }],
    }),
  );
  workspace = new Workspace(workspaceDir);
  store = new CredentialStore(appDataDir);
  history = new ChatHistoryStore(appDataDir);
  await store.set('custom', 'api-key', { apiKey: 'test-key', baseUrl: fakeModelBaseUrl });

  app = new Hono();
  app.route('/api/chat', createChatRoutes(store, workspace, history));
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
});

function chatRequest(overrides: Record<string, unknown> = {}) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'custom',
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      workspaceTools: false,
      ...overrides,
    }),
  });
}

describe('POST /api/chat — validation', () => {
  it('404s for an unknown provider', async () => {
    const res = await chatRequest({ providerId: 'nope' });
    expect(res.status).toBe(404);
  });

  it('400s when the provider is not connected', async () => {
    const res = await chatRequest({ providerId: 'ollama' });
    expect(res.status).toBe(400);
  });

  it('400s for a malformed body', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'custom' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat — streaming (no tools)', () => {
  it('streams a UI-message SSE response with incremental text-delta chunks', async () => {
    responseQueue = [textStream('Hel', 'lo!')];
    const res = await chatRequest();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    const deltaCount = (body.match(/"type":"text-delta"/g) ?? []).length;
    // Two separate text-delta chunks proves incremental streaming, not one final blob.
    expect(deltaCount).toBe(2);
    expect(body).toContain('Hel');
    expect(body).toContain('lo!');
    expect(body).toContain('"type":"finish"');
  });

  it('persists the conversation to chat history when a conversationId is supplied', async () => {
    responseQueue = [textStream('ok')];
    const res = await chatRequest({ conversationId: 'conv-1' });
    await res.text();
    const saved = await history.get('conv-1');
    expect(saved?.providerId).toBe('custom');
    expect(saved?.messages.at(-1)).toEqual({ role: 'assistant', content: 'ok' });
  });
});

describe('POST /api/chat — workspaceTools tool-call round trip', () => {
  it('runs update_sprint_task via a tool call and the change lands on disk (Phase 4 acceptance scenario)', async () => {
    responseQueue = [
      toolCallStream('update_sprint_task', { taskId: 't1', status: 'done' }),
      textStream('Marked it done.'),
    ];
    const res = await chatRequest({
      workspaceTools: true,
      messages: [{ role: 'user', content: 'mark task t1 done' }],
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('"toolName":"update_sprint_task"');
    expect(body).toContain('"type":"tool-input-available"');
    expect(body).toContain('"type":"tool-output-available"');
    expect(requestCount).toBe(2); // one call that produced the tool call, one follow-up with the tool result

    const onDisk = JSON.parse(await readFile(path.join(workspaceDir, 'sprints.json'), 'utf8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(onDisk.tasks[0]?.status).toBe('done');
  });
});
