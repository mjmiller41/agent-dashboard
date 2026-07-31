import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CronScheduleSchema, CronsFileSchema } from './crons.ts';

const examplePath = fileURLToPath(new URL('../../../workspace.example/crons.json', import.meta.url));

describe('CronsFileSchema', () => {
  it('validates the example crons.json', () => {
    const doc = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(CronsFileSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a job missing "enabled"', () => {
    const result = CronsFileSchema.safeParse({
      jobs: [{ id: 'j1', name: 'Job', schedule: '0 0 * * *' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a schedule with too few fields', () => {
    const result = CronsFileSchema.safeParse({
      jobs: [{ id: 'j1', name: 'Job', schedule: '0 0 *', enabled: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe('CronScheduleSchema', () => {
  it.each(['0 3 * * *', '*/5 * * * *', '0,30 9-17 * * 1-5', '0 0 1 */2 *'])(
    'accepts a valid 5-field expression: %s',
    (schedule) => {
      expect(CronScheduleSchema.safeParse(schedule).success).toBe(true);
    },
  );

  it.each(['not a cron', '* * * *', '60 * * * *invalid'])('rejects an invalid expression: %s', (schedule) => {
    expect(CronScheduleSchema.safeParse(schedule).success).toBe(false);
  });
});
