// Smoke test for the Skill Trees panel (PLAN.md §8 item 8 / §11 Phase 5).
// The force-graph/click-to-detail test is read-only (no on-disk fixture
// restore needed, same as generations.spec.ts's precedent); the Scan test
// below does mutate workspace/config.json + workspace/skills.json on disk
// (via a real click -> real POST /api/scan/skills -> real write), so it
// restores both in a finally block, matching sprints.spec.ts's convention.
// Waits for the d3-force simulation to settle (nodes stop moving) before
// clicking, since Chromium won't register a click on an SVG element that's
// still animating under it.
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'workspace', 'config.json');
const SKILLS_PATH = path.join(REPO_ROOT, 'workspace', 'skills.json');

async function waitForGraphSettled(page: Page): Promise<void> {
  const firstNode = page.locator('.skill-node').first();
  let previous: string | null = null;
  for (let i = 0; i < 20; i++) {
    const current = await firstNode.getAttribute('transform');
    if (current !== null && current === previous) return;
    previous = current;
    await page.waitForTimeout(300);
  }
}

test('skill trees panel renders the force graph and shows real detail on click', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Skill Trees' }).click();

  // workspace.example/skills.json's 12 nodes (3 categories + 9 skills, PLAN.md §4/DECISIONS.md).
  await expect(page.locator('.skill-node')).toHaveCount(12);
  await expect(page.locator('.skill-graph__edge')).toHaveCount(10);

  await waitForGraphSettled(page);

  // Core interaction: click a leaf skill node, confirm the drawer shows its *real*
  // description/source text from skills.json (not a placeholder), then close it.
  const tddNode = page.locator('.skill-node[data-skill-id="skill-tdd"]');
  await tddNode.locator('circle').click();

  const drawer = page.locator('.skill-detail-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'tdd' })).toBeVisible();
  await expect(drawer.getByText('Test-driven development workflow')).toBeVisible();
  await expect(drawer.getByText('cat-coding')).toBeVisible();
  await expect(drawer.getByText('scan')).toBeVisible();

  await drawer.locator('.skill-detail-drawer__header button').click();
  await expect(drawer).toHaveCount(0);

  // A second node with a different description proves it's not just always showing the first
  // node's data.
  const writingNode = page.locator('.skill-node[data-skill-id="skill-watch-n-report"]');
  await writingNode.locator('circle').click();
  await expect(
    page.locator('.skill-detail-drawer').getByText('Watch a video and write an exhaustive report'),
  ).toBeVisible();
  // This one is manually authored, not scanned (PLAN.md §8 item 8: "merge, don't clobber, any
  // hand-added nodes (source: 'manual')").
  await expect(page.locator('.skill-detail-drawer').getByText('manual', { exact: true })).toBeVisible();

  // Closing via the backdrop also works.
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.skill-detail-drawer')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('Scan button walks a configured skill root and merges with (does not clobber) manual nodes', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const originalConfig = await readFile(CONFIG_PATH, 'utf8');
  const originalSkills = await readFile(SKILLS_PATH, 'utf8');

  // A small fixture skill root under the OS temp dir (not the real ~/.claude/skills etc., which
  // may or may not exist in the test-running environment, and not workspace/, to avoid spamming
  // the chokidar watcher with an unrelated subtree) — two skill dirs with real SKILL.md
  // frontmatter, plus one dir with no SKILL.md that must be skipped.
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-e2e-skill-root-'));

  async function writeSkill(dirName: string, name: string, description: string): Promise<void> {
    const dir = path.join(fixtureRoot, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    );
  }

  try {
    await writeSkill('alpha-skill', 'alpha-skill', 'First fixture skill for the e2e scan test.');
    await writeSkill('beta-skill', 'beta-skill', 'Second fixture skill for the e2e scan test.');
    await mkdir(path.join(fixtureRoot, 'not-a-skill'), { recursive: true }); // no SKILL.md — must be skipped

    const config = JSON.parse(originalConfig) as Record<string, unknown>;
    config.skillRoots = [fixtureRoot];
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');

    await page.goto('/');
    await page.getByRole('button', { name: 'Skill Trees' }).click();
    await expect(page.locator('.skill-node')).toHaveCount(12); // unchanged until Scan is clicked

    const scanButton = page.getByRole('button', { name: 'Scan', exact: true });
    await expect(scanButton).toBeVisible();
    await scanButton.click();

    // Real request, real server-side walk + write, real on-disk skills.json read-back — not a
    // mocked network intercept. Merge result: 1 pre-existing manual node ("skill-watch-n-report")
    // survives + 1 fresh root node + 2 fresh skill nodes from the fixture = 4 total; the fixture's
    // 2 root->skill edges are the only edges left (the manual node's old edge pointed at a
    // now-gone scanned category node, so it doesn't survive — both endpoints must still resolve).
    await expect(page.locator('.skill-node')).toHaveCount(4);
    await expect(page.locator('.skill-graph__edge')).toHaveCount(2);
    await expect(scanButton).toHaveText('Scan');

    await waitForGraphSettled(page);

    // The manual node survived the merge, untouched.
    const manualNode = page.locator('.skill-node[data-skill-id="skill-watch-n-report"]');
    await expect(manualNode).toHaveCount(1);

    // A freshly scanned node shows the *real* frontmatter description (not a directory-name
    // fallback) and source: 'scanned'.
    const alphaNode = page.locator('.skill-node').filter({ hasText: 'alpha-skill' });
    await expect(alphaNode).toHaveCount(1);
    await alphaNode.locator('circle').click();
    const drawer = page.locator('.skill-detail-drawer');
    await expect(drawer.getByRole('heading', { name: 'alpha-skill' })).toBeVisible();
    await expect(drawer.getByText('First fixture skill for the e2e scan test.')).toBeVisible();
    await expect(drawer.getByText('scanned', { exact: true })).toBeVisible();
    await drawer.locator('.skill-detail-drawer__header button').click();

    // Real on-disk read-back (not just the DOM) — skills.json was actually rewritten.
    const onDisk = JSON.parse(await readFile(SKILLS_PATH, 'utf8')) as {
      nodes: Array<{ id: string; label: string; source?: string }>;
      edges: unknown[];
      scannedAt?: string;
    };
    expect(onDisk.nodes).toHaveLength(4);
    expect(onDisk.nodes.find((n) => n.id === 'skill-watch-n-report')?.source).toBe('manual');
    expect(onDisk.nodes.filter((n) => n.source === 'scanned')).toHaveLength(3); // root + 2 skills
    expect(onDisk.scannedAt).toBeTruthy();

    expect(consoleErrors).toEqual([]);
  } finally {
    await writeFile(CONFIG_PATH, originalConfig, 'utf8');
    await writeFile(SKILLS_PATH, originalSkills, 'utf8');
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
