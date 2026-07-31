import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GenerationsFileSchema } from './generations.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/generations.json', import.meta.url));

describe('GenerationsFileSchema', () => {
  it('validates the example generations.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(GenerationsFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects an invalid kind', () => {
    const result = GenerationsFileSchema.safeParse({
      items: [{ id: 'g1', createdAt: '2026-01-01T00:00:00Z', kind: 'audio', tags: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing tags array', () => {
    const result = GenerationsFileSchema.safeParse({
      items: [{ id: 'g1', createdAt: '2026-01-01T00:00:00Z', kind: 'image' }],
    });
    expect(result.success).toBe(false);
  });
});
