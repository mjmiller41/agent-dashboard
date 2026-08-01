#!/usr/bin/env node
// Generates SCHEMAS.md (repo root) from the actual shared/src/schemas/*.ts
// zod schemas — PLAN.md §4/§11 Phase 6: "a human-readable reference of
// every schema... generated content describing the CURRENT schemas, don't
// hand-copy stale descriptions." Re-run this after changing any workspace
// schema; SCHEMAS.md itself should never be hand-edited.
//
// Uses zod v4's built-in `z.toJSONSchema()` (no new dependency) to turn each
// exported schema into a JSON Schema, then walks that structure into a
// nested Markdown field list, and pairs it with one real example pulled
// directly from workspace.example/ (also read live, not hand-copied).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(REPO_ROOT, 'shared', 'src', 'schemas');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'workspace.example');
const OUT_PATH = path.join(REPO_ROOT, 'SCHEMAS.md');

/** One entry per workspace document type (PLAN.md §4). */
const DOCUMENTS = [
  {
    title: 'config.json',
    file: 'config.ts',
    exportName: 'ConfigSchema',
    workspacePath: 'config.json',
    examplePaths: ['config.json'],
    summary: 'Dashboard shell config: title, theme, and the tab strip.',
  },
  {
    title: 'agents.json',
    file: 'agents.ts',
    exportName: 'AgentsFileSchema',
    workspacePath: 'agents.json',
    examplePaths: ['agents.json'],
    summary: 'The agent roster shown by the Agents panel.',
  },
  {
    title: 'flows/<slug>.json',
    file: 'flow.ts',
    exportName: 'FlowSchema',
    workspacePath: 'flows/<slug>.json',
    examplePaths: ['flows/deploy-pipeline.json'],
    summary: 'One flow DAG per file, with optional recorded playback runs.',
  },
  {
    title: 'skills.json',
    file: 'skills.ts',
    exportName: 'SkillsFileSchema',
    workspacePath: 'skills.json',
    examplePaths: ['skills.json'],
    summary: 'The skill-tree graph (nodes + edges) behind the Skill Trees panel.',
  },
  {
    title: 'crons.json',
    file: 'crons.ts',
    exportName: 'CronsFileSchema',
    workspacePath: 'crons.json',
    examplePaths: ['crons.json'],
    summary:
      'The cron job list shown by the Crons panel (display-only — nothing here is actually scheduled/executed).',
  },
  {
    title: 'generations.json',
    file: 'generations.ts',
    exportName: 'GenerationsFileSchema',
    workspacePath: 'generations.json',
    examplePaths: ['generations.json'],
    summary: 'The image/video gallery shown by the Generations panel.',
  },
  {
    title: 'links.json',
    file: 'links.ts',
    exportName: 'LinksFileSchema',
    workspacePath: 'links.json',
    examplePaths: ['links.json'],
    summary: 'Bookmark groups shown by the Links panel.',
  },
  {
    title: 'sprints.json',
    file: 'sprints.ts',
    exportName: 'SprintsFileSchema',
    workspacePath: 'sprints.json',
    examplePaths: ['sprints.json'],
    summary: 'The current sprint + kanban tasks shown by the Sprints panel.',
  },
];

/** Special-cased human descriptions for constraints whose raw regex isn't worth printing. */
function describeFormat(node) {
  if (node.format === 'date-time') return 'ISO 8601 datetime string, with a required timezone offset';
  if (node.format === 'date') return 'ISO 8601 date string (`YYYY-MM-DD`)';
  if (node.format === 'uri') return 'a URL';
  return undefined;
}

function describePattern(node) {
  if (node.format) return undefined; // format-based patterns already covered by describeFormat
  if (!node.pattern) return undefined;
  if (node.pattern.length > 60) {
    return 'a constrained string — see the shared schema source for the exact pattern';
  }
  return `must match pattern \`${node.pattern}\``;
}

function typeLabel(node) {
  if (node.enum) return `enum (${node.enum.map((v) => `\`${v}\``).join(' | ')})`;
  if (node.type === 'array') return 'array';
  return node.type ?? 'unknown';
}

function constraintNotes(node) {
  const notes = [];
  const formatNote = describeFormat(node);
  if (formatNote) notes.push(formatNote);
  const patternNote = describePattern(node);
  if (patternNote) notes.push(patternNote);
  if (typeof node.minLength === 'number') notes.push(`min length ${node.minLength}`);
  if (typeof node.minimum === 'number') notes.push(`minimum ${node.minimum}`);
  return notes;
}

/** Recursively renders a JSON-Schema node as a nested Markdown bullet list. */
function renderNode(node, lines, indent) {
  const pad = '  '.repeat(indent);
  if (node.type === 'object') {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const isRequired = required.has(key);
      const notes = constraintNotes(child);
      const noteSuffix = notes.length > 0 ? ` — ${notes.join('; ')}` : '';
      lines.push(`${pad}- \`${key}\`${isRequired ? '' : ' (optional)'}: ${typeLabel(child)}${noteSuffix}`);
      if (child.type === 'object' || child.type === 'array') {
        renderNode(child, lines, indent + 1);
      }
    }
    return;
  }
  if (node.type === 'array') {
    const items = node.items;
    if (items && (items.type === 'object' || items.type === 'array')) {
      lines.push(`${pad}- each item:`);
      renderNode(items, lines, indent + 1);
    } else if (items) {
      const notes = constraintNotes(items);
      const noteSuffix = notes.length > 0 ? ` — ${notes.join('; ')}` : '';
      lines.push(`${pad}- each item: ${typeLabel(items)}${noteSuffix}`);
    }
  }
}

function renderDocument(doc) {
  const modulePath = path.join(SCHEMAS_DIR, doc.file);
  return import(modulePath.startsWith('/') ? `file://${modulePath}` : modulePath).then((mod) => {
    const schema = mod[doc.exportName];
    if (!schema) throw new Error(`${doc.file} does not export ${doc.exportName}`);
    const jsonSchema = z.toJSONSchema(schema);

    const lines = [];
    lines.push(`## \`${doc.title}\``);
    lines.push('');
    lines.push(doc.summary);
    lines.push('');
    lines.push(`Source: \`shared/src/schemas/${doc.file}\` (\`${doc.exportName}\`).`);
    lines.push('');
    lines.push('**Fields:**');
    lines.push('');
    const fieldLines = [];
    renderNode(jsonSchema, fieldLines, 0);
    lines.push(...fieldLines);
    lines.push('');

    for (const examplePath of doc.examplePaths) {
      const abs = path.join(EXAMPLE_DIR, examplePath);
      const content = readFileSync(abs, 'utf8').trimEnd();
      lines.push(`**Example** (\`workspace.example/${examplePath}\`):`);
      lines.push('');
      lines.push('```json');
      lines.push(content);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  });
}

const sections = await Promise.all(DOCUMENTS.map(renderDocument));

const header = `# Workspace file contracts

This file is **generated** from the zod schemas in \`shared/src/schemas/*.ts\` by
\`scripts/generate-schemas-md.mjs\` — do not hand-edit it; re-run the script after changing any
schema (\`node scripts/generate-schemas-md.mjs\`). Every workspace document is validated against
one of these schemas on write (\`server/src/workspace.ts\`, via the filename-convention lookup in
\`shared/src/schemas/registry.ts\`); a write that fails validation is rejected, and a read that
fails validation surfaces a per-panel error card instead of crashing (PLAN.md §4).

See \`AGENTS.md\` for the behavioral rules external coding agents should follow when editing these
files directly.

## Two workspace document kinds have no zod schema (by design)

- **\`docs/**/*.md\`** — free-form Markdown; the Docs panel lists the tree and renders whatever is
  there. No shape to validate beyond "valid UTF-8 text".
- **\`icons/*.svg\`** — the avatar gallery; any well-formed SVG file works. \`workspace.example/icons/\`
  ships pixel-art style examples generated by \`scripts/generate-example-icons.mjs\`.

Both are recognized (but intentionally left unvalidated) by
\`shared/src/schemas/registry.ts\`'s \`isUnvalidatedWorkspacePath\`.

`;

const body = sections.join('\n---\n\n');

writeFileSync(OUT_PATH, header + body + '\n', 'utf8');
console.log(`Wrote ${OUT_PATH}`);
console.log('Run `npx prettier --write SCHEMAS.md` next — this script does not self-format.');
