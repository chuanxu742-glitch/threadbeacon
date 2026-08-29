import { BlueskyJetstreamProvider } from './providers/bluesky-jetstream.js';
import { PoliteHttpClient } from './providers/http.js';
import { RedditProvider } from './providers/reddit.js';
import { ProviderRegistry } from './providers/registry.js';
import { registerTikHub } from './providers/tikhub/index.js';
import { SpiderXhsProvider } from './providers/xiaohongshu/spider-xhs.js';
import { YouTubeProvider } from './providers/youtube.js';

/**
 * 构造一套可执行的数据源注册表。
 *
 * CLI 与分布式 Worker 共用这里，避免两种运行方式逐渐出现能力差异。
 */
export function buildRegistry(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const registry = new ProviderRegistry();

  registry.register(new BlueskyJetstreamProvider({ http: new PoliteHttpClient() }));

  if (env['REDDIT_CLIENT_ID'] && env['REDDIT_CLIENT_SECRET']) {
    registry.register(
      new RedditProvider({
        http: new PoliteHttpClient({ authMode: 'app-credential' }),
        clientId: env['REDDIT_CLIENT_ID'],
        clientSecret: env['REDDIT_CLIENT_SECRET'],
        ...(env['REDDIT_USER_AGENT'] ? { userAgent: env['REDDIT_USER_AGENT'] } : {}),
      }),
    );
  }

  if (env['YOUTUBE_API_KEY']) {
    registry.register(
      new YouTubeProvider({
        http: new PoliteHttpClient({ authMode: 'app-credential' }),
        apiKey: env['YOUTUBE_API_KEY'],
      }),
    );
  }

  if (env['SPIDER_XHS_PATH']) {
    registry.register(
      new SpiderXhsProvider({
        spiderPath: env['SPIDER_XHS_PATH'],
        cookieFile: env['SPIDER_XHS_COOKIE'] ?? '.spider-xhs-cookie.json',
        ...(env['PYTHON_BIN'] ? { pythonBin: env['PYTHON_BIN'] } : {}),
      }),
    );
  }

  if (env['TIKHUB_API_KEY']) {
    registerTikHub(registry, {
      apiToken: env['TIKHUB_API_KEY'],
      useChinaDomain: env['TIKHUB_USE_CN_DOMAIN'] === '1',
      ...(env['TIKHUB_MAX_COMMENTS']
        ? { maxCommentsPerPost: Number(env['TIKHUB_MAX_COMMENTS']) }
        : {}),
    });
  }

  return registry;
}
