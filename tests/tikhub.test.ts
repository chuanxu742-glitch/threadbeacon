import { describe, expect, it } from 'vitest';
import { TikHubClient, TikHubError, pickArray } from '../src/providers/tikhub/client.js';
import { DouyinProvider } from '../src/providers/tikhub/douyin.js';
import { TikTokProvider } from '../src/providers/tikhub/tiktok.js';
import { XiaohongshuProvider } from '../src/providers/tikhub/xiaohongshu.js';
import type { AuthMode, HttpPort } from '../src/providers/http.js';

/** 记录 URL 与请求头的假 HTTP 端口。 */
function fakeHttp(routes: ReadonlyArray<{ match: string; reply: unknown | (() => unknown) }>) {
  const calls: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
  const port: HttpPort = {
    authMode: 'app-credential' as AuthMode,
    async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
      calls.push({ url, headers });
      const hit = routes.find((r) => url.includes(r.match));
      if (!hit) throw new Error(`未预置的路由：${url}`);
      return (typeof hit.reply === 'function' ? (hit.reply as () => unknown)() : hit.reply) as T;
    },
    async postForm<T>(): Promise<T> {
      throw new Error('TikHub 只用 GET');
    },
  };
  return { port, calls };
}

const ok = (data: unknown) => ({ code: 200, data });

function client(routes: Parameters<typeof fakeHttp>[0]) {
  const { port, calls } = fakeHttp(routes);
  return { http: port, client: new TikHubClient({ http: port, apiToken: 'TOKEN' }), calls };
}

describe('TikHubClient', () => {
  it('带上 Bearer token', async () => {
    const { client: c, calls } = client([{ match: '/x', reply: ok({}) }]);
    await c.get('/x', {});
    expect(calls[0]!.headers?.['authorization']).toBe('Bearer TOKEN');
  });

  it('undefined 参数不进 query', async () => {
    const { client: c, calls } = client([{ match: '/x', reply: ok({}) }]);
    await c.get('/x', { a: ' 1', b: undefined });
    expect(calls[0]!.url).toContain('a=');
    expect(calls[0]!.url).not.toContain('b=');
  });

  it('code 非 200 抛错而不是静默返回空', async () => {
    const { client: c } = client([{ match: '/x', reply: { code: 403, message: '配额耗尽' } }]);
    // 静默返回空会让「配额耗尽」和「没搜到」变成同一件事，最难排查
    await expect(c.get('/x', {})).rejects.toThrow(TikHubError);
    await expect(c.get('/x', {})).rejects.toThrow(/配额耗尽/);
  });

  it('缺少 apiToken 时构造即失败', () => {
    const { port } = fakeHttp([]);
    expect(() => new TikHubClient({ http: port, apiToken: '' })).toThrow(/apiToken/);
  });
});

describe('pickArray 兜底', () => {
  it('直接是数组', () => {
    expect(pickArray([1, 2], 'items')).toEqual([1, 2]);
  });

  it('按 key 取一层', () => {
    expect(pickArray({ items: [1] }, 'items')).toEqual([1]);
  });

  it('钻到嵌套的 data.data', () => {
    // TikHub 抖音端点确实出现过这种形态，上游写了同样的兜底
    expect(pickArray({ data: { data: [1, 2] } }, 'data')).toEqual([1, 2]);
  });

  it('取不到时返回空数组而不是抛错', () => {
    expect(pickArray({ other: 1 }, 'items')).toEqual([]);
    expect(pickArray(null, 'items')).toEqual([]);
  });
});

describe('XiaohongshuProvider', () => {
  const searchReply = ok({
    items: [
      {
        note: {
          id: 'note123',
          title: '这款粉底液真的踩雷了',
          desc: '用了一周就闷痘，回购不了一点',
          timestamp: 1785000000,
          user: { nickname: '小美', userid: 'user789' },
          liked_count: 128,
          comments_count: 45,
          shared_count: 6,
          collected_count: 30,
        },
      },
    ],
  });

  it('提取笔记正文、作者与拼出的链接', async () => {
    const { http, client: c } = client([{ match: 'search_notes', reply: searchReply }]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: '粉底液', limit: 10 });
    const it = bundle.items[0]!;

    expect(it.text).toBe('这款粉底液真的踩雷了\n\n用了一周就闷痘，回购不了一点');
    expect(it.title).toBe('这款粉底液真的踩雷了');
    expect(it.id).toBe('note123');
    // 接口只给 id，链接要自己拼
    expect(it.url).toBe('https://www.xiaohongshu.com/explore/note123');
    expect(it.author).toBe('小美');
    expect(it.authorId).toBe('user789');
    expect(it.postedAt).toBe('2026-07-25T17:20:00.000Z');
    expect(it.metrics).toEqual({ likes: 128, comments: 45, shares: 6 });
  });

  it('provenance 如实标为 licensed-vendor，且 legalBasis 写明 unofficial', async () => {
    const { http, client: c } = client([{ match: 'search_notes', reply: ok({ items: [] }) }]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5 });
    expect(bundle.provenance.kind).toBe('licensed-vendor');
    expect(bundle.provenance.auth).toBe('app-credential');
    // 不得重复上游「官方 API，避免法律风险」的说法
    expect(bundle.provenance.legalBasis).toMatch(/unofficial/);
  });

  it('includeComments 时抓评论并关联回笔记', async () => {
    const { http, client: c } = client([
      { match: 'search_notes', reply: searchReply },
      {
        match: 'get_note_comments',
        reply: ok({
          comments: [
            {
              id: 'c1',
              content: '我也踩雷了，太干了',
              time: 1785003600,
              like_count: 9,
              user: { nickname: '路人甲', userid: 'u2' },
              ip_location: '浙江',
            },
          ],
        }),
      },
    ]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: '粉底液', limit: 1, includeComments: true });
    expect(bundle.items).toHaveLength(2);

    const comment = bundle.items[1]!;
    expect(comment.itemType).toBe('comment');
    expect(comment.parentId).toBe('note123');
    expect(comment.text).toBe('我也踩雷了，太干了');
    expect(comment.author).toBe('路人甲');
    expect(comment.raw?.['ipLocation']).toBe('浙江');
  });

  it('评论端点失败时跳过而不中断整批', async () => {
    const { http, client: c } = client([
      { match: 'search_notes', reply: searchReply },
      {
        match: 'get_note_comments',
        reply: () => {
          throw new Error('HTTP 429');
        },
      },
    ]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1, includeComments: true });
    expect(bundle.items).toHaveLength(1);
  });

  it('缺 timestamp 时回退到采集时刻并标记出来', async () => {
    const { http, client: c } = client([
      {
        match: 'search_notes',
        reply: ok({ items: [{ note: { id: 'n1', title: '标题够长可以入选', user: {} } }] }),
      },
    ]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });
    // 下游若把它当发布时间会得出错误的时间分布，所以显式标记
    expect(bundle.items[0]!.raw?.['timestampMissing']).toBe(true);
  });
});

describe('DouyinProvider', () => {
  it('从 aweme_info 提取，statistics 映射到 metrics', async () => {
    const { http, client: c } = client([
      {
        match: 'fetch_general_search_v1',
        reply: ok({
          data: [
            {
              aweme_info: {
                aweme_id: 'aw1',
                desc: '这个吹风机噪音也太大了',
                create_time: 1785000000,
                share_url: 'https://v.douyin.com/abc/',
                author: { nickname: '测评君', uid: 'uid123' },
                statistics: {
                  digg_count: 1000,
                  comment_count: 200,
                  share_count: 50,
                  play_count: 90000,
                },
              },
            },
          ],
        }),
      },
    ]);
    const p = new DouyinProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: '吹风机', limit: 10 });
    const it = bundle.items[0]!;

    expect(it.text).toBe('这个吹风机噪音也太大了');
    expect(it.id).toBe('aw1');
    expect(it.url).toBe('https://v.douyin.com/abc/');
    expect(it.author).toBe('测评君');
    expect(it.authorId).toBe('uid123');
    expect(it.metrics).toEqual({ likes: 1000, comments: 200, shares: 50, views: 90000 });
  });
});

describe('TikTokProvider', () => {
  it('从 item 提取，stats/createTime 与抖音字段名不同', async () => {
    const { http, client: c } = client([
      {
        match: 'fetch_general_search',
        reply: ok({
          data: [
            {
              item: {
                id: 'tt1',
                desc: 'this blender broke in a week',
                createTime: 1785000000,
                share_url: 'https://www.tiktok.com/@x/video/tt1',
                author: { nickname: 'reviewer', uniqueId: 'reviewer_x' },
                stats: { digg_count: 30, comment_count: 4, share_count: 1, play_count: 800 },
              },
            },
          ],
        }),
      },
    ]);
    const p = new TikTokProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'blender', limit: 10 });
    const it = bundle.items[0]!;

    expect(it.text).toBe('this blender broke in a week');
    expect(it.id).toBe('tt1');
    expect(it.author).toBe('reviewer');
    expect(it.authorId).toBe('reviewer_x');
    expect(it.metrics?.views).toBe(800);
  });
});

describe('分页', () => {
  it('满页则继续翻，不满页即停', async () => {
    let page = 0;
    const { http, client: c, calls } = client([
      {
        match: 'search_notes',
        reply: () => {
          page += 1;
          // 第一页给满 20 条，第二页只给 1 条 -> 应停在第二页
          const n = page === 1 ? 20 : 1;
          return ok({
            items: Array.from({ length: n }, (_, i) => ({
              note: {
                id: `p${page}n${i}`,
                title: `第${page}页第${i}条内容足够长`,
                timestamp: 1785000000,
                user: {},
              },
            })),
          });
        },
      },
    ]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'x', limit: 50 });
    expect(calls).toHaveLength(2);
    expect(bundle.items).toHaveLength(21);
  });

  it('不超过 limit', async () => {
    const { http, client: c } = client([
      {
        match: 'search_notes',
        reply: ok({
          items: Array.from({ length: 20 }, (_, i) => ({
            note: { id: `n${i}`, title: `内容足够长的标题${i}`, timestamp: 1785000000, user: {} },
          })),
        }),
      },
    ]);
    const p = new XiaohongshuProvider({ http, client: c });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5 });
    expect(bundle.items).toHaveLength(5);
  });
});
