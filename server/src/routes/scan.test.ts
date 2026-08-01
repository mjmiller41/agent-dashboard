import { Hono } from 'hono';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillsFile } from '@agent-dashboard/shared';
import { Workspace } from '../workspace.ts';
import { createScanRoutes } from './scan.ts';

interface ScanResponse {
  skills: SkillsFile;
  rootsScanned: string[];
  rootsSkipped: string[];
}

let workspaceRoot: string;
let fixtureRoot: string;
let app: Hono;

async function writeSkill(root: string, dirName: string, frontmatter: string): Promise<void> {
  const dir = path.join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${dirName}\n`);
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-scan-routes-ws-'));
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-scan-routes-fixture-'));

  const workspace = new Workspace(workspaceRoot);
  app = new Hono();
  app.route('/api/scan', createScanRoutes(workspace));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function writeConfig(skillRoots: string[]): Promise<void> {
  await writeFile(
    path.join(workspaceRoot, 'config.json'),
    JSON.stringify({
      title: 'Test',
      theme: { preset: 'dark', accent: '#7c5cff' },
      tabs: [],
      skillRoots,
    }),
  );
}

async function scan(): Promise<{ status: number; body: ScanResponse }> {
  const res = await app.request('/api/scan/skills', { method: 'POST' });
  return { status: res.status, body: (await res.json()) as ScanResponse };
}

describe('POST /api/scan/skills', () => {
  it('walks a fixture root and produces a root node + one skill node per SKILL.md dir', async () => {
    await writeSkill(fixtureRoot, 'tdd', 'name: tdd\ndescription: Test-driven development workflow.');
    await writeSkill(fixtureRoot, 'watch', 'name: watch\ndescription: Watch a video and report.');
    // A directory with no SKILL.md is not a skill — must be skipped.
    await mkdir(path.join(fixtureRoot, 'not-a-skill'), { recursive: true });
    await writeConfig([fixtureRoot]);

    const { status, body } = await scan();
    expect(status).toBe(200);
    expect(body.rootsScanned).toEqual([fixtureRoot]);
    expect(body.rootsSkipped).toEqual([]);

    const { nodes, edges } = body.skills;
    expect(nodes).toHaveLength(3); // 1 root node + 2 skills
    const rootNode = nodes.find((n) => n.category === 'root');
    expect(rootNode).toBeDefined();
    expect(rootNode?.source).toBe('scanned');

    const tddNode = nodes.find((n) => n.label === 'tdd');
    expect(tddNode).toBeDefined();
    expect(tddNode?.source).toBe('scanned');
    expect(tddNode?.category).toBe(rootNode?.id);

    const watchNode = nodes.find((n) => n.label === 'watch');
    expect(watchNode).toBeDefined();

    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ from: rootNode?.id, to: tddNode?.id });
    expect(edges).toContainEqual({ from: rootNode?.id, to: watchNode?.id });

    // Written to disk via workspace.writeFile, not just returned in the response.
    const onDisk = JSON.parse(await readFile(path.join(workspaceRoot, 'skills.json'), 'utf8')) as SkillsFile;
    expect(onDisk.nodes).toHaveLength(3);
    expect(onDisk.scannedAt).toBeDefined();
  });

  it('reads real frontmatter fields (name/description) from SKILL.md, falling back to the dir name', async () => {
    await writeSkill(
      fixtureRoot,
      'diagnosing-bugs',
      'name: diagnosing-bugs\ndescription: Hard bug diagnosis loop.',
    );
    // No `name` field at all — falls back to the directory name.
    await writeSkill(fixtureRoot, 'no-name-field', 'description: Has no name field.');
    await writeConfig([fixtureRoot]);

    const { body } = await scan();

    const diag = body.skills.nodes.find((n) => n.id.includes('diagnosing-bugs'));
    expect(diag?.label).toBe('diagnosing-bugs');
    expect(diag?.description).toBe('Hard bug diagnosis loop.');

    const noName = body.skills.nodes.find((n) => n.description === 'Has no name field.');
    expect(noName?.label).toBe('no-name-field');
  });

  it('skips a missing root silently instead of erroring', async () => {
    const missingRoot = path.join(fixtureRoot, 'does-not-exist');
    await writeSkill(fixtureRoot, 'tdd', 'name: tdd\ndescription: TDD.');
    await writeConfig([missingRoot, fixtureRoot]);

    const { status, body } = await scan();
    expect(status).toBe(200);
    expect(body.rootsSkipped).toEqual([missingRoot]);
    expect(body.rootsScanned).toEqual([fixtureRoot]);
  });

  it('re-scanning preserves a pre-seeded manual node while replacing scanned nodes/edges', async () => {
    await writeSkill(fixtureRoot, 'tdd', 'name: tdd\ndescription: TDD.');
    await writeConfig([fixtureRoot]);

    // Pre-seed skills.json with one manual node and one stale scanned node/edge from a
    // hypothetical prior scan that no longer matches the current fixture.
    const seeded: SkillsFile = {
      nodes: [
        { id: 'skill-manual-one', label: 'manual-one', category: 'root-old', source: 'manual' },
        { id: 'root-old', label: '~/.old/skills', category: 'root', source: 'scanned' },
        { id: 'skill-stale', label: 'stale', category: 'root-old', source: 'scanned' },
      ],
      edges: [
        { from: 'root-old', to: 'skill-manual-one' },
        { from: 'root-old', to: 'skill-stale' },
      ],
    };
    await writeFile(path.join(workspaceRoot, 'skills.json'), JSON.stringify(seeded));

    const { status, body } = await scan();
    expect(status).toBe(200);

    const ids = body.skills.nodes.map((n) => n.id);
    expect(ids).toContain('skill-manual-one'); // manual node survives verbatim
    expect(ids).not.toContain('root-old'); // stale scanned root node is replaced
    expect(ids).not.toContain('skill-stale'); // stale scanned skill node is replaced

    const manualNode = body.skills.nodes.find((n) => n.id === 'skill-manual-one');
    expect(manualNode?.source).toBe('manual');

    // The manual node's edge pointed at a now-gone scanned node, so it doesn't survive either
    // (both endpoints must still resolve) — but the fresh scan's own edges are present.
    expect(body.skills.edges).not.toContainEqual({ from: 'root-old', to: 'skill-manual-one' });
    const freshRoot = body.skills.nodes.find((n) => n.category === 'root');
    const freshTdd = body.skills.nodes.find((n) => n.label === 'tdd');
    expect(body.skills.edges).toContainEqual({ from: freshRoot?.id, to: freshTdd?.id });
  });

  it('an edge between a manual node and a still-resolving scanned node survives a re-scan', async () => {
    await writeSkill(fixtureRoot, 'tdd', 'name: tdd\ndescription: TDD.');
    await writeConfig([fixtureRoot]);

    // First scan to learn the real (deterministic) scanned root id.
    const first = await scan();
    const rootId = first.body.skills.nodes.find((n) => n.category === 'root')?.id;
    expect(rootId).toBeDefined();

    // Hand-add a manual node with an edge pointing at the real scanned root node id.
    const current = JSON.parse(await readFile(path.join(workspaceRoot, 'skills.json'), 'utf8')) as SkillsFile;
    current.nodes.push({ id: 'skill-hand-added', label: 'hand-added', category: rootId!, source: 'manual' });
    current.edges.push({ from: rootId!, to: 'skill-hand-added' });
    await writeFile(path.join(workspaceRoot, 'skills.json'), JSON.stringify(current));

    // Re-scan: the scanned root id is deterministic (derived from the fixture path), so it
    // resolves again and the manual edge should survive.
    const second = await scan();
    expect(second.body.skills.nodes.map((n) => n.id)).toContain('skill-hand-added');
    expect(second.body.skills.edges).toContainEqual({ from: rootId, to: 'skill-hand-added' });
  });
});
