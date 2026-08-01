import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../workspace.ts';
import { buildWorkspaceTools } from './tools.ts';

let root: string;
let workspace: Workspace;
let tools: ReturnType<typeof buildWorkspaceTools>;

// Minimal ToolExecutionOptions stand-in — only `execute`'s first arg (the
// validated input) matters for these tests.
const opts = { toolCallId: 'test-call', messages: [], context: undefined } as unknown as Parameters<
  (typeof tools)['list_workspace']['execute']
>[1];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-tools-'));
  await writeFile(
    path.join(root, 'agents.json'),
    JSON.stringify({
      agents: [
        {
          id: 'a1',
          name: 'Researcher',
          role: 'researcher',
          iconId: 'icon-01.svg',
          status: 'idle',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, 'sprints.json'),
    JSON.stringify({
      current: { name: 'Sprint 1', startsOn: '2026-01-01', endsOn: '2026-01-14' },
      tasks: [{ id: 't1', title: 'Ship the thing', status: 'doing', order: 0 }],
    }),
  );
  workspace = new Workspace(root);
  tools = buildWorkspaceTools(workspace);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('read_workspace_file', () => {
  it('returns parsed JSON for a .json path', async () => {
    const result = (await tools.read_workspace_file.execute({ path: 'agents.json' }, opts)) as {
      kind: string;
      data: { agents: unknown[] };
    };
    expect(result.kind).toBe('json');
    expect(result.data.agents).toHaveLength(1);
  });

  it('returns a structured error, not a throw, for a missing file', async () => {
    const result = (await tools.read_workspace_file.execute({ path: 'nope.json' }, opts)) as {
      error?: string;
    };
    expect(result.error).toMatch(/no such workspace file/);
  });
});

describe('write_workspace_file', () => {
  it('writes a full JSON document and it round-trips on disk', async () => {
    const result = (await tools.write_workspace_file.execute(
      { path: 'links.json', content: { groups: [] } },
      opts,
    )) as { ok?: boolean; rev?: string };
    expect(result.ok).toBe(true);
    const raw = await readFile(path.join(root, 'links.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ groups: [] });
  });

  it('returns a structured validation error for a malformed sprints.json write', async () => {
    const result = (await tools.write_workspace_file.execute(
      { path: 'sprints.json', content: { not: 'valid' } },
      opts,
    )) as { error?: string };
    expect(result.error).toMatch(/failed schema validation/);
  });
});

describe('list_workspace', () => {
  it('lists every file in the workspace', async () => {
    const result = (await tools.list_workspace.execute({}, opts)) as {
      tree: Array<{ path: string }>;
    };
    const paths = result.tree.map((e) => e.path).sort();
    expect(paths).toEqual(['agents.json', 'sprints.json']);
  });
});

describe('update_sprint_task', () => {
  it('marks a task done and it round-trips on disk (the Phase 4 acceptance scenario)', async () => {
    const result = (await tools.update_sprint_task.execute({ taskId: 't1', status: 'done' }, opts)) as {
      ok?: boolean;
      status?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.status).toBe('done');

    const raw = JSON.parse(await readFile(path.join(root, 'sprints.json'), 'utf8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(raw.tasks[0]?.status).toBe('done');
  });

  it('preserves other fields (title, order) when only status changes', async () => {
    await tools.update_sprint_task.execute({ taskId: 't1', status: 'done' }, opts);
    const raw = JSON.parse(await readFile(path.join(root, 'sprints.json'), 'utf8')) as {
      tasks: Array<{ title: string; order: number }>;
    };
    expect(raw.tasks[0]).toMatchObject({ title: 'Ship the thing', order: 0 });
  });

  it('returns a structured error for an unknown task id', async () => {
    const result = (await tools.update_sprint_task.execute(
      { taskId: 'does-not-exist', status: 'done' },
      opts,
    )) as { error?: string };
    expect(result.error).toMatch(/no task with id/);
  });
});

describe('update_agent_status', () => {
  it('updates status and currentTask, refreshing lastUpdated', async () => {
    const before = JSON.parse(await readFile(path.join(root, 'agents.json'), 'utf8')) as {
      agents: Array<{ lastUpdated: string }>;
    };
    const result = (await tools.update_agent_status.execute(
      { agentId: 'a1', status: 'active', currentTask: 'researching' },
      opts,
    )) as { ok?: boolean; status?: string; currentTask?: string };
    expect(result.ok).toBe(true);
    expect(result.status).toBe('active');
    expect(result.currentTask).toBe('researching');

    const after = JSON.parse(await readFile(path.join(root, 'agents.json'), 'utf8')) as {
      agents: Array<{ status: string; lastUpdated: string }>;
    };
    expect(after.agents[0]?.status).toBe('active');
    expect(after.agents[0]?.lastUpdated).not.toBe(before.agents[0]?.lastUpdated);
  });

  it('returns a structured error for an unknown agent id', async () => {
    const result = (await tools.update_agent_status.execute({ agentId: 'nope', status: 'active' }, opts)) as {
      error?: string;
    };
    expect(result.error).toMatch(/no agent with id/);
  });
});
