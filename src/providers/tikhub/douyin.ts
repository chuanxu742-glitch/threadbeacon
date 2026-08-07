// 抖音 provider —— 经 TikHub 转售。
//
// 响应形态（来自上游 tikhub-service.ts 的实测解析路径）：
//   data[].aweme_info.{aweme_id,desc,create_time,share_url,
//                      author:{nickname,uid},statistics:{...}}
//
// 注意抖音用 statistics / create_time，TikTok 用 stats / createTime ——
// 两边字段名不同，不要试图共用一份解析。

import { fromUnixSeconds, num, pickArray, str } from './client.js';
import { TIKHUB_QUOTA, TikHubProvider, vendorLegalBasis, type TikHubEndpointSpec } from './base.js';
import type { ProviderCapability, RawObservation } from '../types.js';

const PAGE_SIZE = 20;

export class DouyinProvider extends TikHubProvider {
  readonly capability: ProviderCapability = {
    id: 'douyin-tikhub',
    platform: 'douyin',
    kind: 'licensed-vendor',
    modes: ['searchAll'],
    canFetchComments: true,
    legalBasis: vendorLegalBasis('抖音'),
    robots: 'not-applicable',
    quota: TIKHUB_QUOTA,
  };

  protected readonly spec: TikHubEndpointSpec = {
    searchPath: '/api/v1/douyin/search/fetch_general_search_v1',
    pageSize: PAGE_SIZE,
    buildSearchParams: (keyword, page, want) => ({
      keyword,
      offset: (page - 1) * PAGE_SIZE,
      count: want,
      sort_type: '0', // 综合排序
      publish_time: '0', // 不限时间
    }),
    parseSearch: (data) => {
      const out: RawObservation[] = [];
      for (const raw of pickArray(data, 'data', 'business_data')) {
        const wrapper = raw as { aweme_info?: Record<string, unknown> };
        const aweme = wrapper.aweme_info;
        if (!aweme) continue;

        const text = str(aweme['desc']);
        const id = str(aweme['aweme_id']);
        if (!text || !id) continue;

        const author = (aweme['author'] ?? {}) as Record<string, unknown>;
        const stats = (aweme['statistics'] ?? {}) as Record<string, unknown>;

        out.push({
          text,
          observedAt: fromUnixSeconds(aweme['create_time']) ?? new Date().toISOString(),
          platform: 'douyin',
          itemType: 'post',
          id,
          title: text,
          ...(str(aweme['share_url']) ? { url: str(aweme['share_url'])! } : {}),
          ...(str(author['nickname']) ? { author: str(author['nickname'])! } : {}),
          ...(str(author['uid']) ? { authorId: str(author['uid'])! } : {}),
          metrics: {
            likes: num(stats['digg_count']) ?? 0,
            comments: num(stats['comment_count']) ?? 0,
            shares: num(stats['share_count']) ?? 0,
            views: num(stats['play_count']) ?? 0,
          },
          raw: {
            collectCount: num(stats['collect_count']),
            duration: aweme['video'] && (aweme['video'] as Record<string, unknown>)['duration'],
            hashtags: aweme['cha_list'],
          },
        });
      }
      return out;
    },

    commentPath: '/api/v1/douyin/web/fetch_video_comments',
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
          platform: 'douyin',
          itemType: 'comment',
          parentId: awemeId,
          ...(str(c['cid']) ? { id: str(c['cid'])! } : {}),
          ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
          ...(str(user['uid']) ? { authorId: str(user['uid'])! } : {}),
          metrics: {
            likes: num(c['digg_count']) ?? 0,
            comments: num(c['reply_comment_total']) ?? 0,
          },
          // ip_label 是抖音展示的属地（省级），原样留存
          raw: { ipLocation: c['ip_label'] },
        });
      }
      return out;
    },
  };
}
