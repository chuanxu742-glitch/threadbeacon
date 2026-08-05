// Bluesky provider —— AT Protocol 公开 App View。
//
// 这是本项目里合规成本最低的数据源：协议开放、接口公开、无需授权、无配额费用，
// 因而 kind 是 'open-protocol'，authMode 是 'anonymous'。
// 见 docs/行业合规范式.md §5 —— 唯一能零成本拿到完整 firehose 的主流社交平台。

import { BaseProvider, paginate, type BaseProviderDeps } from './base.js';
import type { RawObservation } from '../privacy/minimize.js';
import type { ProviderCapability, SearchQuery, TextBundle } from './types.js';

const DEFAULT_ENDPOINT = 'https://public.api.bsky.app';
const PAGE_SIZE = 100; // searchPosts 单页上限

/** 只声明本 provider 实际读取的字段，其余一律不碰。 */
interface SearchPostsResponse {
  readonly posts?: ReadonlyArray<{
    readonly record?: {
      readonly text?: string;
      readonly createdAt?: string;
      readonly langs?: readonly string[];
    };
  }>;
  readonly cursor?: string;
}

export interface BlueskyProviderOptions extends BaseProviderDeps {
  /** 覆盖 App View 基址，便于自建实例或测试。 */
  readonly endpoint?: string;
}

export class BlueskyProvider extends BaseProvider {
  readonly capability: ProviderCapability = {
    id: 'bluesky-public-appview',
    platform: 'bluesky',
    kind: 'open-protocol',
    modes: ['searchAll'],
    canFetchComments: false,
    legalBasis: 'AT Protocol 公开 App View，协议设计上即面向公开读取，无需授权',
  };

  private readonly endpoint: string;

  constructor(opts: BlueskyProviderOptions) {
    super(opts);
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const posts = await paginate<RawObservation>(query.limit, PAGE_SIZE, async (cursor, want) => {
      const url = new URL('/xrpc/app.bsky.feed.searchPosts', this.endpoint);
      url.searchParams.set('q', query.keyword);
      url.searchParams.set('limit', String(want));
      if (cursor !== undefined) url.searchParams.set('cursor', cursor);

      const res = await this.http.getJson<SearchPostsResponse>(url.toString());

      const items: RawObservation[] = [];
      for (const post of res.posts ?? []) {
        const text = post.record?.text;
        const createdAt = post.record?.createdAt;
        // 缺文本或缺时间的条目直接丢弃 —— 时间要用来做降采样，补不出来
        if (!text || !createdAt) continue;
        items.push({
          text,
          observedAt: createdAt,
          platform: 'bluesky',
          ...(post.record?.langs?.[0] !== undefined ? { lang: post.record.langs[0] } : {}),
        });
      }
      return { items, ...(res.cursor !== undefined ? { cursor: res.cursor } : {}) };
    });

    return this.bundle(posts, 'searchAll');
  }
}
