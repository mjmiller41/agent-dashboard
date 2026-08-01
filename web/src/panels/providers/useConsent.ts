// First-party OAuth consent-modal acceptance (PLAN.md §6a bullet 1),
// persisted server-side at ~/.agent-dashboard/settings.json (the browser
// can't write there directly — see server/src/routes/providers.ts's
// GET/POST /api/providers/settings*).
import { useCallback, useEffect, useState } from 'react';

export function useFirstPartyConsent() {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch('/api/providers/settings')
      .then((res) => res.json())
      .then((body: { firstPartyConsentAccepted: boolean }) => setAccepted(body.firstPartyConsentAccepted))
      .catch(() => setAccepted(false));
  }, []);

  const accept = useCallback(async () => {
    const res = await fetch('/api/providers/settings/consent', { method: 'POST' });
    const body = (await res.json()) as { firstPartyConsentAccepted: boolean };
    setAccepted(body.firstPartyConsentAccepted);
  }, []);

  return { accepted, accept };
}
