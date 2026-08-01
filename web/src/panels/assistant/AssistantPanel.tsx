// Assistant chat panel (PLAN.md §6 "Assistant panel"). Default export so
// React.lazy(() => import('./AssistantPanel')) works (App.tsx wires panelId
// 'assistant' to this, replacing PlaceholderPanel).
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ConfigSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { navigate } from '../../router';
import { ChatMessage } from './ChatMessage';
import { useChat } from './useChat';
import { useConnectedProviders } from './useConnectedProviders';
import type { ModelInfo } from './types';

export default function AssistantPanel() {
  const { providers, loading, error: providersError } = useConnectedProviders();
  const { data: config } = useWorkspaceFile('config.json', ConfigSchema);

  // `providerIdChoice` is only set once the user explicitly picks a
  // provider from the dropdown; until then, `providerId` derives the first
  // connected provider. Deriving it instead of syncing it via an effect+
  // setState avoids a synchronous-setState-in-effect (react-hooks lint).
  const [providerIdChoice, setProviderIdChoice] = useState<string | null>(null);
  const providerId = providerIdChoice ?? providers?.[0]?.id ?? null;

  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const model = modelChoice ?? models?.[0]?.id ?? null;

  const [workspaceTools, setWorkspaceTools] = useState(true);
  const [input, setInput] = useState('');

  const {
    messages,
    send,
    stop,
    streaming,
    error: chatError,
  } = useChat({ providerId, model, workspaceTools });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load the model list for whichever provider is currently selected.
  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    fetch(`/api/providers/${providerId}/models`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((body: { models: ModelInfo[] }) => {
        if (cancelled) return;
        setModels(body.models);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const providersTabId = useMemo(() => {
    const tab = config?.tabs.find((t) => t.panel === 'providers');
    return tab?.id ?? 'providers';
  }, [config]);

  if (loading) {
    return <p>Loading providers…</p>;
  }

  if (providersError) {
    return <EmptyState message={`Could not load providers: ${providersError}`} />;
  }

  if (!providers || providers.length === 0) {
    return (
      <EmptyState
        message="Connect a provider to start."
        actionLabel="Go to Providers"
        onAction={() => navigate(providersTabId)}
      />
    );
  }

  function submit(): void {
    const text = input.trim();
    if (!text || streaming || !providerId || !model) return;
    setInput('');
    void send(text);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="assistant-panel">
      <div className="assistant-panel__toolbar">
        <select
          className="assistant-panel__provider-select"
          value={providerId ?? ''}
          onChange={(event) => {
            setProviderIdChoice(event.target.value);
            setModelChoice(null);
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="assistant-panel__model-select"
          value={model ?? ''}
          onChange={(event) => setModelChoice(event.target.value)}
          disabled={!models || models.length === 0}
        >
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.id}
            </option>
          ))}
        </select>
        <label className="assistant-panel__tools-toggle">
          <input
            type="checkbox"
            checked={workspaceTools}
            onChange={(event) => setWorkspaceTools(event.target.checked)}
          />
          Workspace tools
        </label>
      </div>

      <div className="assistant-panel__scrollback" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="assistant-panel__hint">
            Ask the assistant to look at or edit your workspace — e.g. &ldquo;mark task X done&rdquo; or
            &ldquo;list the agents&rdquo;.
          </p>
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>

      {chatError && (
        <p className="assistant-panel__error" role="alert">
          {chatError}
        </p>
      )}

      <form className="assistant-panel__composer" onSubmit={handleSubmit}>
        <textarea
          className="assistant-panel__input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the assistant… (Enter to send, Shift+Enter for a newline)"
          rows={2}
        />
        {streaming ? (
          <button type="button" className="assistant-panel__stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || !providerId || !model}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
