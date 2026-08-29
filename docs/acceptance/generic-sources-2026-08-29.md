# Generic sources partial acceptance — 2026-08-29

This native Windows run exercised project sources through the Spring API and the real TypeScript Worker.

## Passed

- REST source URLs can use only the documented `{keyword}` and `{limit}` templates. Other placeholders, local URLs,
  and credential-bearing URLs remain rejected.
- A direct public-IP DNS-over-HTTPS JSON source completed on attempt 1, became `active`, wrote `last_success_at`, and
  retained a zero failure count.
- REST, RSS, and public-web jobs each exhausted all three attempts against domains that this host resolves into a
  reserved address, then changed the source to `error` and incremented `consecutive_failures` once.
- A controlled REST worker recovered the same failed source, changed it back to `active`, reset failures to zero, and
  saved an ETag cursor. The next source-test job contained that saved cursor, and completion advanced it to the next ETag.

## Still blocked

This host resolves external domains such as GitHub and Example Domain into `198.18.0.0/15`, a reserved benchmark range
used by its network proxy. `PinnedSafeTransport` correctly rejects that range to preserve DNS-pinning and SSRF safety.
Consequently a real domain-based RSS fetch and public-page robots/fetch success were not claimed. The parent roadmap item
remains unchecked, with per-source progress recorded in [`ROADMAP.md`](../../ROADMAP.md).
