#!/usr/bin/env -S npx tsx
// caiji 命令行入口。
//
//   pnpm doctor                          检查各数据源可达性与凭据配置
//   pnpm cli analyze <platform> <关键词>  跑一次分析并落盘
//   pnpm cli list                        列出已有报告

import { ClusteringService } from './clustering/ClusteringService.js';
import { configureProxyFromEnv } from './net/proxy.js';
import { createLlmClient, llmConfigFromEnv } from './llm/index.js';
import { analyze } from './pipeline/analyze.js';
import { DEFAULT_STORE_DIR, listReports, saveReport } from './pipeline/store.js';
import { BlueskyJetstreamProvider } from './providers/bluesky-jetstream.js';
import { PoliteHttpClient } from './providers/http.js';
import { RedditProvider } from './providers/reddit.js';
import { ProviderRegistry } from './providers/registry.js';
import { YouTubeProvider } from './providers/youtube.js';
import type { Platform } from './providers/types.js';

const env = process.env;

/** 各数据源的探测目标。doctor 用它判断「装不上」还是「连不上」。 */
const PROBES: ReadonlyArray<{ name: string; url: string; needs: string[] }> = [
  { name: 'Bluesky', url: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app', needs: [] },
  { name: 'Reddit', url: 'https://www.reddit.com/robots.txt', needs: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
  { name: 'YouTube', url: 'https://www.googleapis.com/discovery/v1/apis', needs: ['YOUTUBE_API_KEY'] },
];

function buildRegistry(): ProviderRegistry {
  const reg = new ProviderRegistry();
  // Bluesky 的历史检索需用户凭据（实测 403），只注册无需授权的实时流
  reg.register(new BlueskyJetstreamProvider({ http: new PoliteHttpClient() }));

  if (env['REDDIT_CLIENT_ID'] && env['REDDIT_CLIENT_SECRET']) {
    reg.register(
      new RedditProvider({
        http: new PoliteHttpClient({ authMode: 'app-credential' }),
        clientId: env['REDDIT_CLIENT_ID'],
        clientSecret: env['REDDIT_CLIENT_SECRET'],
        ...(env['REDDIT_USER_AGENT'] ? { userAgent: env['REDDIT_USER_AGENT'] } : {}),
      }),
    );
  }
  if (env['YOUTUBE_API_KEY']) {
    reg.register(
      new YouTubeProvider({
        http: new PoliteHttpClient({ authMode: 'app-credential' }),
        apiKey: env['YOUTUBE_API_KEY'],
      }),
    );
  }
  return reg;
}

async function doctor(): Promise<number> {
  const proxy = env['HTTPS_PROXY'] ?? env['HTTP_PROXY'];
  console.log(`代理：${proxy ?? '未配置（如所在网络不可达，请设置 HTTPS_PROXY）'}\n`);

  let blocked = 0;
  for (const p of PROBES) {
    const missing = p.needs.filter((k) => !env[k]);
    const t0 = Date.now();
    let net: string;
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(15_000) });
      net = `可达 (HTTP ${res.status}, ${Date.now() - t0}ms)`;
    } catch (e) {
      blocked += 1;
      net = `不可达 (${e instanceof Error ? e.name : '未知'}, ${Date.now() - t0}ms)`;
    }
    const creds = missing.length === 0 ? '凭据已配置' : `缺少 ${missing.join(', ')}`;
    console.log(`${p.name.padEnd(9)} ${net.padEnd(34)} ${creds}`);
  }

  console.log('');
  try {
    const cfg = llmConfigFromEnv(env);
    console.log(`LLM       已配置：${cfg.model}${cfg.baseUrl ? ` @ ${cfg.baseUrl}` : ''}`);
  } catch (e) {
    console.log(`LLM       未配置：${e instanceof Error ? e.message : e}`);
  }

  if (blocked > 0) {
    console.log(
      `\n${blocked} 个数据源不可达。若 DNS 能解析但连接超时，通常是网络层阻断 —— ` +
        `设置 HTTPS_PROXY 后重试。`,
    );
  }
  return 0;
}

async function runAnalyze(platform: string, keyword: string, limitArg?: string): Promise<number> {
  const limit = Number.parseInt(limitArg ?? '100', 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`limit 必须是正整数，收到 "${limitArg}"`);
    return 2;
  }

  const registry = buildRegistry();
  const available = [
    ...new Set([
      ...registry.platformsSupporting('searchAll'),
      ...registry.platformsSupporting('streamLive'),
    ]),
  ];
  if (!available.includes(platform as Platform)) {
    console.error(
      `平台 "${platform}" 不可用。当前已注册的平台：${available.join(', ') || '（无）'}\n` +
        `未注册的平台通常是缺少凭据，见 .env.example。`,
    );
    return 2;
  }

  const llm = createLlmClient(llmConfigFromEnv(env));
  const report = await analyze(
    { registry, clustering: new ClusteringService(), llm },
    { platform: platform as Platform, keyword, limit },
  );

  const file = await saveReport(report, { label: keyword });
  console.log(`共 ${report.stats.totalTexts} 条，聚出 ${report.stats.clusterCount} 个簇，` +
    `噪声 ${report.stats.noiseCount} 条，数据可靠性：${report.dataQuality}`);
  if (report.stats.redactedSummaries > 0) {
    console.log(`⚠️ ${report.stats.redactedSummaries} 条表述因疑似逐字引用原文被替换，建议收紧提示词`);
  }
  for (const p of report.painPoints) {
    console.log(`\n[${p.severity}/5] ${p.theme}（${p.size} 条）\n  ${p.summary}`);
  }
  console.log(`\n已写入 ${file}`);
  return 0;
}

async function main(): Promise<number> {
  // 代理必须在任何出站请求之前配置，且要覆盖 LLM SDK 的 fetch
  await configureProxyFromEnv(env);
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case 'doctor':
      return doctor();
    case 'analyze': {
      const [platform, keyword, limit] = rest;
      if (!platform || !keyword) {
        console.error('用法：pnpm cli analyze <platform> <关键词> [limit]');
        return 2;
      }
      return runAnalyze(platform, keyword, limit);
    }
    case 'list': {
      const files = await listReports();
      console.log(files.length ? files.join('\n') : `${DEFAULT_STORE_DIR} 下暂无报告`);
      return 0;
    }
    default:
      console.log(
        [
          'caiji —— 多平台社媒公开数据采集与聚合分析',
          '',
          '  pnpm doctor                          检查数据源可达性与凭据配置',
          '  pnpm cli analyze <platform> <关键词> [limit]   跑一次分析并落盘',
          '  pnpm cli list                        列出已有报告',
          '',
          '凭据配置见 .env.example；部署前请先读 DISCLAIMER.md。',
        ].join('\n'),
      );
      return cmd === undefined ? 0 : 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
