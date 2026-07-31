import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SprintsFileSchema } from './sprints.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/sprints.json', import.meta.url));

describe('SprintsFileSchema', () => {
  it('validates the example sprints.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(SprintsFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects an invalid task status', () => {
    const result = SprintsFileSchema.safeParse({
      current: { name: 'Sprint', startsOn: '2026-01-01', endsOn: '2026-01-14' },
      tasks: [{ id: 't1', title: 'Task', status: 'review', order: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO-date startsOn', () => {
    const result = SprintsFileSchema.safeParse({
      current: { name: 'Sprint', startsOn: 'Jan 1', endsOn: '2026-01-14' },
      tasks: [],
    });
    expect(result.success).toBe(false);
  });
});
