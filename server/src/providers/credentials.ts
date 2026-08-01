// Encrypted credential store: ~/.agent-dashboard/credentials.json (PLAN.md
// §6a "Credential store"). Values are encrypted at rest with AES-256-GCM
// using a key derived (scrypt) from a machine-local secret file
// (~/.agent-dashboard/keyfile, random 32 bytes, mode 0600, created on first
// run). This is obfuscation-plus-file-permissions, not perfect secrecy —
// see README security notes. Never log secrets; never return them from any
// API response (routes/providers.ts only ever sends {connected, method,
// maskedKey}).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_APP_DATA_DIR = path.join(os.homedir(), '.agent-dashboard');

/**
 * Resolve the app data directory: `AGENT_DASHBOARD_HOME` env var if set
 * (absolute as-is, relative resolved against `process.cwd()`), else
 * `~/.agent-dashboard`. Mirrors workspace.ts's `resolveWorkspaceRoot`
 * convention so tests can isolate this from the real home directory.
 */
export function resolveAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AGENT_DASHBOARD_HOME;
  if (!configured) return DEFAULT_APP_DATA_DIR;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export type CredentialMethod = 'oauth' | 'api-key';

/** The secret material for one provider's connection. Never sent over the wire as-is. */
export interface CredentialSecret {
  apiKey?: string | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  /** Epoch ms; only meaningful for oauth credentials that expire. */
  expiresAt?: number | undefined;
  baseUrl?: string | undefined;
  /** Provider-specific extras (e.g. Copilot's cached short-lived token, OpenAI's chatgpt-account-id). */
  extra?: Record<string, unknown> | undefined;
}

export interface StoredCredential extends CredentialSecret {
  method: CredentialMethod;
  connectedAt: string;
}

export interface CredentialSummary {
  method: CredentialMethod;
  connectedAt: string;
}

interface EncryptedBlob {
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface CredentialFileEntry {
  method: CredentialMethod;
  connectedAt: string;
  blob: EncryptedBlob;
}

type CredentialFile = Record<string, CredentialFileEntry>;

const SCRYPT_SALT = 'agent-dashboard:credentials:v1';
const KEY_LEN = 32;
const FILE_MODE = 0o600;

async function atomicWrite(targetPath: string, content: string | Buffer, mode: number): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${process.hrtime.bigint()}.tmp`,
  );
  await writeFile(tmpPath, content, { mode });
  await rename(tmpPath, targetPath);
}

/** Mask a secret for display: `sk-...ab12`-style, never the raw value. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

export class CredentialStore {
  private readonly dir: string;
  private readonly credentialsPath: string;
  private readonly keyfilePath: string;
  private keyPromise: Promise<Buffer> | null = null;
  /** Serializes read-modify-write ops so a concurrent refresh-persist and a manual
   *  disconnect can't race and lose an update. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(dir: string = DEFAULT_APP_DATA_DIR) {
    this.dir = dir;
    this.credentialsPath = path.join(dir, 'credentials.json');
    this.keyfilePath = path.join(dir, 'keyfile');
  }

  private async ensureKey(): Promise<Buffer> {
    this.keyPromise ??= this.loadOrCreateKey();
    return this.keyPromise;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    await mkdir(this.dir, { recursive: true });
    let secret: Buffer;
    if (existsSync(this.keyfilePath)) {
      secret = await readFile(this.keyfilePath);
    } else {
      secret = randomBytes(32);
      await atomicWrite(this.keyfilePath, secret, FILE_MODE);
    }
    return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  }

  private encrypt(key: Buffer, plaintext: string): EncryptedBlob {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(key: Buffer, blob: EncryptedBlob): string {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  private async loadFile(): Promise<CredentialFile> {
    if (!existsSync(this.credentialsPath)) return {};
    try {
      const raw = await readFile(this.credentialsPath, 'utf8');
      return JSON.parse(raw) as CredentialFile;
    } catch {
      return {};
    }
  }

  private async persistFile(file: CredentialFile): Promise<void> {
    await atomicWrite(this.credentialsPath, JSON.stringify(file, null, 2) + '\n', FILE_MODE);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(fn, fn);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async get(providerId: string): Promise<StoredCredential | null> {
    const key = await this.ensureKey();
    const file = await this.loadFile();
    const entry = file[providerId];
    if (!entry) return null;
    const secret = JSON.parse(this.decrypt(key, entry.blob)) as CredentialSecret;
    return { ...secret, method: entry.method, connectedAt: entry.connectedAt };
  }

  async set(
    providerId: string,
    method: CredentialMethod,
    secret: CredentialSecret,
    connectedAt: string = new Date().toISOString(),
  ): Promise<void> {
    await this.enqueue(async () => {
      const key = await this.ensureKey();
      const file = await this.loadFile();
      file[providerId] = { method, connectedAt, blob: this.encrypt(key, JSON.stringify(secret)) };
      await this.persistFile(file);
    });
  }

  /** Read-modify-write the secret for an existing connection (e.g. OAuth token refresh
   *  rotation, or caching a derived short-lived token like Copilot's). No-op if not connected. */
  async update(providerId: string, updater: (secret: CredentialSecret) => CredentialSecret): Promise<void> {
    await this.enqueue(async () => {
      const key = await this.ensureKey();
      const file = await this.loadFile();
      const entry = file[providerId];
      if (!entry) return;
      const current = JSON.parse(this.decrypt(key, entry.blob)) as CredentialSecret;
      const next = updater(current);
      file[providerId] = { ...entry, blob: this.encrypt(key, JSON.stringify(next)) };
      await this.persistFile(file);
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.loadFile();
      if (!(providerId in file)) return;
      delete file[providerId];
      await this.persistFile(file);
    });
  }

  async list(): Promise<Record<string, CredentialSummary>> {
    const file = await this.loadFile();
    const out: Record<string, CredentialSummary> = {};
    for (const [id, entry] of Object.entries(file)) {
      out[id] = { method: entry.method, connectedAt: entry.connectedAt };
    }
    return out;
  }
}
