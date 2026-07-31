# Runbook: deploy pipeline

Paired with the `flows/deploy-pipeline.json` example flow.

1. `checkout` — fetch the merged commit.
2. `install` — install dependencies.
3. `test` — run the full test suite.
4. `build` — produce a production build.
5. `deploy` — ship it. If this step fails (as in the example run), check the
   deploy target's reachability before retrying.
