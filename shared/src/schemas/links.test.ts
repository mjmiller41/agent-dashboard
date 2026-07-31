import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LinksFileSchema } from './links.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/links.json', import.meta.url));

describe('LinksFileSchema', () => {
  it('validates the example links.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(LinksFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a link with an invalid url', () => {
    const result = LinksFileSchema.safeParse({
      groups: [{ id: 'g1', title: 'Group', links: [{ title: 'Bad', url: 'not-a-url' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a group missing a title', () => {
    const result = LinksFileSchema.safeParse({
      groups: [{ id: 'g1', links: [] }],
    });
    expect(result.success).toBe(false);
  });
});
