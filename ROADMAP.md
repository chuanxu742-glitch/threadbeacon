# ThreadBeacon Roadmap

This file is the source of truth for unfinished product validation. A checked item must have reproducible evidence in tests, CI, or a documented manual run.

## Completed baseline

- [x] Native PostgreSQL + MinIO + Spring Boot + Worker + Vite startup.
- [x] Worker registration, source test, record persistence, report storage, search, JSON/CSV export, and job trace.
- [x] Studio project/source creation and source-test lifecycle (`testing` → `active` or `error`).
- [x] Skill draft creation and publication.
- [x] TypeScript tests, Java tests, typecheck, lint, and production web build in `pnpm check`.

## P0 — core local product

- [x] Add a documented one-command native startup path and prerequisite checks; Docker remains optional.
- [ ] Validate a full collection → clustering → LLM analysis → evidence report run with an external model credential.
- [x] Validate interval and Cron schedules: create, immediate run, pause, resume, and restart recovery.
- [x] Validate workflow draft, publish, run, checkpoints, source merge, gate behavior, and finalization.
- [x] Replace raw JSON parse errors on unauthenticated API responses with a clear login/authorization state.

## P1 — governed integrations

- [ ] Validate browser Profile attestation and a real CDP session: open, navigate, snapshot, click/type, screenshot, and close; cover browser-login OpenCLI adapters for Bilibili, Zhihu, Weibo, X, and LinkedIn.
- [x] Validate Skill execution, confirmation, correction proposal, rollback, lease expiry, and restart recovery.
- [x] Validate personal API tokens and MCP tools, including scope enforcement and revocation.
- [x] Validate webhook triggers and delivery rules with retry/failure audit records.
- [x] Validate workspace invitations and owner/editor/viewer authorization boundaries.
- [ ] Validate GEO official-site submission, SSRF/robots enforcement, trace artifacts, cancel, and idempotency.
- [ ] Validate RSS, REST, and public-web source cursors and failure recovery.
  - [x] REST: real public-IP collection plus retry exhaustion, recovery, and persisted-cursor reuse.
  - [ ] RSS: retry exhaustion and control-plane cursor reuse passed; real fetch is blocked by this host's reserved-range DNS proxy.
  - [ ] Public web: retry exhaustion passed; real fetch/robots acceptance is blocked by the same DNS proxy.
- [x] Add Reddit comment collection and Jetstream DID-to-handle enrichment.
- [x] Add the authenticated creator-owned `fetchOwned` API with explicit scope and audit records.
- [ ] Execute imported Dify code/tool/plugin nodes in an isolated sandbox before declaring them supported.
  - [x] Fail closed at import and workflow publication; arbitrary nodes never execute in the Java/Node process.
  - [ ] Provision and attest a real isolated runtime before enabling these node types (no container runtime is installed on this host).

## P2 — deployment and open-source release

- [ ] Run the complete Docker Compose acceptance suite on a Docker-enabled host.
- [ ] Publish Docker Buildx images for amd64 and arm64 and verify recovery on both architectures.
- [x] Validate Gateway dispatch and agent reconnect behavior; keep single-Gateway scope until external coordination is required.
- [ ] Validate cluster manifests, network policies, secrets, health probes, and rolling updates.
- [ ] Document and test PostgreSQL/MinIO backup, restore, multi-replica, high-availability, and rolling-upgrade procedures.
  - [x] Native logical PostgreSQL + MinIO backup, checksum verification, isolated restore, and cleanup.
  - [x] Document Compose/cluster HA boundaries and rolling-upgrade procedure.
  - [ ] Exercise multi-replica and rolling upgrade on a real Docker/Kubernetes environment.
- [ ] Run credentialed provider smoke tests for each documented provider without committing secrets.
- [x] Review the public platform catalog against the documented supported/excluded sources.
- [x] Complete release documentation: native quickstart, architecture limits, compatibility matrix, and troubleshooting.

## Ponytail cleanup queue

- [x] Replace the one-call `ml-distance` dependency with the local cosine calculation.
- [x] Reuse browser allowlist normalization/matching instead of maintaining two implementations.
- [x] Remove unused proxy/export helpers.
- [x] Delete the unusable direct `BlueskyProvider`; keep the registered Jetstream runtime path.
- [x] Collapse the single-implementation `GatewayCoordination` interface only if multi-Gateway coordination remains out of scope.
