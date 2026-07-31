import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AgentsFileSchema } from './agents.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/agents.json', import.meta.url));

describe('AgentsFileSchema', () => {
  it('validates the example agents.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(AgentsFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects an invalid status', () => {
    const result = AgentsFileSchema.safeParse({
      agents: [
        {
          id: 'a1',
          name: 'A',
          role: 'r',
          iconId: 'icon-01.svg',
          status: 'sleeping',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO lastUpdated', () => {
    const result = AgentsFileSchema.safeParse({
      agents: [
        { id: 'a1', name: 'A', role: 'r', iconId: 'icon-01.svg', status: 'idle', lastUpdated: 'yesterday' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
