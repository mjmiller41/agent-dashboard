import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from './config.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/config.json', import.meta.url));

describe('ConfigSchema', () => {
  it('validates the example config.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(ConfigSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects an unknown theme preset', () => {
    const result = ConfigSchema.safeParse({
      title: 'Dashboard',
      theme: { preset: 'neon', accent: '#fff' },
      tabs: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tab missing required fields', () => {
    const result = ConfigSchema.safeParse({
      title: 'Dashboard',
      theme: { preset: 'dark', accent: '#fff' },
      tabs: [{ id: 'agents', panel: 'agents' }],
    });
    expect(result.success).toBe(false);
  });
});
