import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE_NAME } from './index.ts';

describe('shared package harness', () => {
  it('exports a package name (proves the vitest harness runs)', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@agent-dashboard/shared');
  });
});
