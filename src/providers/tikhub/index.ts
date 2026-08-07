// TikHub 接入的统一出口。
//
// 一个 token 打通三个平台，注册进 registry 后 analyze 就能按 platform 选路。
// B站已从本项目排除，原因见 providers/types.ts 的 Platform 注释。

import { PoliteHttpClient } from '../http.js';
import type { ProviderRegistry } from '../registry.js';
import { TikHubClient, TIKHUB_BASE_CN, type TikHubClientOptions } from './client.js';
import { DouyinProvider } from './douyin.js';
import { TikTokProvider } from './tiktok.js';
import { XiaohongshuProvider } from './xiaohongshu.js';

export { TikHubClient, TikHubError, TIKHUB_BASE, TIKHUB_BASE_CN } from './client.js';
export { TikHubProvider } from './base.js';
export { DouyinProvider } from './douyin.js';
export { TikTokProvider } from './tiktok.js';
export { XiaohongshuProvider } from './xiaohongshu.js';

export interface TikHubSetupOptions extends Omit<TikHubClientOptions, 'http'> {
  /** 中国大陆网络环境走 api.tikhub.dev。 */
  readonly useChinaDomain?: boolean;
  readonly maxCommentsPerPost?: number;
}

/**
 * 建好三个 TikHub provider。
 *
 * 共用一个 HttpPort 实例，因而共享按 host 的限流窗口 ——
 * 三个 provider 打的是同一个 api.tikhub.io，各自限流会把并发放大三倍。
 */
export function createTikHubProviders(opts: TikHubSetupOptions) {
  const http = new PoliteHttpClient({ authMode: 'app-credential' });
  const client = new TikHubClient({
    http,
    apiToken: opts.apiToken,
    ...(opts.baseUrl
      ? { baseUrl: opts.baseUrl }
      : opts.useChinaDomain
        ? { baseUrl: TIKHUB_BASE_CN }
        : {}),
  });

  const deps = {
    http,
    client,
    ...(opts.maxCommentsPerPost !== undefined
      ? { maxCommentsPerPost: opts.maxCommentsPerPost }
      : {}),
  };

  return [new XiaohongshuProvider(deps), new DouyinProvider(deps), new TikTokProvider(deps)];
}

/** 一次把三个平台注册进 registry。 */
export function registerTikHub(registry: ProviderRegistry, opts: TikHubSetupOptions): ProviderRegistry {
  for (const p of createTikHubProviders(opts)) registry.register(p);
  return registry;
}
