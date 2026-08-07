// YouTube provider —— Data API v3。
//
// API key 走 query 参数而非 Authorization 头，但它同样是平台签发的应用级凭据，
// 因此 authMode 仍声明为 'app-credential' —— provenance 要如实反映凭据性质，
// 不能因为它藏在 URL 里就当成匿名取数。
//
// ⚠️ 配额：2026-06-01 起 search.list 被剥离到独立配额桶，**约 100 次搜索/天**，
// 与 10,000 units 主池不互通。做商业产品必须提前申请扩容。
// videos.list / commentThreads.list 各 1 unit，读取很便宜。
// 见 docs/技术选型调研.md §10。

import { BaseProvider, type BaseProviderDeps } from './base.js';
import type { ProviderCapability, RawObservation, SearchQuery, TextBundle } from './types.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_PAGE_SIZE = 50; // search.list maxResults 上限
const COMMENT_PAGE_SIZE = 100; // commentThreads.list maxResults 上限

interface SearchResponse {
  readonly items?: ReadonlyArray<{
    readonly id?: { readonly videoId?: string };
    readonly snippet?: {
      readonly title?: string;
      readonly description?: string;
      readonly publishedAt?: string;
      readonly channelId?: string;
      readonly channelTitle?: string;
      readonly thumbnails?: unknown;
      readonly liveBroadcastContent?: string;
    };
  }>;
}

interface CommentThreadsResponse {
  readonly items?: ReadonlyArray<{
    readonly id?: string;
    readonly snippet?: {
      readonly totalReplyCount?: number;
      readonly topLevelComment?: {
        readonly id?: string;
        readonly snippet?: {
          readonly textOriginal?: string;
          readonly publishedAt?: string;
          readonly updatedAt?: string;
          readonly authorDisplayName?: string;
          readonly authorChannelId?: { readonly value?: string };
          readonly authorChannelUrl?: string;
          readonly authorProfileImageUrl?: string;
          readonly likeCount?: number;
        };
      };
    };
  }>;
}

export interface YouTubeProviderOptions extends BaseProviderDeps {
  readonly apiKey: string;
  /** 每个视频最多取多少条顶层评论，默认 50。 */
  readonly maxCommentsPerVideo?: number;
}

export class YouTubeProvider extends BaseProvider {
  readonly capability: ProviderCapability = {
    id: 'youtube-data-api-v3',
    platform: 'youtube',
    kind: 'official-api',
    modes: ['searchAll'],
    canFetchComments: true,
    legalBasis: 'YouTube Data API v3，Google 签发的应用级 API key',
    robots: 'not-applicable', // 走官方 API 端点，非网页爬取
    quota: {
      unit: 'quota-units',
      perDay: 10_000,
      note: 'search.list 自 2026-06-01 起走独立配额桶，约 100 次/天，需单独申请扩容',
    },
  };

  private readonly apiKey: string;
  private readonly maxCommentsPerVideo: number;

  constructor(opts: YouTubeProviderOptions) {
    super(opts);
    this.apiKey = opts.apiKey;
    this.maxCommentsPerVideo = opts.maxCommentsPerVideo ?? 50;
  }

  private url(path: string, params: Record<string, string>): string {
    const u = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('key', this.apiKey);
    return u.toString();
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    // search.list 配额极紧，只发一次，不做分页 —— 多翻一页就多烧一次日配额
    const search = await this.http.getJson<SearchResponse>(
      this.url('/search', {
        part: 'snippet',
        type: 'video',
        q: query.keyword,
        maxResults: String(Math.min(query.limit, SEARCH_PAGE_SIZE)),
      }),
    );

    const raws: RawObservation[] = [];
    const videoIds: string[] = [];

    for (const item of search.items ?? []) {
      const publishedAt = item.snippet?.publishedAt;
      if (!publishedAt) continue;
      const s = item.snippet;
      const vid = item.id?.videoId;
      const text = [s?.title, s?.description]
        .filter((t): t is string => !!t?.trim())
        .join('\n\n');
      if (text) {
        raws.push({
          text,
          observedAt: publishedAt,
          platform: 'youtube',
          itemType: 'post',
          ...(vid ? { id: vid, url: `https://www.youtube.com/watch?v=${vid}` } : {}),
          ...(s?.channelTitle ? { author: s.channelTitle } : {}),
          ...(s?.channelId ? { authorId: s.channelId } : {}),
          ...(s?.title ? { title: s.title } : {}),
          raw: {
            description: s?.description,
            thumbnails: s?.thumbnails,
            liveBroadcastContent: s?.liveBroadcastContent,
          },
        });
      }
      if (vid) videoIds.push(vid);
    }

    if (query.includeComments) {
      for (const videoId of videoIds) {
        raws.push(...(await this.fetchComments(videoId)));
      }
    }

    return this.bundle(raws, 'searchAll');
  }

  /** 单个视频的顶层评论。失败不致命 —— 关评论的视频会返回 403，跳过即可。 */
  private async fetchComments(videoId: string): Promise<RawObservation[]> {
    let res: CommentThreadsResponse;
    try {
      res = await this.http.getJson<CommentThreadsResponse>(
        this.url('/commentThreads', {
          part: 'snippet',
          videoId,
          maxResults: String(Math.min(this.maxCommentsPerVideo, COMMENT_PAGE_SIZE)),
          textFormat: 'plainText',
        }),
      );
    } catch {
      return [];
    }

    const out: RawObservation[] = [];
    for (const item of res.items ?? []) {
      const top = item.snippet?.topLevelComment;
      const s = top?.snippet;
      if (!s?.textOriginal || !s.publishedAt) continue;
      out.push({
        text: s.textOriginal,
        observedAt: s.publishedAt,
        platform: 'youtube',
        itemType: 'comment',
        // 评论挂在视频下，parentId 指回视频，导出时两张表靠它关联
        parentId: videoId,
        ...(top?.id ? { id: top.id } : {}),
        ...(s.authorDisplayName ? { author: s.authorDisplayName } : {}),
        ...(s.authorChannelId?.value ? { authorId: s.authorChannelId.value } : {}),
        ...(top?.id
          ? { url: `https://www.youtube.com/watch?v=${videoId}&lc=${top.id}` }
          : {}),
        metrics: {
          likes: s.likeCount ?? 0,
          comments: item.snippet?.totalReplyCount ?? 0,
        },
        raw: {
          updatedAt: s.updatedAt,
          authorChannelUrl: s.authorChannelUrl,
          authorProfileImageUrl: s.authorProfileImageUrl,
        },
      });
    }
    return out;
  }
}
