import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Workspace,
  WorkspaceNotFoundError,
  WorkspacePathError,
  WorkspaceValidationError,
  computeRev,
  resolveWorkspaceRoot,
} from './workspace.ts';

let root: string;
let workspace: Workspace;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-ws-'));
  workspace = new Workspace(root);
  await writeFile(
    path.join(root, 'agents.json'),
    JSON.stringify({
      agents: [
        {
          id: 'a1',
          name: 'A',
          role: 'r',
          iconId: 'icon-01.svg',
          status: 'idle',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'hello.md'), '# hello\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Workspace path traversal guard', () => {
  it('rejects "../" traversal on read', async () => {
    await expect(workspace.readFile('../../etc/passwd')).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects "../" traversal on write', async () => {
    await expect(workspace.writeFile('../escape.json', {})).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects "../" traversal on delete', async () => {
    await expect(workspace.deleteFile('../escape.json')).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects absolute paths', async () => {
    await expect(workspace.readFile('/etc/passwd')).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects a nested traversal that still resolves outside root', async () => {
    await expect(workspace.readFile('docs/../../../etc/passwd')).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects a symlink that escapes the workspace root', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-outside-'));
    await writeFile(path.join(outsideDir, 'secret.json'), '{"leaked": true}');
    await symlink(outsideDir, path.join(root, 'escape-link'), 'dir');

    await expect(workspace.readFile('escape-link/secret.json')).rejects.toBeInstanceOf(WorkspacePathError);

    await rm(outsideDir, { recursive: true, force: true });
  });

  it('allows a normal in-root read', async () => {
    const result = await workspace.readFile('agents.json');
    expect(result.kind).toBe('json');
  });
});

describe('Workspace.writeFile schema validation', () => {
  it('rejects an invalid agents.json payload with WorkspaceValidationError', async () => {
    await expect(workspace.writeFile('agents.json', { agents: [{ id: 'a1' }] })).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it('accepts a valid agents.json payload and it round-trips', async () => {
    const payload = {
      agents: [
        {
          id: 'a2',
          name: 'B',
          role: 'r',
          iconId: 'icon-02.svg',
          status: 'active',
          lastUpdated: '2026-01-02T00:00:00Z',
        },
      ],
    };
    await workspace.writeFile('agents.json', payload);
    const result = await workspace.readFile('agents.json');
    expect(result.data).toEqual(payload);
  });

  it('rejects a non-string payload for a non-JSON file', async () => {
    await expect(workspace.writeFile('docs/hello.md', { not: 'a string' })).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it('writes raw text for a non-JSON file', async () => {
    await workspace.writeFile('docs/hello.md', '# updated\n');
    const result = await workspace.readFile('docs/hello.md');
    expect(result).toEqual({ kind: 'text', data: '# updated\n' });
  });
});

describe('Workspace.writeFile atomicity', () => {
  it('leaves no temp file behind on success', async () => {
    await workspace.writeFile('docs/hello.md', '# atomic\n');
    const entries = await readdir(path.join(root, 'docs'));
    for (const entry of entries) {
      expect(entry.endsWith('.tmp')).toBe(false);
    }
  });

  it('creates parent directories as needed', async () => {
    await workspace.writeFile('flows/new-flow.json', {
      id: 'new-flow',
      name: 'New flow',
      steps: [],
      edges: [],
    });
    const raw = await readFile(path.join(root, 'flows', 'new-flow.json'), 'utf8');
    expect(JSON.parse(raw).id).toBe('new-flow');
  });
});

describe('Workspace.deleteFile', () => {
  it('deletes an existing file', async () => {
    await workspace.deleteFile('docs/hello.md');
    await expect(workspace.readFile('docs/hello.md')).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('throws WorkspaceNotFoundError for a missing file', async () => {
    await expect(workspace.deleteFile('docs/does-not-exist.md')).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });
});

describe('Workspace.listTree', () => {
  it('lists every file recursively with paths + mtimes', async () => {
    const tree = await workspace.listTree();
    const paths = tree.map((entry) => entry.path).sort();
    expect(paths).toEqual(['agents.json', 'docs/hello.md']);
    for (const entry of tree) {
      expect(typeof entry.mtimeMs).toBe('number');
    }
  });
});

describe('computeRev', () => {
  it('changes when the file content changes', async () => {
    const before = await computeRev(root, 'agents.json');
    await writeFile(path.join(root, 'agents.json'), JSON.stringify({ agents: [] }));
    const after = await computeRev(root, 'agents.json');
    expect(after).not.toBe(before);
  });

  it('returns a rev even for a file that does not exist', async () => {
    const rev = await computeRev(root, 'nope.json');
    expect(typeof rev).toBe('string');
    expect(rev.length).toBeGreaterThan(0);
  });
});

describe('resolveWorkspaceRoot', () => {
  it('falls back to the repo-root default when WORKSPACE_DIR is unset', () => {
    const resolved = resolveWorkspaceRoot({});
    expect(resolved.endsWith(`${path.sep}workspace`)).toBe(true);
  });

  it('resolves a relative WORKSPACE_DIR against process.cwd()', () => {
    const resolved = resolveWorkspaceRoot({ WORKSPACE_DIR: 'my-workspace' });
    expect(resolved).toBe(path.resolve(process.cwd(), 'my-workspace'));
  });

  it('uses an absolute WORKSPACE_DIR as-is', () => {
    const resolved = resolveWorkspaceRoot({ WORKSPACE_DIR: '/tmp/some-workspace' });
    expect(resolved).toBe('/tmp/some-workspace');
  });
});

describe('Workspace.ensureInitialized', () => {
  it('copies workspace.example/ into a missing root', async () => {
    const freshRoot = path.join(await mkdtemp(path.join(tmpdir(), 'agent-dashboard-fresh-')), 'workspace');
    const exampleDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-example-'));
    await writeFile(path.join(exampleDir, 'config.json'), '{"seeded": true}');

    const fresh = new Workspace(freshRoot);
    await fresh.ensureInitialized(exampleDir);

    const raw = await readFile(path.join(freshRoot, 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ seeded: true });

    await rm(path.dirname(freshRoot), { recursive: true, force: true });
    await rm(exampleDir, { recursive: true, force: true });
  });

  it('does nothing if the root already exists', async () => {
    await workspace.ensureInitialized('/nonexistent-example-dir-should-not-be-read');
    const result = await workspace.readFile('agents.json');
    expect(result.kind).toBe('json');
  });
});
