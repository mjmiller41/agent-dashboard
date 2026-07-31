# Architecture overview

- **Server**: Hono on `127.0.0.1:4680`, file-first — all state lives under
  `workspace/` as JSON/Markdown, validated with zod on every write.
- **Frontend**: React 18 + Vite, a hash router, and a single
  `useWorkspaceFile` hook every panel uses for fetch + SSE subscribe + save.
- **Live updates**: chokidar watches `workspace/`, debounces changes 100ms,
  and broadcasts `{type: 'ws-change', path, rev}` over `/api/events` (SSE).
