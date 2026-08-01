// Singleton CredentialStore + SettingsStore used by the running server
// (app.ts routes), mirroring workspace-instance.ts's pattern. Route-level
// and unit tests should construct their own stores against a temp
// directory (`AGENT_DASHBOARD_HOME` / explicit `dir` constructor arg)
// instead of importing this module.
import { ChatHistoryStore } from './chat/history.ts';
import { CredentialStore, resolveAppDataDir } from './providers/credentials.ts';
import { SettingsStore } from './providers/settings.ts';

const appDataDir = resolveAppDataDir();

export const credentialStore = new CredentialStore(appDataDir);
export const settingsStore = new SettingsStore(appDataDir);
export const chatHistoryStore = new ChatHistoryStore(appDataDir);
