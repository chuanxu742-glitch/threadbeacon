import { describe, expect, it } from 'vitest';
import {
  GenericSourceProvider,
  assertPublicSourceUrl,
  isPublicAddress,
  parseFeedItems,
  parseRestItems,
  parseWebPage,
  resolveSourceHeaders,
  robotsAllows,
  type SafeResponse,
  type SafeTransport,
} from '../src/providers/generic-web.js';

class FakeTransport implements SafeTransport {
  readonly calls: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
  constructor(private readonly responses: SafeResponse[]) {}
  async get(url: string, headers: Readonly<Record<string, string>> = {}): Promise<SafeResponse> {
    this.calls.push({ url, headers });
    const response = this.responses.shift();
    if (!response) throw new Error(`未预置响应：${url}`);
    return response;
  }
}

describe('generic source URL guard', () => {
  it('allows public hosts and rejects local/private/reserved targets', () => {
    expect(assertPublicSourceUrl('https://feeds.example.com/news.xml').hostname).toBe('feeds.example.com');
    for (const url of [
      'http://localhost/a', 'http://service.local/a', 'http://127.0.0.1/a',
      'http://10.1.2.3/a', 'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.2/a', 'http://[::1]/a', 'file:///etc/passwd',
      'https://user:password@example.com/a',
    ]) expect(() => assertPublicSourceUrl(url)).toThrow();
  });

  it('classifies representative IPv4 and IPv6 ranges', () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('100.64.1.1')).toBe(false);
    expect(isPublicAddress('198.51.100.2')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
    expect(isPublicAddress('fd00::1')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
  });

  it('keeps credential values out of source config by resolving env references', () => {
    const resolved = resolveSourceHeaders(
      { url: 'https://api.example.com', secretHeaders: { 'x-api-key': 'SOURCE_API_KEY' } },
      { SOURCE_API_KEY: 'secret-value' },
    );
    expect(resolved).toEqual({
      auth: 'app-credential',
      headers: expect.objectContaining({ 'x-api-key': 'secret-value' }),
    });
    expect(resolveSourceHeaders(
      { url: 'https://api.example.com', secretHeaders: { authorization: 'SOURCE_AUTH' } },
      { SOURCE_AUTH: 'Bearer app-token' },
    ).headers['authorization']).toBe('Bearer app-token');
    expect(() => resolveSourceHeaders(
      { url: 'https://api.example.com', headers: { authorization: 'inline-secret' } },
      {},
    )).toThrow('secretHeaders');
    expect(() => resolveSourceHeaders(
      { url: 'https://api.example.com', secretHeaders: { cookie: 'SOURCE_COOKIE' } },
      { SOURCE_COOKIE: 'x' },
    )).toThrow('不允许');
  });
});

describe('generic source parsing', () => {
  it('normalizes RSS 2.0 and Atom entries', () => {
    const rss = parseFeedItems(`<?xml version="1.0"?><rss><channel><item>
      <guid>p1</guid><title>新品</title><description>续航提升</description>
      <link>https://example.com/p1</link><pubDate>Wed, 27 Aug 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`, { url: 'https://example.com/feed.xml' });
    expect(rss[0]).toMatchObject({ platform: 'rss', id: 'p1', title: '新品', url: 'https://example.com/p1' });
    expect(rss[0]?.text).toBe('新品\n\n续航提升');

    const atom = parseFeedItems(`<feed><entry><id>a1</id><title>Atom 标题</title>
      <content>正文</content><link href="/a1"/><updated>2026-08-27T12:00:00Z</updated>
    </entry></feed>`, { url: 'https://example.com/feed' });
    expect(atom[0]).toMatchObject({ id: 'a1', url: 'https://example.com/a1' });
  });

  it('maps a nested REST array with configurable dotted fields', () => {
    const items = parseRestItems(
      { result: { rows: [{ key: '1', attributes: { heading: '标题', copy: '正文' }, created: 1787824800000 }] } },
      { url: 'https://api.example.com/items', itemsPath: 'result.rows', fields: {
        id: 'key', title: 'attributes.heading', content: 'attributes.copy', date: 'created',
      } },
    );
    expect(items[0]).toMatchObject({ id: '1', title: '标题', text: '标题\n\n正文' });
  });

  it('extracts readable page text without scripts', () => {
    const items = parseWebPage('<html><head><title>文档</title><script>steal()</script></head><body><h1>产品</h1><p>公开说明</p></body></html>', 'https://example.com/docs');
    expect(items[0]).toMatchObject({ title: '文档', text: '产品 公开说明' });
    expect(items[0]?.text).not.toContain('steal');
  });
});

describe('robots enforcement and RSS cursor', () => {
  it('uses longest matching rule and supports Allow overrides', () => {
    const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/public';
    expect(robotsAllows(robots, '/news')).toBe(true);
    expect(robotsAllows(robots, '/private/account')).toBe(false);
    expect(robotsAllows(robots, '/private/public/story')).toBe(true);
  });

  it('checks robots before loading a web page', async () => {
    const transport = new FakeTransport([
      { status: 200, url: 'https://example.com/robots.txt', headers: {}, body: 'User-agent: *\nDisallow: /admin' },
    ]);
    const provider = new GenericSourceProvider('web', { url: 'https://example.com/admin' }, transport);
    await expect(provider.searchAll({ keyword: '', limit: 5 })).rejects.toThrow('robots.txt 不允许');
    expect(transport.calls).toHaveLength(1);
  });

  it('sends conditional RSS headers and records the next cursor', async () => {
    const transport = new FakeTransport([{
      status: 200,
      url: 'https://example.com/feed',
      headers: { etag: '"v2"', 'last-modified': 'Thu, 27 Aug 2026 12:00:00 GMT' },
      body: '<rss><channel><item><title>一条</title><pubDate>2026-08-27T12:00:00Z</pubDate></item></channel></rss>',
    }]);
    const provider = new GenericSourceProvider('rss', {
      url: 'https://example.com/feed', cursor: { etag: '"v1"' },
    }, transport);
    const bundle = await provider.searchAll({ keyword: '', limit: 5 });
    expect(bundle.items).toHaveLength(1);
    expect(transport.calls[0]?.headers['if-none-match']).toBe('"v1"');
    expect(provider.cursor()).toEqual({ etag: '"v2"', lastModified: 'Thu, 27 Aug 2026 12:00:00 GMT' });
  });
});
