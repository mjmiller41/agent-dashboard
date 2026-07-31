# Architecture decisions (example)

This is a stand-in for a real ADR log. See the repo root `DECISIONS.md` for
the actual running decisions log kept by the implementing agent.

- File-first over a database: agents can edit plain files without an API.
- SSE over WebSockets: one-way push is all the dashboard needs.
