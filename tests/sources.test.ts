import { describe, expect, it } from 'vitest';
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
              children: [
                {
                  data: {
                    id: 'abc123',
                    title: '标题',
                    selftext: '正文',
                    created_utc: 1785000000,
                    author: 'some_redditor',
                    author_fullname: 't2_xyz',
                    permalink: '/r/gadgets/comments/abc123/title/',
                    subreddit: 'gadgets',
                    score: 42,
                    num_comments: 8,
                  },
                },
              ],
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
    expect(bundle.provenance.auth).toBe('app-credential');
    expect(bundle.provenance.kind).toBe('official-api');

    const item = bundle.items[0]!;
    expect(item.text).toBe('标题\n\n正文');
    expect(item.title).toBe('标题');
    expect(item.id).toBe('abc123');
    expect(item.author).toBe('some_redditor');
    expect(item.authorId).toBe('t2_xyz');
    expect(item.url).toBe('https://www.reddit.com/r/gadgets/comments/abc123/title/');
    expect(item.metrics?.likes).toBe(42);
    expect(item.metrics?.comments).toBe(8);
    expect(item.raw?.['subreddit']).toBe('gadgets');
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
                snippet: {
                  title: '标题',
                  description: '描述',
                  publishedAt: '2026-08-05T00:00:00Z',
                  channelId: 'UC123',
                  channelTitle: '某频道',
                },
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

    const item = bundle.items[0]!;
    expect(item.text).toBe('标题\n\n描述');
    expect(item.id).toBe('v1');
    expect(item.url).toBe('https://www.youtube.com/watch?v=v1');
    expect(item.author).toBe('某频道');
    expect(item.authorId).toBe('UC123');
    expect(item.itemType).toBe('post');
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
                  totalReplyCount: 3,
                  topLevelComment: {
                    id: 'cmt1',
                    snippet: {
                      textOriginal: '评论内容',
                      publishedAt: '2026-08-06T00:00:00Z',
                      authorDisplayName: '@viewer',
                      authorChannelId: { value: 'UCviewer' },
                      likeCount: 5,
                    },
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

    const comment = bundle.items[1]!;
    expect(comment.itemType).toBe('comment');
    // 评论靠 parentId 关联回视频
    expect(comment.parentId).toBe('v1');
    expect(comment.id).toBe('cmt1');
    expect(comment.author).toBe('@viewer');
    expect(comment.authorId).toBe('UCviewer');
    expect(comment.metrics).toEqual({ likes: 5, comments: 3 });
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
