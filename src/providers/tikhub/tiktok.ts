// TikTok provider —— 经 TikHub 转售。
//
// 响应形态（来自上游 tiktok-service.ts 的实测解析路径）：
//   data[].item.{id,desc,createTime,share_url,author:{nickname},stats:{...}}
//
// 与抖音同源但字段名是驼峰、统计挂在 stats 而非 statistics，
// 外层包装键也从 aweme_info 变成 item。

import { fromUnixSeconds, num, pickArray, str } from './client.js';
import { TIKHUB_QUOTA, TikHubProvider, vendorLegalBasis, type TikHubEndpointSpec } from './base.js';
import type { ProviderCapability, RawObservation } from '../types.js';

const PAGE_SIZE = 20;

export class TikTokProvider extends TikHubProvider {
  readonly capability: ProviderCapability = {
    id: 'tiktok-tikhub',
    platform: 'tiktok',
    kind: 'licensed-vendor',
    modes: ['searchAll'],
    canFetchComments: true,
    legalBasis: vendorLegalBasis('TikTok'),
    robots: 'not-applicable',
    quota: TIKHUB_QUOTA,
  };

  protected readonly spec: TikHubEndpointSpec = {
    searchPath: '/api/v1/tiktok/web/fetch_general_search',
    pageSize: PAGE_SIZE,
    buildSearchParams: (keyword, page, want) => ({
      keyword,
      offset: (page - 1) * PAGE_SIZE,
      count: want,
    }),
    parseSearch: (data) => {
      const out: RawObservation[] = [];
      for (const raw of pickArray(data, 'data', 'item_list')) {
        const wrapper = raw as { item?: Record<string, unknown> };
        const it = wrapper.item;
        if (!it) continue;

        const text = str(it['desc']);
        const id = str(it['id']);
        if (!text || !id) continue;

        const author = (it['author'] ?? {}) as Record<string, unknown>;
        const stats = (it['stats'] ?? {}) as Record<string, unknown>;

        out.push({
          text,
          observedAt: fromUnixSeconds(it['createTime']) ?? new Date().toISOString(),
          platform: 'tiktok',
          itemType: 'post',
          id,
          title: text,
          ...(str(it['share_url']) ? { url: str(it['share_url'])! } : {}),
          ...(str(author['nickname']) ? { author: str(author['nickname'])! } : {}),
          ...(str(author['uniqueId'] ?? author['id'])
            ? { authorId: str(author['uniqueId'] ?? author['id'])! }
            : {}),
          metrics: {
            likes: num(stats['digg_count']) ?? 0,
            comments: num(stats['comment_count']) ?? 0,
            shares: num(stats['share_count']) ?? 0,
            views: num(stats['play_count']) ?? 0,
          },
          raw: { collectCount: num(stats['collect_count']) },
        });
      }
      return out;
    },

    commentPath: '/api/v1/tiktok/web/fetch_post_comment',
    buildCommentParams: (awemeId, want) => ({ aweme_id: awemeId, cursor: 0, count: want }),
    parseComments: (data, awemeId) => {
      const out: RawObservation[] = [];
      for (const raw of pickArray(data, 'comments', 'data')) {
        const c = raw as Record<string, unknown>;
        const text = str(c['text']);
        if (!text) continue;

        const user = (c['user'] ?? {}) as Record<string, unknown>;
        out.push({
          text,
          observedAt: fromUnixSeconds(c['create_time']) ?? new Date().toISOString(),
          platform: 'tiktok',
          itemType: 'comment',
          parentId: awemeId,
          ...(str(c['cid']) ? { id: str(c['cid'])! } : {}),
          ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
          ...(str(user['uid']) ? { authorId: str(user['uid'])! } : {}),
          metrics: {
            likes: num(c['digg_count']) ?? 0,
            comments: num(c['reply_comment_total']) ?? 0,
          },
        });
      }
      return out;
    },
  };
}
