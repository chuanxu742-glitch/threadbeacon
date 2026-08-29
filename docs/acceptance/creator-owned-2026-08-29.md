# Creator-owned acquisition acceptance — 2026-08-29

- TypeScript tests dispatch an opaque grant only to a provider that declares `fetchOwned`; no LLM is constructed, and missing providers fail closed.
- The native API created an editor PAT with only `owned:fetch`, queued a YouTube creator-owned job, and read its sanitized status.
- PostgreSQL verification confirmed the raw grant was absent, `grantHandleEncrypted` was present, and exactly one `owned.fetch.queued` audit record referenced the job.
- A second editor PAT with only `records:read` received HTTP 403 from the same endpoint.
- No credentialed platform Provider was available, so the acceptance job correctly remained queued rather than pretending to collect creator data.
