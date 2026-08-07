// 小红书 provider —— 经 TikHub 转售。
//
// 响应形态（来自上游 SeekMoney-ai xiaohongshu-service.ts 的实测解析路径）：
//   data.items[].note.{id,title,desc,timestamp,user:{nickname,userid},
//                      liked_count,collected_count,shared_count,comments_count}
//
// 笔记链接要自己拼：接口只给 note.id，不给 url。

import { fromUnixSeconds, num, pickArray, str } from './client.js';
import { TIKHUB_QUOTA, TikHubProvider, vendorLegalBasis, type TikHubEndpointSpec } from './base.js';
import type { ProviderCapability, RawObservation } from '../types.js';

const PAGE_SIZE = 20;

function noteUrl(id: string): string {
  return `https://www.xiaohongshu.com/explore/${id}`;
}

export class XiaohongshuProvider extends TikHubProvider {
  readonly capability: ProviderCapability = {
    id: 'xiaohongshu-tikhub',
    platform: 'xiaohongshu',
    kind: 'licensed-vendor',
    modes: ['searchAll'],
    canFetchComments: true,
    legalBasis: vendorLegalBasis('小红书'),
    // 调的是供应商的 HTTP API，不是爬小红书网页
    robots: 'not-applicable',
    quota: TIKHUB_QUOTA,
  };

  protected readonly spec: TikHubEndpointSpec = {
    searchPath: '/api/v1/xiaohongshu/app_v2/search_notes',
    pageSize: PAGE_SIZE,
    buildSearchParams: (keyword, page) => ({
      keyword,
      page,
      sort: 'general',
      // _0 = 不限笔记类型（图文 + 视频）
      noteType: '_0',
    }),
    parseSearch: (data) => {
      const out: RawObservation[] = [];
      for (const raw of pickArray(data, 'items', 'data')) {
        const wrapper = raw as { note?: Record<string, unknown> };
        const note = wrapper.note;
        if (!note) continue;

        const id = str(note['id']);
        const title = str(note['title']);
        const desc = str(note['desc']);
        // 标题与正文合成语义单元；两者都空的笔记没有分析价值
        const text = [title, desc].filter(Boolean).join('\n\n');
        if (!id || !text) continue;

        const user = (note['user'] ?? {}) as Record<string, unknown>;
        const postedAt = fromUnixSeconds(note['timestamp']);

        out.push({
          text,
          observedAt: postedAt ?? new Date().toISOString(),
          platform: 'xiaohongshu',
          itemType: 'post',
          id,
          url: noteUrl(id),
          ...(title ? { title } : {}),
          ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
          ...(str(user['userid']) ? { authorId: str(user['userid'])! } : {}),
          metrics: {
            likes: num(note['liked_count']) ?? 0,
            comments: num(note['comments_count']) ?? 0,
            shares: num(note['shared_count']) ?? 0,
          },
          raw: {
            noteType: note['type'],
            collectedCount: num(note['collected_count']),
            imagesList: note['images_list'],
            // timestamp 缺失时上面回退成了采集时刻，标记出来以免下游误当发布时间
            timestampMissing: postedAt === undefined,
          },
        });
      }
      return out;
    },

    commentPath: '/api/v1/xiaohongshu/app_v2/get_note_comments',
    buildCommentParams: (noteId) => ({ note_id: noteId }),
    parseComments: (data, noteId) => {
      const out: RawObservation[] = [];
      for (const raw of pickArray(data, 'comments', 'items', 'data')) {
        const c = raw as Record<string, unknown>;
        const text = str(c['content']);
        if (!text) continue;

        const user = (c['user'] ?? {}) as Record<string, unknown>;
        out.push({
          text,
          observedAt: fromUnixSeconds(c['time']) ?? new Date().toISOString(),
          platform: 'xiaohongshu',
          itemType: 'comment',
          parentId: noteId,
          ...(str(c['id']) ? { id: str(c['id'])! } : {}),
          ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
          ...(str(user['userid']) ? { authorId: str(user['userid'])! } : {}),
          metrics: { likes: num(c['like_count']) ?? 0 },
          raw: { ipLocation: c['ip_location'], subCommentCount: num(c['sub_comment_count']) },
        });
      }
      return out;
    },
  };
}
