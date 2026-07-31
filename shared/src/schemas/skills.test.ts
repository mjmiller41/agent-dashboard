import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SkillsFileSchema } from './skills.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/skills.json', import.meta.url));

describe('SkillsFileSchema', () => {
  it('validates the example skills.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(SkillsFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a node missing a category', () => {
    const result = SkillsFileSchema.safeParse({
      nodes: [{ id: 'n1', label: 'Node' }],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-array edges field', () => {
    const result = SkillsFileSchema.safeParse({
      nodes: [{ id: 'n1', label: 'Node', category: 'c' }],
      edges: {},
    });
    expect(result.success).toBe(false);
  });
});
