import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStore, maskSecret } from './credentials.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-creds-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CredentialStore', () => {
  it('round-trips a secret through encrypt/decrypt', async () => {
    const store = new CredentialStore(dir);
    await store.set('anthropic', 'api-key', { apiKey: 'sk-ant-abc123' });
    const cred = await store.get('anthropic');
    expect(cred).not.toBeNull();
    expect(cred?.apiKey).toBe('sk-ant-abc123');
    expect(cred?.method).toBe('api-key');
  });

  it('never stores the secret in plaintext on disk', async () => {
    const store = new CredentialStore(dir);
    await store.set('openai', 'oauth', { accessToken: 'super-secret-access-token' });
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(dir, 'credentials.json'), 'utf8'),
    );
    expect(raw).not.toContain('super-secret-access-token');
  });

  it('creates credentials.json and keyfile with mode 0600', async () => {
    const store = new CredentialStore(dir);
    await store.set('google', 'api-key', { apiKey: 'AIzaFake' });

    const credStats = await stat(path.join(dir, 'credentials.json'));
    const keyStats = await stat(path.join(dir, 'keyfile'));
    expect(credStats.mode & 0o777).toBe(0o600);
    expect(keyStats.mode & 0o777).toBe(0o600);
  });

  it('reuses the same keyfile across store instances (decryptable across restarts)', async () => {
    const store1 = new CredentialStore(dir);
    await store1.set('openrouter', 'oauth', { apiKey: 'sk-or-v1-xyz' });

    const store2 = new CredentialStore(dir);
    const cred = await store2.get('openrouter');
    expect(cred?.apiKey).toBe('sk-or-v1-xyz');
  });

  it('update() rotates a refresh token and persists the new value', async () => {
    const store = new CredentialStore(dir);
    await store.set('anthropic', 'oauth', {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1000,
    });

    await store.update('anthropic', (secret) => ({
      ...secret,
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: 2000,
    }));

    const cred = await store.get('anthropic');
    expect(cred?.accessToken).toBe('access-2');
    expect(cred?.refreshToken).toBe('refresh-2');
    expect(cred?.expiresAt).toBe(2000);
  });

  it('update() is a no-op when the provider was never connected', async () => {
    const store = new CredentialStore(dir);
    await store.update('never-connected', (secret) => ({ ...secret, apiKey: 'should-not-appear' }));
    const cred = await store.get('never-connected');
    expect(cred).toBeNull();
  });

  it('serializes concurrent refresh-persist updates without losing either write', async () => {
    const store = new CredentialStore(dir);
    await store.set('anthropic', 'oauth', { accessToken: 'a0', refreshToken: 'r0' });

    await Promise.all([
      store.update('anthropic', (s) => ({ ...s, accessToken: 'a1' })),
      store.update('anthropic', (s) => ({ ...s, refreshToken: 'r1' })),
    ]);

    const cred = await store.get('anthropic');
    // Both concurrent updates must have applied (serialized, not lost) —
    // the final state has both new fields, not just one of them.
    expect(cred?.accessToken).toBe('a1');
    expect(cred?.refreshToken).toBe('r1');
  });

  it('delete() removes a stored credential', async () => {
    const store = new CredentialStore(dir);
    await store.set('ollama', 'api-key', { baseUrl: 'http://localhost:11434' });
    await store.delete('ollama');
    expect(await store.get('ollama')).toBeNull();
  });

  it('delete() is a no-op for an unknown provider (no throw)', async () => {
    const store = new CredentialStore(dir);
    await expect(store.delete('nope')).resolves.toBeUndefined();
  });

  it('list() returns method/connectedAt but never secret material', async () => {
    const store = new CredentialStore(dir);
    await store.set('openai', 'api-key', { apiKey: 'sk-should-not-leak' });
    const list = await store.list();
    expect(list.openai).toMatchObject({ method: 'api-key' });
    expect(JSON.stringify(list)).not.toContain('sk-should-not-leak');
  });

  it('get() returns null for a provider that was never connected', async () => {
    const store = new CredentialStore(dir);
    expect(await store.get('nope')).toBeNull();
  });

  it('creates the app data directory if it does not exist yet', async () => {
    const nested = path.join(dir, 'nested', 'app-data');
    expect(existsSync(nested)).toBe(false);
    const store = new CredentialStore(nested);
    await store.set('anthropic', 'api-key', { apiKey: 'sk-ant-x' });
    expect(existsSync(nested)).toBe(true);
  });
});

describe('maskSecret', () => {
  it('shows a short prefix/suffix and hides the middle', () => {
    expect(maskSecret('sk-or-v1-abcdef1234567890')).toBe('sk-…7890');
  });

  it('fully masks very short secrets', () => {
    expect(maskSecret('short')).toBe('••••');
  });
});
