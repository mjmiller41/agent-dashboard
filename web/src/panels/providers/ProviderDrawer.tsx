// Per-provider drawer (PLAN.md §6 "Provider setup UX"): OAuth connect
// button, API-key masked input + Test & Save, and — once connected — a
// model picker, Test, and Disconnect. First-party OAuth flows are gated by
// the one-time consent modal (PLAN.md §6a).
import { useCallback, useEffect, useState } from 'react';
import { ConsentModal } from './ConsentModal';
import { useFirstPartyConsent } from './useConsent';
import type { ModelInfo, ProviderSummary, ProviderTestResult } from './types';

export interface ProviderDrawerProps {
  provider: ProviderSummary;
  onClose: () => void;
  onChanged: () => void;
}

type DeviceCodeState = { userCode: string; verificationUri: string; expiresIn: number } | null;

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

export function ProviderDrawer({ provider, onClose, onChanged }: ProviderDrawerProps) {
  const { accepted, accept } = useFirstPartyConsent();
  const [showConsent, setShowConsent] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeState>(null);
  const [pasteAuthUrl, setPasteAuthUrl] = useState<string | null>(null);
  const [pastedValue, setPastedValue] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  // Per-provider state (testResult/deviceCode/etc.) resets automatically
  // because ProvidersPanel mounts this component with `key={provider.id}` —
  // no reset-effect needed; a fresh mount gives us that for free (and
  // avoids a synchronous setState-in-effect).
  useEffect(() => {
    if (!provider.connected) return;
    fetch(`/api/providers/${provider.id}/models`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((body: { models: ModelInfo[] }) => setModels(body.models))
      .catch(() => setModels(null));
  }, [provider.id, provider.connected]);

  const saveApiKey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/apikey`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...(baseUrl ? { baseUrl } : {}) }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { test: ProviderTestResult };
      setTestResult(body.test);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [provider.id, apiKey, baseUrl, onChanged]);

  const startOAuth = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/oauth/start`, { method: 'POST' });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as {
        kind: string;
        authUrl?: string;
        userCode?: string;
        verificationUri?: string;
        expiresIn?: number;
      };
      if (body.kind === 'device-code' && body.userCode && body.verificationUri) {
        setDeviceCode({
          userCode: body.userCode,
          verificationUri: body.verificationUri,
          expiresIn: body.expiresIn ?? 900,
        });
        return;
      }
      if (!body.authUrl) throw new Error('server did not return an authUrl');
      window.open(body.authUrl, '_blank', 'noopener,noreferrer');
      if (body.kind === 'pkce-code-paste') {
        setPasteAuthUrl(body.authUrl);
      }
      // pkce-loopback / pkce-fixed-port: nothing else to do here — the
      // callback completes server-side and a provider-change SSE event
      // (handled by useProviders) will flip `connected` once it lands.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [provider.id]);

  const connectClicked = useCallback(() => {
    if (provider.firstParty && !accepted) {
      setShowConsent(true);
      return;
    }
    void startOAuth();
  }, [provider.firstParty, accepted, startOAuth]);

  const submitPaste = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/oauth/paste`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pasted: pastedValue.trim() }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      setPasteAuthUrl(null);
      setPastedValue('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [provider.id, pastedValue, onChanged]);

  const runTest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/test`, { method: 'POST' });
      const body = (await res.json()) as ProviderTestResult;
      setTestResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [provider.id]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await parseError(res));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [provider.id, onChanged]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="provider-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="provider-drawer__header">
          <h2>{provider.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="provider-drawer__error">{error}</p>}

        {provider.connected ? (
          <section className="provider-drawer__section">
            <p className="provider-drawer__connected">
              Connected via {provider.method} {provider.maskedKey && <code>{provider.maskedKey}</code>}
            </p>
            {models && (
              <label className="provider-drawer__field">
                Default model
                <select>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="provider-drawer__actions">
              <button type="button" disabled={busy} onClick={() => void runTest()}>
                Test
              </button>
              <button
                type="button"
                disabled={busy}
                className="provider-drawer__disconnect"
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </div>
          </section>
        ) : (
          <>
            {provider.oauth && (
              <section className="provider-drawer__section">
                <h3>OAuth</h3>
                {deviceCode ? (
                  <div className="provider-drawer__device-code">
                    <p>
                      Go to{' '}
                      <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
                        {deviceCode.verificationUri}
                      </a>{' '}
                      and enter this code:
                    </p>
                    <code className="provider-drawer__user-code">{deviceCode.userCode}</code>
                    <p className="provider-drawer__hint">Waiting for you to authorize in the browser…</p>
                  </div>
                ) : pasteAuthUrl ? (
                  <div className="provider-drawer__paste">
                    <p>
                      A browser tab opened for sign-in. Copy the <code>code#state</code> string it shows and
                      paste it below.
                    </p>
                    <input
                      type="text"
                      value={pastedValue}
                      onChange={(event) => setPastedValue(event.target.value)}
                      placeholder="code#state"
                    />
                    <button type="button" disabled={busy || !pastedValue} onClick={() => void submitPaste()}>
                      Submit
                    </button>
                  </div>
                ) : (
                  <button type="button" disabled={busy} onClick={connectClicked}>
                    Connect with {provider.name}
                  </button>
                )}
              </section>
            )}

            {provider.apiKey && (
              <section className="provider-drawer__section">
                <h3>API key</h3>
                <label className="provider-drawer__field">
                  Key {provider.apiKey.optional ? '(optional)' : ''}
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={provider.apiKey.placeholder}
                  />
                </label>
                {provider.apiKey.baseUrlConfigurable && (
                  <label className="provider-drawer__field">
                    Base URL
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                )}
                <a
                  className="provider-drawer__help-link"
                  href={provider.apiKey.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Where do I get a key?
                </a>
                <button type="button" disabled={busy} onClick={() => void saveApiKey()}>
                  Test & Save
                </button>
              </section>
            )}
          </>
        )}

        {testResult && (
          <p
            className={
              testResult.ok
                ? 'provider-drawer__test provider-drawer__test--ok'
                : 'provider-drawer__test provider-drawer__test--fail'
            }
          >
            {testResult.ok
              ? `OK — ${testResult.latencyMs ?? '?'}ms${testResult.modelCount !== undefined ? `, ${testResult.modelCount} models` : ''}`
              : `Failed: ${testResult.message}`}
          </p>
        )}

        {showConsent && (
          <ConsentModal
            providerId={provider.id}
            providerName={provider.name}
            onClose={() => setShowConsent(false)}
            onAccept={() => {
              void accept().then(() => {
                setShowConsent(false);
                void startOAuth();
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
