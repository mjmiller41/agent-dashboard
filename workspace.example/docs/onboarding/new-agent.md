# Onboarding a new agent

When a new coding agent starts working against this workspace:

1. Add yourself to `agents.json` with `status: "idle"`.
2. Flip to `status: "active"` and set `currentTask` when you pick up work.
3. Set `status: "idle"` or `"blocked"` (with a note) when you stop.
4. Never touch `~/.agent-dashboard/` — that's credentials, not workspace data.
