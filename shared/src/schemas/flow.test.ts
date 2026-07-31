import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FlowSchema } from './flow.ts';

const examples = ['deploy-pipeline.json', 'research-to-report.json'];

describe('FlowSchema', () => {
  for (const name of examples) {
    it(`validates the example flows/${name}`, () => {
      const examplePath = fileURLToPath(new URL(`../../../workspace.example/flows/${name}`, import.meta.url));
      const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
      expect(FlowSchema.safeParse(doc).success).toBe(true);
    });
  }

  it('rejects a step with an invalid status', () => {
    const result = FlowSchema.safeParse({
      id: 'f1',
      name: 'Flow',
      steps: [{ id: 's1', label: 'Step', status: 'in-progress' }],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an edge missing "to"', () => {
    const result = FlowSchema.safeParse({
      id: 'f1',
      name: 'Flow',
      steps: [{ id: 's1', label: 'Step', status: 'pending' }],
      edges: [{ from: 's1' }],
    });
    expect(result.success).toBe(false);
  });
});
