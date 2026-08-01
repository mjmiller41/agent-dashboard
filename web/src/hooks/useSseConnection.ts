// Exposes the SSE connection status (sse.ts's onSseConnectionChange) as a
// React hook, for the app shell's offline banner (PLAN.md §9). Kept in
// hooks/ alongside useWorkspaceFile/useRoute per this repo's existing
// convention of one small hook per cross-cutting concern.
import { useEffect, useState } from 'react';
import { onSseConnectionChange } from '../sse';

export function useSseConnection(): boolean {
  const [connected, setConnected] = useState(true);
  useEffect(() => onSseConnectionChange(setConnected), []);
  return connected;
}
