import { describe, expect, it } from 'vitest';
import { app } from './app.ts';

describe('GET /api/health', () => {
  it('returns a 200 ok status payload', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});
