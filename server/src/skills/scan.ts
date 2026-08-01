// Skill-directory scanner (PLAN.md §5 `POST /api/scan/skills`, §8 item 8's "Scan" button).
// Walks each configured root one level deep, reads every `<dir>/SKILL.md`'s frontmatter, and
// builds a fresh root->skill graph, then merges it against any existing `source: 'manual'`
// nodes (kept as-is) — see DECISIONS.md "Phase 5 — Panels (part 4)" for the exact reading of
// §8's "groups by parent dir... edges: root -> category -> skill" wording against every real
// skill root's actual on-disk shape (flat: root/<skill-dir>/SKILL.md, no deeper nesting), which
// is why each root doubles as its own single category node here rather than a separate tier.
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SkillEdge, SkillNode, SkillsFile } from '@agent-dashboard/shared';
import { parseSkillFrontmatter } from './frontmatter.ts';

export const DEFAULT_SKILL_ROOTS = ['~/.claude/skills', '~/.pi/agent/skills', '~/.agents/skills'];

/** Expand a leading `~` (or `~/...`) against the real home directory; anything else is returned as-is. */
export function expandHome(root: string): string {
  if (root === '~') return homedir();
  if (root.startsWith('~/')) return path.join(homedir(), root.slice(2));
  return root;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'x';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function friendlyRootLabel(absRoot: string): string {
  const home = homedir();
  if (absRoot === home) return '~';
  if (absRoot.startsWith(home + path.sep)) return `~${absRoot.slice(home.length)}`;
  return absRoot;
}

/** Scan one configured root. Returns `null` if the root doesn't exist (skipped silently, per
 *  PLAN.md §8 item 8 — these are optional, environment-dependent directories). */
async function scanRoot(root: string): Promise<{ nodes: SkillNode[]; edges: SkillEdge[] } | null> {
  const absRoot = expandHome(root);
  if (!(await pathExists(absRoot))) return null;

  const rootId = `root-${slugify(absRoot)}`;
  const rootNode: SkillNode = {
    id: rootId,
    label: friendlyRootLabel(absRoot),
    category: 'root',
    source: 'scanned',
  };

  const nodes: SkillNode[] = [rootNode];
  const edges: SkillEdge[] = [];

  let entries;
  try {
    entries = await readdir(absRoot, { withFileTypes: true });
  } catch {
    // Exists but unreadable (permissions/race) — report the empty root rather than failing
    // the whole scan over one unreadable directory.
    return { nodes, edges };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(absRoot, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!(await pathExists(skillMdPath))) continue; // not a skill directory (this repo's own convention)

    let frontmatter: { name?: string; description?: string } = {};
    try {
      frontmatter = parseSkillFrontmatter(await readFile(skillMdPath, 'utf8'));
    } catch {
      // unreadable SKILL.md — still list the skill by directory name, just without a description
    }

    const skillId = `skill-${slugify(absRoot)}-${slugify(entry.name)}`;
    nodes.push({
      id: skillId,
      label: frontmatter.name?.trim() || entry.name,
      category: rootId,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      source: 'scanned',
    });
    edges.push({ from: rootId, to: skillId });
  }

  return { nodes, edges };
}

export interface ScanSkillsOptions {
  /** Roots to walk; defaults to DEFAULT_SKILL_ROOTS when omitted or empty. */
  roots?: string[];
  /** Existing skills.json contents, if any, for the manual-node-preserving merge. */
  existing?: SkillsFile;
}

export interface ScanSkillsResult {
  file: SkillsFile;
  rootsScanned: string[];
  rootsSkipped: string[];
}

/**
 * Walk the configured roots and merge the result into `existing` (PLAN.md §8 item 8: "Merge,
 * don't clobber, any hand-added nodes (source: 'manual')"). Every existing `source === 'manual'`
 * node is kept verbatim; every other existing node/edge is replaced by the fresh scan, except an
 * existing edge is also kept if both its endpoints still resolve in the merged node set (a
 * manual node or a freshly-scanned one) and it isn't already produced by this scan — e.g. a
 * user-drawn edge from a manual node to a scanned category/skill node survives a re-scan.
 */
export async function scanSkills(options: ScanSkillsOptions = {}): Promise<ScanSkillsResult> {
  const roots = options.roots && options.roots.length > 0 ? options.roots : DEFAULT_SKILL_ROOTS;

  const scanNodes: SkillNode[] = [];
  const scanEdges: SkillEdge[] = [];
  const rootsScanned: string[] = [];
  const rootsSkipped: string[] = [];

  for (const root of roots) {
    const result = await scanRoot(root);
    if (!result) {
      rootsSkipped.push(root);
      continue;
    }
    rootsScanned.push(root);
    scanNodes.push(...result.nodes);
    scanEdges.push(...result.edges);
  }

  const existing = options.existing ?? { nodes: [], edges: [] };
  const manualNodes = existing.nodes.filter((n) => n.source === 'manual');

  const finalNodes = [...manualNodes, ...scanNodes];
  const survivingIds = new Set(finalNodes.map((n) => n.id));
  const scanEdgeKeys = new Set(scanEdges.map((e) => `${e.from}->${e.to}`));
  const keptExistingEdges = existing.edges.filter(
    (e) => survivingIds.has(e.from) && survivingIds.has(e.to) && !scanEdgeKeys.has(`${e.from}->${e.to}`),
  );
  const finalEdges = [...scanEdges, ...keptExistingEdges];

  return {
    file: { nodes: finalNodes, edges: finalEdges, scannedAt: new Date().toISOString() },
    rootsScanned,
    rootsSkipped,
  };
}
