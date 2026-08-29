# Provider enrichment implementation — 2026-08-29

- Reddit `includeComments` now calls the official OAuth comment-tree endpoint for each collected post, normalizes top-level
  comments and replies, retains post/comment parent IDs, and skips a disabled or inaccessible comment tree without losing
  the post. Each post is capped at 20 normalized comments and reply traversal is requested to depth 3.
- Bluesky Jetstream keeps the DID as the stable `authorId`, resolves the public profile handle through
  `app.bsky.actor.getProfile`, uses the handle for display and post URLs, caches one request per DID, and falls back to the
  DID when enrichment fails.
- `tests/sources.test.ts` and `tests/jetstream.test.ts` cover the new behavior without external credentials. The complete
  `pnpm check` suite passed.

Reddit remains marked as not credential-smoke-tested; this implementation evidence does not claim a real paid or
non-commercial Reddit API entitlement.
