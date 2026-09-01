# Social domain normalization and P0 capability boundary

This document defines the provider-independent social observation contract used by
the TypeScript Worker. It is a data contract and capability inventory; it is not a
platform authorization, a commercial-availability statement, or permission to
send an outbound action.

## Why this boundary exists

The provider layer already returns `RawObservation`/`SourceItem` and a `Provenance`.
Those types intentionally keep provider-specific fields. The social domain layer
(`src/providers/social.ts`) maps that pair into one stable envelope:

```text
provider response -> RawObservation/SourceItem -> TextBundle + Provenance
                  -> normalizeSocialObservation() -> social observation v1
```

`publishedAt` comes from the item (`postedAt` after `buildSourceItem`).
`observedAt` comes from `Provenance.fetchedAt`. They must not be collapsed into one
timestamp. `contentHash` and `observationId` are deterministic for the same source,
external ID and content snapshot. A changed snapshot therefore gets a new
observation ID and can be retained as an immutable historical observation by the
consumer.

## JSON contract

The recommended contract for a Java API observation ingest/detail payload is:

```json
{
  "schema": "threadbeacon.social.observation.v1",
  "observationId": "social_obs_<sha256>",
  "platform": "youtube",
  "contentType": "post",
  "externalId": "video-123",
  "canonicalUrl": "https://www.youtube.com/watch?v=video-123",
  "author": {
    "id": "UC123",
    "name": "Channel name",
    "url": "https://www.youtube.com/channel/UC123"
  },
  "text": "Title\n\nDescription",
  "title": "Title",
  "publishedAt": "2026-08-30T10:00:00.000Z",
  "observedAt": "2026-08-31T12:00:00.000Z",
  "engagement": {
    "likes": 7,
    "comments": 2,
    "shares": 1,
    "views": 800
  },
  "topics": ["research"],
  "tags": ["research"],
  "conversationId": "video-123",
  "sentiment": {
    "status": "pending"
  },
  "contentHash": "<sha256>",
  "source": {
    "providerId": "youtube-data-api-v3",
    "sourceId": "project-source-1",
    "observationId": "social_obs_<sha256>",
    "legalBasis": "platform/provider basis recorded by the provider",
    "capabilityTier": "official",
    "platform": "youtube",
    "providerKind": "official-api",
    "mode": "searchAll",
    "auth": "app-credential",
    "robots": "not-applicable",
    "fetchedAt": "2026-08-31T12:00:00.000Z"
  }
}
```

All fields except the schema, observation ID, platform, content type, external ID,
text, published/observed timestamps, sentiment and source lineage can be omitted
when unknown. In particular:

- Missing metrics are omitted. The normalizer never invents `0`.
- Sentiment starts as exactly `{ "status": "pending" }`; it never invents a
  `neutral` label, score or confidence.
- `topics`/`tags` contain only explicit upstream tags (`hashtags`, `tags`, or
  equivalent provider raw fields) and literal `#token` hashtags in the source
  text. Text is not otherwise classified as a topic.
- A post has `conversationId = externalId`. A comment keeps `parentId`; when the
  provider exposes a root/link/thread reference, that value is used as
  `conversationId`.
- `canonicalUrl` removes known tracking and temporary XHS access parameters and
  sorts the remaining query parameters. Parameters that can affect content
  identity are retained. The raw provider payload remains available on the source
  item for the existing export path.

The TypeScript entry points are:

```ts
normalizeSocialObservation(item, provenance, options?)
normalizeSocialBundle(bundle, options?)
canonicalizeSocialUrl(url)
```

`options.sourceId` should be the project/source registration ID when one exists.
If omitted, the deterministic default is `${providerId}:${platform}`. An explicit
`options.observationId` is intended for one already-identified item; for a multi-item
bundle it is treated as a prefix (`<id>:<index>`) so observations cannot collide.

## Provider and platform readiness

`src/providers/social-capabilities.ts` exposes the static
`SOCIAL_PLATFORM_DIRECTORY` and the runtime
`buildSocialCapabilityCatalog(registry.capabilities())`. The runtime catalog keeps
provider variants separate, because one platform can have both a licensed vendor
and a user-authorized experimental adapter. Every entry has:

- `tier`: `official`, `licensed`, or `experimental`;
- `readiness`: `ready`, `needs-credentials`, `degraded`, or `experimental`;
- `accountScope`: `none` or `own-account`;
- `read`: provider-declared modes and comment support;
- `write.enabled: false` and `write.requiresApproval: true`.

The current P0 interpretation is:

| Platform/provider path | Tier | P0 readiness and account scope | Commercial/ToS boundary |
| --- | --- | --- | --- |
| YouTube Data API v3 | official | Credentials required; public search/content read | Commercial use still depends on current Google API terms, quota, key controls and applicable data/privacy obligations. A configured key is not proof of a customer contract. |
| Reddit OAuth API | official | Credentials required; public post/comment read | Reddit free access has a non-commercial boundary in the repository compliance research. Commercial use requires current Reddit terms/entitlement or an Official Data Partner agreement; retain the provider legal basis in audit. |
| Bluesky Jetstream | official/open protocol | Ready for anonymous live stream; no anonymous historical-search promise | Public protocol access does not eliminate retention, privacy or coverage obligations. Keep the stream window and source lineage. |
| TikHub → XHS/TikTok/Douyin | licensed | API key/contract required; no own-account scope | `licensed` means a third-party vendor relationship, not platform-official authorization. Commercial readiness requires a current vendor contract and a separate platform/ToS review. |
| Spider_XHS → XHS | experimental | Own-account scope; login/session required | The adapter's upstream README is marked learning/non-commercial. Treat as non-commercial/unapproved until legal review and an approved replacement path exist. Do not move its cookie into the control plane. |
| OpenCLI dynamic site | experimental | Per-site catalog; browser commands may need a managed Profile/CDP | A command appearing in the dynamic catalog is not platform authorization. Check login scope, robots/site terms, quotas and output handling per site. Only read commands are admitted. |

“Official” and “licensed” are readiness tiers, not blanket permission to sell a
dataset. Before a commercial deployment, record the current provider agreement,
quota/price, data retention and deletion policy, geographic/privacy basis and
customer scope. If any of those are unknown, report `needs-credentials` or
`experimental` instead of claiming ready.

## Quota, login and compliance risks

- API keys, vendor tokens and user-session material stay in the Worker. They are
  not part of this envelope, API response, or source lineage.
- Quotas are provider-specific. Search pagination and per-post comment reads can
  multiply calls; a successful offline fixture does not prove a paid quota or a
  commercial entitlement.
- Login/session paths are limited to an explicitly authorized own-account scope.
  They do not turn a closed platform into an approved whole-platform listener.
- The normalizer does not bypass robots, access controls, signatures, DRM, login
  walls or rate limits. Existing provider-specific policy checks remain in force.
- Keep source URL, provider ID, legal basis, auth mode, robots status and fetched
  time with every normalized observation so deletion/objection and audit handling
  can locate the originating record.

## Outbound behavior is a later approval concern

P0 is read-only. The social capability catalog advertises no write operation, even
when an OpenCLI discovery result contains commands named like `post`, `comment`,
`like`, `follow`, `publish`, `send`, or `download`. The existing OpenCLI provider
also rejects unsafe analysis commands. Any future outbound design must be a
separate approval/risk-gated operation with an idempotency key, target/scope,
preview and audit trail; it must not be added by making this normalization layer
“more capable.”
