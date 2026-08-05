import { describe, expect, it } from 'vitest';
import { BlueskyProvider } from '../src/providers/bluesky.js';
import { RedditProvider } from '../src/providers/reddit.js';
import { YouTubeProvider } from '../src/providers/youtube.js';
import type { AuthMode, HttpPort } from '../src/providers/http.js';

/** 按 URL 子串路由的假 HTTP 端口，记录全部请求。 */
function fakeHttp(
  routes: ReadonlyArray<{ match: string; reply: unknown | (() => unknown) }>,
  authMode: AuthMode = 'anonymous',
) {
  const calls: string[] = [];
  const resolve = (url: string): unknown => {
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`未预置的路由：${url}`);
    return typeof hit.reply === 'function' ? (hit.reply as () => unknown)() : hit.reply;
  };
  const port: HttpPort = {
    authMode,
    async getJson<T>(url: string): Promise<T> {
      calls.push(url);
      return resolve(url) as T;
    },
    async postForm<T>(url: string): Promise<T> {
      calls.push(url);
      return resolve(url) as T;
    },
  };
  return { port, calls };
}

const bskyPost = (text: string, createdAt: string, lang?: string) => ({
  // 这些标识符字段刻意保留在假响应里，用来验证它们不会流进产物
  uri: 'at://did:plc:abc123/app.bsky.feed.post/xyz',
  author: { did: 'did:plc:abc123', handle: 'someone.bsky.social' },
  record: { text, createdAt, ...(lang ? { langs: [lang] } : {}) },
});

describe('BlueskyProvider', () => {
  it('抽取正文与时间，并丢弃全部标识符', async () => {
    const { port } = fakeHttp([
      { match: 'searchPosts', reply: { posts: [bskyPost('续航太差', '2026-08-05T13:47:22Z', 'zh')] } },
    ]);
    const p = new BlueskyProvider({ http: port });

    const bundle = await p.searchAll({ keyword: '续航', limit: 10 });

    expect(bundle.items).toHaveLength(1);
    const item = bundle.items[0]!;
    expect(item.text).toBe('续航太差');
    expect(item.timeBucket).toBe('2026-08-05');
    expect(item.lang).toBe('zh');
    // 假响应里的 handle / did / uri 一个都不能出现
    const dump = JSON.stringify(bundle);
    expect(dump).not.toContain('someone.bsky.social');
    expect(dump).not.toContain('did:plc:abc123');
    expect(dump).not.toContain('at://');
  });

  it('provenance 如实记录 open-protocol / anonymous', async () => {
    const { port } = fakeHttp([{ match: 'searchPosts', reply: { posts: [] } }]);
    const p = new BlueskyProvider({ http: port });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5 });
    expect(bundle.provenance.kind).toBe('open-protocol');
    expect(bundle.provenance.auth).toBe('anonymous');
    expect(bundle.provenance.platform).toBe('bluesky');
  });

  it('跳过缺正文或缺时间的条目', async () => {
    const { port } = fakeHttp([
      {
        match: 'searchPosts',
        reply: {
          posts: [
            bskyPost('有效', '2026-08-05T00:00:00Z'),
            { record: { text: '没有时间' } },
            { record: { createdAt: '2026-08-05T00:00:00Z' } },
          ],
        },
      },
    ]);
    const p = new BlueskyProvider({ http: port });

    const bundle = await p.searchAll({ keyword: 'x', limit: 10 });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]!.text).toBe('有效');
  });

  it('按 cursor 翻页直到攒够 limit', async () => {
    let page = 0;
    const { port, calls } = fakeHttp([
      {
        match: 'searchPosts',
        reply: () => {
          page += 1;
          return page === 1
            ? { posts: [bskyPost('a', '2026-08-05T00:00:00Z')], cursor: 'c1' }
            : { posts: [bskyPost('b', '2026-08-05T00:00:00Z')] };
        },
      },
    ]);
    const p = new BlueskyProvider({ http: port });

    const bundle = await p.searchAll({ keyword: 'x', limit: 2 });
    expect(bundle.items.map((i) => i.text)).toEqual(['a', 'b']);
    expect(calls[1]).toContain('cursor=c1');
  });
});

describe('RedditProvider', () => {
  const deps = { clientId: 'id', clientSecret: 'secret' };

  it('先换 token 再检索，并声明 app-credential', async () => {
    const { port, calls } = fakeHttp(
      [
        { match: 'access_token', reply: { access_token: 'tok', expires_in: 3600 } },
        {
          match: '/search',
          reply: {
            data: {
              children: [{ data: { title: '标题', selftext: '正文', created_utc: 1785000000 } }],
            },
          },
        },
      ],
      'app-credential',
    );
    const p = new RedditProvider({ http: port, ...deps });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5 });

    expect(calls[0]).toContain('access_token');
    expect(calls[1]).toContain('/search');
    expect(bundle.items[0]!.text).toBe('标题\n\n正文');
    expect(bundle.provenance.auth).toBe('app-credential');
    expect(bundle.provenance.kind).toBe('official-api');
  });

  it('复用未过期的 token，不重复换取', async () => {
    const { port, calls } = fakeHttp(
      [
        { match: 'access_token', reply: { access_token: 'tok', expires_in: 3600 } },
        { match: '/search', reply: { data: { children: [] } } },
      ],
      'app-credential',
    );
    const p = new RedditProvider({ http: port, ...deps });

    await p.searchAll({ keyword: 'x', limit: 5 });
    await p.searchAll({ keyword: 'y', limit: 5 });

    expect(calls.filter((c) => c.includes('access_token'))).toHaveLength(1);
  });

  it('拿不到 token 时报出可操作的错误', async () => {
    const { port } = fakeHttp([{ match: 'access_token', reply: {} }], 'app-credential');
    const p = new RedditProvider({ http: port, ...deps });

    await expect(p.searchAll({ keyword: 'x', limit: 5 })).rejects.toThrow(/clientId/);
  });

  it('legalBasis 默认写明免费档不可商用', async () => {
    const { port } = fakeHttp([], 'app-credential');
    const p = new RedditProvider({ http: port, ...deps });
    expect(p.capability.legalBasis).toMatch(/非商业/);
  });
});

describe('YouTubeProvider', () => {
  it('把 key 放进 query，且 search 只发一次（配额极紧）', async () => {
    const { port, calls } = fakeHttp(
      [
        {
          match: '/search',
          reply: {
            items: [
              {
                id: { videoId: 'v1' },
                snippet: { title: '标题', description: '描述', publishedAt: '2026-08-05T00:00:00Z' },
              },
            ],
          },
        },
      ],
      'app-credential',
    );
    const p = new YouTubeProvider({ http: port, apiKey: 'KEY123' });

    const bundle = await p.searchAll({ keyword: 'x', limit: 200 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('key=KEY123');
    // limit 超过单页上限时收敛到 50，而不是翻页烧配额
    expect(calls[0]).toContain('maxResults=50');
    expect(bundle.items[0]!.text).toBe('标题\n\n描述');
  });

  it('includeComments 时追加评论', async () => {
    const { port } = fakeHttp(
      [
        {
          match: '/search',
          reply: {
            items: [
              { id: { videoId: 'v1' }, snippet: { title: 'T', publishedAt: '2026-08-05T00:00:00Z' } },
            ],
          },
        },
        {
          match: '/commentThreads',
          reply: {
            items: [
              {
                snippet: {
                  topLevelComment: {
                    snippet: { textOriginal: '评论内容', publishedAt: '2026-08-06T00:00:00Z' },
                  },
                },
              },
            ],
          },
        },
      ],
      'app-credential',
    );
    const p = new YouTubeProvider({ http: port, apiKey: 'K' });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5, includeComments: true });
    expect(bundle.items.map((i) => i.text)).toEqual(['T', '评论内容']);
  });

  it('关闭评论的视频返回错误时跳过而不中断', async () => {
    const { port } = fakeHttp(
      [
        {
          match: '/search',
          reply: {
            items: [
              { id: { videoId: 'v1' }, snippet: { title: 'T', publishedAt: '2026-08-05T00:00:00Z' } },
            ],
          },
        },
        {
          match: '/commentThreads',
          reply: () => {
            throw new Error('HTTP 403 commentsDisabled');
          },
        },
      ],
      'app-credential',
    );
    const p = new YouTubeProvider({ http: port, apiKey: 'K' });

    const bundle = await p.searchAll({ keyword: 'x', limit: 5, includeComments: true });
    expect(bundle.items.map((i) => i.text)).toEqual(['T']);
  });

  it('配额说明里记录 search.list 的独立配额桶', () => {
    const { port } = fakeHttp([], 'app-credential');
    const p = new YouTubeProvider({ http: port, apiKey: 'K' });
    expect(p.capability.quota?.note).toMatch(/search\.list/);
  });
});
