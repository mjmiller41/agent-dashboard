import type { ProviderSummary } from './types';

export interface ProviderCardProps {
  provider: ProviderSummary;
  onClick: () => void;
}

function authBadges(provider: ProviderSummary): string[] {
  const badges: string[] = [];
  if (provider.auth.includes('oauth-pkce') || provider.auth.includes('oauth-device')) badges.push('OAuth');
  if (provider.auth.includes('api-key')) badges.push('API key');
  return badges;
}

export function ProviderCard({ provider, onClick }: ProviderCardProps) {
  return (
    <button type="button" className="provider-card" onClick={onClick}>
      <div className={`provider-card__logo provider-card__logo--${provider.logoId}`} aria-hidden="true">
        {provider.name.slice(0, 1)}
      </div>
      <div className="provider-card__body">
        <div className="provider-card__name">
          {provider.name}
          {provider.recommended && <span className="provider-card__recommended">Recommended</span>}
        </div>
        <div className="provider-card__badges">
          {authBadges(provider).map((badge) => (
            <span key={badge} className="provider-card__badge">
              {badge}
            </span>
          ))}
          {provider.firstParty && (
            <span className="provider-card__badge provider-card__badge--warn">First-party</span>
          )}
        </div>
      </div>
      <div
        className={
          provider.connected
            ? 'provider-card__status provider-card__status--connected'
            : 'provider-card__status'
        }
      >
        {provider.connected ? 'Connected' : 'Not connected'}
      </div>
    </button>
  );
}
