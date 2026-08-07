// Bluesky provider —— AT Protocol 公开 App View。
//
// kind 是 'open-protocol'，authMode 是 'anonymous'。
// 见 docs/行业合规范式.md §5。
//
// ⛔ 本 provider 当前不可用（2026-08-05 实测已复现）
// -----------------------------------------------------------------------------
// 同一网络、同一代理下：
//   app.bsky.actor.getProfile   -> HTTP 200
//   app.bsky.feed.searchPosts   -> HTTP 403
// 两者同主机同时刻，因此 403 是**端点级的授权要求**，不是网络或 UA 问题。
//
// Bluesky 的会话凭据是 app password，属**用户凭据**，而 AuthMode 刻意不能
// 表达用户身份（见 DISCLAIMER.md §1）。因此 searchAll 在本项目约束下无解。
//
// ✅ 替代方案：BlueskyJetstreamProvider（同目录 bluesky-jetstream.ts）。
//    Jetstream 实时流无需任何授权，实测连上即收到事件。
//    代价是只能订阅增量、拿不到历史 —— 那是 'streamLive' 模式。
//
// 代码保留是因为它本身是对的：若将来 Bluesky 开放匿名检索，或你自建
// 一个允许匿名 searchPosts 的 AppView（endpoint 可覆盖），它就能直接用。
// checkAvailability() 会实际探测，注册前请先调用它。
// -----------------------------------------------------------------------------

import { BaseProvider, paginate, type BaseProviderDeps } from './base.js';
import type { ProviderCapability, RawObservation, SearchQuery, TextBundle } from './types.js';

const DEFAULT_ENDPOINT = 'https://public.api.bsky.app';
const PAGE_SIZE = 100; // searchPosts 单页上限

interface SearchPostsResponse {
  readonly posts?: ReadonlyArray<{
    readonly uri?: string;
    readonly cid?: string;
    readonly indexedAt?: string;
    readonly author?: {
      readonly did?: string;
      readonly handle?: string;
      readonly displayName?: string;
      readonly avatar?: string;
    };
    readonly record?: {
      readonly text?: string;
      readonly createdAt?: string;
      readonly langs?: readonly string[];
    };
    readonly likeCount?: number;
    readonly replyCount?: number;
    readonly repostCount?: number;
    readonly quoteCount?: number;
  }>;
  readonly cursor?: string;
}

/** at://did/collection/rkey 的最后一段就是 rkey。 */
function rkeyOf(uri: string | undefined): string | undefined {
  return uri?.split('/').pop() || undefined;
}

/** 由 at:// uri 拼出网页链接。 */
function webUrl(uri: string | undefined, did: string | undefined): string | undefined {
  const rkey = rkeyOf(uri);
  return did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : undefined;
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
    // 调用文档化的 XRPC 端点，非网页爬取。
    // 该站 robots.txt 亦明示 "Crawling the public parts of the API is allowed"。
    robots: 'not-applicable',
  };

  private readonly endpoint: string;

  constructor(opts: BlueskyProviderOptions) {
    super(opts);
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  }

  /**
   * 实际探测 searchPosts 是否可匿名调用。
   *
   * 基类默认返回 true，那对这个 provider 是误导 —— 它在官方端点上会 403。
   * 注册前调用此方法，别让不可用的 provider 悄悄进 registry。
   */
  override async checkAvailability(): Promise<boolean> {
    const url = new URL('/xrpc/app.bsky.feed.searchPosts', this.endpoint);
    url.searchParams.set('q', 'test');
    url.searchParams.set('limit', '1');
    try {
      await this.http.getJson(url.toString());
      return true;
    } catch {
      return false;
    }
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
        // 缺文本或缺时间的条目直接丢弃 —— 时间字段补不出来
        if (!text || !createdAt) continue;
        const did = post.author?.did;
        const rkey = rkeyOf(post.uri);
        const url = webUrl(post.uri, did);
        items.push({
          text,
          observedAt: createdAt,
          platform: 'bluesky',
          itemType: 'post',
          ...(rkey ? { id: rkey } : {}),
          ...(post.author?.handle ? { author: post.author.handle } : {}),
          ...(did ? { authorId: did } : {}),
          ...(url ? { url } : {}),
          ...(post.record?.langs?.[0] !== undefined ? { lang: post.record.langs[0] } : {}),
          metrics: {
            likes: post.likeCount ?? 0,
            comments: post.replyCount ?? 0,
            shares: (post.repostCount ?? 0) + (post.quoteCount ?? 0),
          },
          raw: {
            atUri: post.uri,
            cid: post.cid,
            indexedAt: post.indexedAt,
            displayName: post.author?.displayName,
            avatar: post.author?.avatar,
          },
        });
      }
      return { items, ...(res.cursor !== undefined ? { cursor: res.cursor } : {}) };
    });

    return this.bundle(posts, 'searchAll');
  }
}
