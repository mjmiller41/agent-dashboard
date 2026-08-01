// One-time first-party OAuth consent modal (PLAN.md §6a bullet 1 — exact
// required copy). Shown before any `firstParty: true` OAuth flow starts;
// acceptance is persisted once via useConsent and never asked again.
const VENDOR_CLI_NAMES: Record<string, string> = {
  anthropic: 'Claude Code',
  openai: 'Codex CLI',
  google: 'Gemini CLI',
};

export interface ConsentModalProps {
  providerId: string;
  providerName: string;
  onAccept: () => void;
  onClose: () => void;
}

export function ConsentModal({ providerId, providerName, onAccept, onClose }: ConsentModalProps) {
  const vendorCli = VENDOR_CLI_NAMES[providerId] ?? `${providerName}'s CLI`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="consent-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Before connecting {providerName}</h2>
        <p className="consent-modal__copy">
          This signs in using {vendorCli}&rsquo;s credentials. It is not an officially supported integration
          and could stop working or affect your account. API-key setup is the supported alternative.
        </p>
        {providerId === 'google' && (
          <p className="consent-modal__copy consent-modal__copy--warning">
            Google in particular has stated it detects and restricts third-party use of this flow — this is
            the highest policy-risk connection option in this app.
          </p>
        )}
        <div className="consent-modal__actions">
          <button type="button" className="consent-modal__cancel" onClick={onClose}>
            Cancel — use an API key instead
          </button>
          <button type="button" className="consent-modal__accept" onClick={onAccept}>
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
