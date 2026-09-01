import { describe, expect, it } from 'vitest';
import {
  buildSocialCapabilityCatalog,
  SOCIAL_CAPABILITY_CATALOG,
} from '../src/providers/social-capabilities.js';
import {
  canonicalizeSocialUrl,
  normalizeSocialBundle,
  normalizeSocialObservation,
} from '../src/providers/social.js';
import { buildSourceItem } from '../src/providers/item.js';
import { openCliPlatform } from '../src/providers/types.js';
import type {
  Platform,
  ProviderCapability,
  Provenance,
  RawObservation,
  TextBundle,
} from '../src/providers/types.js';

function provenance(
  platform: Platform,
  kind: ProviderCapability['kind'],
  providerId = `${platform}-test`,
): Provenance {
  return {
    providerId,
    platform,
    kind,
    mode: kind === 'open-protocol' && platform === 'bluesky' ? 'streamLive' : 'searchAll',
    fetchedAt: '2026-08-31T12:00:00.000Z',
    legalBasis: `test ${providerId}`,
    robots: kind === 'user-authorized' ? 'unchecked' : 'not-applicable',
    auth: kind === 'official-api' || kind === 'licensed-vendor' ? 'app-credential' : 'anonymous',
  };
}

function observation(
  platform: Platform,
  overrides: Partial<RawObservation> = {},
): RawObservation {
  return {
    text: 'a useful social post',
    observedAt: '2026-08-30T10:00:00.000Z',
    platform,
    itemType: 'post',
    id: 'post-1',
    author: 'display-name',
    authorId: 'author-1',
    url: 'https://example.test/posts/post-1?utm_source=test',
    metrics: { likes: 4 },
    raw: { hashtags: ['#research', 'social'] },
    ...overrides,
  };
}

describe('social domain normalization', () => {
  it('maps all supported social provider platform shapes to one stable envelope', () => {
    const samples: Array<{ platform: Platform; kind: ProviderCapability['kind'] }> = [
      { platform: 'youtube', kind: 'official-api' },
      { platform: 'reddit', kind: 'official-api' },
      { platform: 'bluesky', kind: 'open-protocol' },
      { platform: 'xiaohongshu', kind: 'licensed-vendor' },
      { platform: 'tiktok', kind: 'licensed-vendor' },
      { platform: 'douyin', kind: 'licensed-vendor' },
      { platform: openCliPlatform('zhihu'), kind: 'open-protocol' },
    ];

    for (const sample of samples) {
      const value = normalizeSocialObservation(
        observation(sample.platform),
        provenance(sample.platform, sample.kind),
      );
      expect(value).toMatchObject({
        schema: 'threadbeacon.social.observation.v1',
        platform: sample.platform,
        contentType: 'post',
        externalId: 'post-1',
        publishedAt: '2026-08-30T10:00:00.000Z',
        observedAt: '2026-08-31T12:00:00.000Z',
        topics: ['research', 'social'],
        tags: ['research', 'social'],
        sentiment: { status: 'pending' },
        source: { providerId: `${sample.platform}-test` },
      });
      expect(value.observationId).toBe(value.source.observationId);
      expect(value.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(value.source.capabilityTier).toBe(
        sample.kind === 'official-api'
          ? 'official'
          : sample.kind === 'licensed-vendor'
            ? 'licensed'
            : sample.platform.startsWith('opencli:')
              ? 'experimental'
              : 'official',
      );
    }
  });

  it('keeps comments linked to a conversation and does not invent sentiment or metrics', () => {
    const value = normalizeSocialObservation(
      observation('reddit', {
        text: 'a comment',
        observedAt: new Date('2026-08-30T10:01:00.000Z'),
        itemType: 'comment',
        id: 'comment-1',
        parentId: 'post-1',
        metrics: undefined,
        raw: { linkId: 'post-1' },
      }),
      provenance('reddit', 'official-api'),
    );

    expect(value).toMatchObject({
      contentType: 'comment',
      externalId: 'comment-1',
      conversationId: 'post-1',
      parentId: 'post-1',
      sentiment: { status: 'pending' },
    });
    expect(value.engagement).toBeUndefined();
    expect(value.sentiment).not.toHaveProperty('label');
    expect(value.sentiment).not.toHaveProperty('score');
  });

  it('derives a deterministic identity when a provider has no item id', () => {
    const input = observation('bluesky', {
      id: undefined,
      url: 'https://bsky.app/profile/did:plc:abc/post/xyz',
      raw: {},
    });
    const first = normalizeSocialObservation(input, provenance('bluesky', 'open-protocol'));
    const second = normalizeSocialObservation(input, provenance('bluesky', 'open-protocol'));
    expect(first.externalId).toBe('https://bsky.app/profile/did:plc:abc/post/xyz');
    expect(first.observationId).toBe(second.observationId);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('normalizes a TextBundle without changing provider items', () => {
    const items = [observation('youtube'), observation('youtube', {
      id: 'post-2',
      text: 'a useful #second post',
      raw: {},
    })];
    const bundle: TextBundle = {
      items: items.map(buildSourceItem),
      provenance: provenance('youtube', 'official-api'),
    };
    const normalized = normalizeSocialBundle(bundle, { sourceId: 'project-source-1' });
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.source.sourceId).toBe('project-source-1');
    expect(normalized[0]?.observationId).not.toBe(normalized[1]?.observationId);
    expect(normalized[1]?.tags).toEqual(['second']);
    expect(items[0]?.text).toBe('a useful social post');
  });

  it('removes tracking and temporary XHS access parameters while preserving identity parameters', () => {
    expect(canonicalizeSocialUrl(
      'https://www.xiaohongshu.com/explore/n1?xsec_token=secret&xsec_source=pc_search&token=secret2&foo=bar&utm_source=x#reply',
    )).toBe('https://www.xiaohongshu.com/explore/n1?foo=bar');
  });
});

describe('social capability catalog', () => {
  it('lists the seven P0 platform families and marks them read-only', () => {
    expect(SOCIAL_CAPABILITY_CATALOG.map((entry) => entry.platform)).toEqual([
      'youtube',
      'reddit',
      'bluesky',
      'xiaohongshu',
      'tiktok',
      'douyin',
      'opencli:*',
    ]);
    expect(SOCIAL_CAPABILITY_CATALOG.every((entry) => (
      entry.readOnly && entry.canRead && !entry.canWrite && entry.write.enabled === false
    ))).toBe(true);
  });

  it('derives tier, own-account scope and readiness from existing provider capabilities', () => {
    const capabilities: ProviderCapability[] = [
      {
        id: 'youtube-data-api-v3',
        platform: 'youtube',
        kind: 'official-api',
        modes: ['searchAll'],
        canFetchComments: true,
        legalBasis: 'official test',
        robots: 'not-applicable',
      },
      {
        id: 'xiaohongshu-spider-xhs',
        platform: 'xiaohongshu',
        kind: 'user-authorized',
        modes: ['searchAll'],
        canFetchComments: true,
        legalBasis: 'session test',
        robots: 'unchecked',
      },
      {
        id: 'opencli-zhihu',
        platform: openCliPlatform('zhihu'),
        kind: 'open-protocol',
        modes: ['searchAll'],
        canFetchComments: false,
        legalBasis: 'adapter test',
        robots: 'not-applicable',
      },
    ];
    const catalog = buildSocialCapabilityCatalog(capabilities);
    expect(catalog).toEqual([
      expect.objectContaining({
        providerId: 'opencli-zhihu',
        tier: 'experimental',
        readiness: 'experimental',
        accountScope: 'none',
      }),
      expect.objectContaining({
        providerId: 'xiaohongshu-spider-xhs',
        tier: 'experimental',
        readiness: 'needs-credentials',
        accountScope: 'own-account',
      }),
      expect.objectContaining({
        providerId: 'youtube-data-api-v3',
        tier: 'official',
        readiness: 'needs-credentials',
        accountScope: 'none',
      }),
    ]);
    expect(catalog.every((entry) => entry.canWrite === false && entry.write.enabled === false)).toBe(true);
  });
});
