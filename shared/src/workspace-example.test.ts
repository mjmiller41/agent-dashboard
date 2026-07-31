// Walks workspace.example/ and validates every JSON file against its schema
// by filename convention (PLAN.md §11 Phase 1), and asserts the docs/icons
// counts the brief requires.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isUnvalidatedWorkspacePath, schemaForPath } from './schemas/registry.ts';

const ROOT = fileURLToPath(new URL('../../workspace.example', import.meta.url));

function walk(dir: string, base = ''): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walk(abs, rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

describe('workspace.example/', () => {
  const files = walk(ROOT);

  it('every JSON file validates against its schema-by-filename-convention', () => {
    const jsonFiles = files.filter((f: string) => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    for (const relPath of jsonFiles) {
      const schema = schemaForPath(relPath);
      expect(schema, `no schema registered for ${relPath}`).not.toBeNull();
      if (!schema) continue;
      const doc: unknown = JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf8'));
      const result = schema.safeParse(doc);
      if (!result.success) {
        throw new Error(
          `${relPath} failed schema validation: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
    }
  });

  it('docs/**/*.md and icons/*.svg are recognized as unvalidated (schema-free) paths', () => {
    const docsAndIcons = files.filter((f: string) => f.startsWith('docs/') || f.startsWith('icons/'));
    expect(docsAndIcons.length).toBeGreaterThan(0);
    for (const relPath of docsAndIcons) {
      expect(schemaForPath(relPath)).toBeNull();
      expect(isUnvalidatedWorkspacePath(relPath)).toBe(true);
    }
  });

  it('agents.json has exactly 4 agents', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'agents.json'), 'utf8'));
    expect(doc.agents).toHaveLength(4);
  });

  it('has exactly 2 flows, each with at least one recorded run', () => {
    const flowFiles = files.filter((f: string) => /^flows\/[^/]+\.json$/.test(f));
    expect(flowFiles).toHaveLength(2);
    for (const relPath of flowFiles) {
      const doc = JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf8')) as { runs?: unknown[] };
      expect(Array.isArray(doc.runs) && doc.runs.length).toBeGreaterThan(0);
    }
  });

  it('skills.json has exactly 12 nodes', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'skills.json'), 'utf8'));
    expect(doc.nodes).toHaveLength(12);
  });

  it('crons.json has exactly 5 jobs', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'crons.json'), 'utf8'));
    expect(doc.jobs).toHaveLength(5);
  });

  it('generations.json has exactly 8 items with mixed kinds', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'generations.json'), 'utf8')) as {
      items: Array<{ kind: string }>;
    };
    expect(doc.items).toHaveLength(8);
    const kinds = new Set(doc.items.map((i) => i.kind));
    expect(kinds.has('image')).toBe(true);
    expect(kinds.has('video')).toBe(true);
  });

  it('links.json has exactly 3 groups', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'links.json'), 'utf8'));
    expect(doc.groups).toHaveLength(3);
  });

  it('sprints.json has exactly 14 tasks across backlog/todo/doing/done', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'sprints.json'), 'utf8')) as {
      tasks: Array<{ status: string }>;
    };
    expect(doc.tasks).toHaveLength(14);
    const statuses = new Set(doc.tasks.map((t) => t.status));
    expect(statuses).toEqual(new Set(['backlog', 'todo', 'doing', 'done']));
  });

  it('has exactly 6 markdown docs under docs/', () => {
    const docFiles = files.filter((f: string) => f.startsWith('docs/') && f.endsWith('.md'));
    expect(docFiles).toHaveLength(6);
  });

  it('has at least 24 icon SVGs under icons/', () => {
    const iconFiles = files.filter((f: string) => f.startsWith('icons/') && f.endsWith('.svg'));
    expect(iconFiles.length).toBeGreaterThanOrEqual(24);
  });

  it('every generation item with a "path" points at a file that exists', () => {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'generations.json'), 'utf8')) as {
      items: Array<{ path?: string }>;
    };
    for (const item of doc.items) {
      if (item.path) {
        expect(() => statSync(path.join(ROOT, item.path!))).not.toThrow();
      }
    }
  });
});
