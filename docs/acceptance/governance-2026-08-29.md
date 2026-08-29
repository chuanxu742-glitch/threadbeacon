# Governed integrations acceptance — 2026-08-29

This run used the native Windows stack documented in
[`native-2026-08-29.md`](./native-2026-08-29.md). It used deterministic local workers and two isolated
local identities where an external provider was not relevant; no PAT, node token, invitation token, or endpoint secret
was written to this document.

## Results

- A governed Agent Skill paused a high-risk action for owner confirmation, resumed after approval, completed, produced
  a correction after three controlled failures, advanced from version 1 to version 2, rolled back to version 1, and
  recovered an expired lease on attempt 2. After a full API restart, the Skill still reported version 1, the rolled-back
  correction, and all five runs.
- A viewer PAT containing only `skills:read` received HTTP 200 from the Skill REST API and its MCP tool, HTTP 403 from
  the records REST API, and MCP error `-32003` from the records tool. An editor PAT with `workflows:run` and `runs:read`
  started a published workflow through MCP and read its run, while records remained HTTP 403. Revoked PATs immediately
  returned HTTP 401.
- A workflow webhook started a published workflow without session authentication, recorded `last_triggered_at`, and
  returned HTTP 404 after it was disabled.
- Delivery now records each attempt and retries only network failures, HTTP 408/429, and HTTP 5xx responses. A completed
  synthetic job sent to an unreachable public HTTPS hostname produced three ordered failure records with attempts
  `1, 2, 3`; the rule was disabled after the run.
- The owner could not invite their own email (HTTP 409). A second local identity accepted a viewer invitation, read the
  workspace (HTTP 200), and was denied writes (HTTP 403). After the owner promoted it to editor, the same write returned
  HTTP 201. The original owner remained owner throughout, and the temporary member was removed after acceptance.

## Verification

- `pnpm control:java:check` passed after adding the delivery retry migration and retry-policy test.
- `PostgresMigrationConformanceTest` applied all four Flyway migrations to an isolated PostgreSQL 17.11 database,
  exercised the governed Skill lifecycle, cleaned it, and the temporary database was dropped.
- `pnpm check` passed after the full acceptance run.

External OIDC provider discovery itself was not part of this run. The invitation and workspace-selection behavior used
the same authenticated identity fields and membership tables as OIDC, while avoiding external credentials.
