import { describe, expect, it } from 'vitest';
import {
  PoliteHttpClient,
  PolitePool,
  SessionCredentialError,
  UnexpectedCredentialError,
} from '../src/providers/http.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { IDataProvider, Platform, ProviderKind, TextBundle } from '../src/providers/types.js';
import { textsOf } from '../src/providers/types.js';

function stubProvider(
  id: string,
  platform: Platform,
  kind: ProviderKind,
  modes: Array<'searchAll' | 'fetchOwned'>,
): IDataProvider {
  const bundle: TextBundle = {
    items: [{ text: 'hello', timeBucket: '2026-08-05', platform }],
    provenance: {
      providerId: id,
      platform,
      kind,
      mode: modes[0] ?? 'searchAll',
      fetchedAt: '2026-08-05T00:00:00.000Z',
      legalBasis: 'test',
      robotsChecked: true,
      auth: 'anonymous',
    },
  };
  return {
    capability: {
      id,
      platform,
      kind,
      modes,
      canFetchComments: false,
      legalBasis: 'test',
    },
    ...(modes.includes('searchAll') ? { searchAll: async () => bundle } : {}),
    ...(modes.includes('fetchOwned') ? { fetchOwned: async () => bundle } : {}),
    checkAvailability: async () => true,
  };
}

describe('PoliteHttpClient 凭据策略', () => {
  it('anonymous 模式拒绝 Cookie', async () => {
    const http = new PoliteHttpClient();
    await expect(http.getJson('https://example.com/a', { Cookie: 'sid=1' })).rejects.toThrow(
      SessionCredentialError,
    );
  });

  it('app-credential 模式同样拒绝 Cookie —— 用户会话凭据在任何模式下都不允许', async () => {
    const http = new PoliteHttpClient({ authMode: 'app-credential' });
    await expect(http.getJson('https://example.com/a', { cookie: 'sid=1' })).rejects.toThrow(
      SessionCredentialError,
    );
  });

  it('anonymous 模式拒绝 Authorization，且大小写不敏感', async () => {
    const http = new PoliteHttpClient();
    await expect(
      http.getJson('https://example.com/a', { Authorization: 'Bearer x' }),
    ).rejects.toThrow(UnexpectedCredentialError);
  });

  it('app-credential 模式放行 Authorization —— 官方 API 是最合规的取数路径', async () => {
    const http = new PoliteHttpClient({ authMode: 'app-credential' });
    // 只验证凭据校验这一关放行；真实网络调用不在单测范围内
    await expect(
      http.getJson('http://127.0.0.1:9/never', { authorization: 'Bearer x' }),
    ).rejects.not.toThrow(UnexpectedCredentialError);
  });

  it('放行不含凭据的普通头', async () => {
    const http = new PoliteHttpClient();
    await expect(
      http.getJson('http://127.0.0.1:9/never', { 'user-agent': 'caiji/0.1' }),
    ).rejects.not.toThrow(SessionCredentialError);
  });

  it('默认档位是 anonymous', () => {
    expect(new PoliteHttpClient().authMode).toBe('anonymous');
  });
});

describe('PolitePool', () => {
  it('对同一 host 的请求保持最小间隔', async () => {
    const pool = new PolitePool(120);
    const stamps: number[] = [];
    const mark = () => {
      stamps.push(Date.now());
      return Promise.resolve(0);
    };
    await Promise.all([
      pool.schedule('a.example', mark),
      pool.schedule('a.example', mark),
      pool.schedule('a.example', mark),
    ]);
    expect(stamps).toHaveLength(3);
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(100);
    expect(stamps[2]! - stamps[1]!).toBeGreaterThanOrEqual(100);
  });

  it('不同 host 之间互不阻塞', async () => {
    const pool = new PolitePool(300);
    const t0 = Date.now();
    await Promise.all([
      pool.schedule('a.example', async () => 1),
      pool.schedule('b.example', async () => 2),
    ]);
    expect(Date.now() - t0).toBeLessThan(250);
  });
});

describe('ProviderRegistry', () => {
  it('按 (platform, kind) 二维索引，同一平台可并存多个供应商', () => {
    const reg = new ProviderRegistry()
      .register(stubProvider('yt-official', 'youtube', 'official-api', ['searchAll']))
      .register(stubProvider('yt-creator', 'youtube', 'user-authorized', ['fetchOwned']));

    expect(reg.get('youtube', 'official-api')?.capability.id).toBe('yt-official');
    expect(reg.get('youtube', 'user-authorized')?.capability.id).toBe('yt-creator');
    expect(reg.forPlatform('youtube')).toHaveLength(2);
  });

  it('拒绝重复注册同一 (platform, kind)', () => {
    const reg = new ProviderRegistry().register(
      stubProvider('a', 'reddit', 'official-api', ['searchAll']),
    );
    expect(() => reg.register(stubProvider('b', 'reddit', 'official-api', ['searchAll']))).toThrow();
  });

  it('resolve 按合规优先级选取：开放协议优先于官方 API', () => {
    const reg = new ProviderRegistry()
      .register(stubProvider('bsky-firehose', 'bluesky', 'open-protocol', ['searchAll']))
      .register(stubProvider('bsky-paid', 'bluesky', 'licensed-vendor', ['searchAll']));
    expect(reg.resolve('bluesky', 'searchAll')?.capability.id).toBe('bsky-firehose');
  });

  it('resolve 跳过不支持该模式的 provider', () => {
    const reg = new ProviderRegistry()
      .register(stubProvider('open-search-only', 'tiktok', 'open-protocol', ['searchAll']))
      .register(stubProvider('creator', 'tiktok', 'user-authorized', ['fetchOwned']));
    expect(reg.resolve('tiktok', 'fetchOwned')?.capability.id).toBe('creator');
  });

  it('platformsSupporting 只列出支持该模式的平台', () => {
    const reg = new ProviderRegistry()
      .register(stubProvider('a', 'reddit', 'official-api', ['searchAll']))
      .register(stubProvider('b', 'douyin', 'user-authorized', ['fetchOwned']));
    expect(reg.platformsSupporting('searchAll')).toEqual(['reddit']);
    expect(reg.platformsSupporting('fetchOwned')).toEqual(['douyin']);
  });
});

describe('textsOf', () => {
  it('把 TextBundle 收敛成聚类层唯一认识的 string[]', async () => {
    const p = stubProvider('x', 'reddit', 'official-api', ['searchAll']);
    const bundle = await p.searchAll!({ keyword: 'k', limit: 1 });
    expect(textsOf(bundle)).toEqual(['hello']);
  });
});
