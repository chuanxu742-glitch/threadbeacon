#!/usr/bin/env -S npx tsx
// threadbeacon 命令行入口。
//
//   pnpm doctor                          检查各数据源可达性与凭据配置
//   pnpm cli analyze <platform> <关键词>  跑一次分析并落盘
//   pnpm cli list                        列出已有报告

import { ClusteringService } from './clustering/ClusteringService.js';
import { loadEnvFiles } from './env.js';
import { configureProxyFromEnv } from './net/proxy.js';
import { createLlmClient, llmConfigFromEnv } from './llm/index.js';
import { analyze, summaryConcurrencyFromEnv } from './pipeline/analyze.js';
import { DEFAULT_STORE_DIR, listReports, loadReport, saveReport } from './pipeline/store.js';
import { createOpenCliProvider } from './providers/opencli.js';
import type { Platform } from './providers/types.js';
import { buildRegistry } from './runtime.js';

const env = process.env;

/** 各数据源的探测目标。doctor 用它判断「装不上」还是「连不上」。 */
const PROBES: ReadonlyArray<{ name: string; url: string; needs: string[] }> = [
  { name: 'Bluesky', url: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app', needs: [] },
  { name: 'Reddit', url: 'https://www.reddit.com/robots.txt', needs: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
  { name: 'YouTube', url: 'https://www.googleapis.com/discovery/v1/apis', needs: ['YOUTUBE_API_KEY'] },
  // 一个 key 覆盖小红书 / 抖音 / TikTok
  { name: 'TikHub', url: 'https://api.tikhub.io/health', needs: ['TIKHUB_API_KEY'] },
];

async function doctor(envFiles: readonly string[]): Promise<number> {
  console.log(
    `配置来源：${envFiles.length ? envFiles.join(' + ') : '仅系统环境变量（未找到 .env.local / .env）'}`,
  );
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
  if (platform.startsWith('opencli:')) {
    registry.register(await createOpenCliProvider(platform.slice('opencli:'.length)));
  }
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
    {
      registry,
      clustering: new ClusteringService(),
      llm,
      summaryConcurrency: summaryConcurrencyFromEnv(env),
    },
    { platform: platform as Platform, keyword, limit, includeComments: true },
  );

  const saved = await saveReport(report, { label: keyword });
  const posts = report.items.filter((i) => i.itemType === 'post').length;
  const comments = report.items.length - posts;

  console.log(
    `共 ${report.stats.totalTexts} 条（帖子 ${posts} / 评论 ${comments}），` +
      `聚出 ${report.stats.clusterCount} 个簇，噪声 ${report.stats.noiseCount} 条，` +
      `完成归纳 ${report.stats.summarizedClusters}/${report.stats.clusterCount} 个簇，` +
      `数据可靠性：${report.dataQuality}`,
  );
  if (report.stats.skippedClusters > 0) {
    console.warn(
      `警告：${report.stats.skippedClusters} 个簇因模型拒答、空响应或非法 JSON 未生成洞察；` +
        `原始数据仍已完整保留。`,
    );
  }
  for (const p of report.painPoints) {
    console.log(`\n[${p.severity}/5] ${p.theme}（${p.size} 条）\n  ${p.summary}`);
  }
  console.log(`\n已写入 ${saved.dir}`);
  for (const f of saved.files) console.log(`  ${f}`);
  return 0;
}

/** 把已有报告重新导出一遍。改了导出格式后不必重新采集。 */
async function runExport(target: string): Promise<number> {
  let report;
  try {
    report = await loadReport(target);
  } catch (e) {
    console.error(`读不到报告 "${target}"：${e instanceof Error ? e.message : e}`);
    return 2;
  }
  const saved = await saveReport(report, { label: report.keyword });
  console.log(`已导出到 ${saved.dir}`);
  for (const f of saved.files) console.log(`  ${f}`);
  return 0;
}

async function main(): Promise<number> {
  // env 文件要最先读：代理地址与各数据源凭据都可能写在 .env.local 里
  const envFiles = loadEnvFiles();
  // 代理必须在任何出站请求之前配置，且要覆盖 LLM SDK 的 fetch
  await configureProxyFromEnv(env);
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case 'doctor':
      return doctor(envFiles);
    case 'analyze': {
      const [platform, keyword, limit] = rest;
      if (!platform || !keyword) {
        console.error('用法：pnpm cli analyze <platform> <关键词> [limit]');
        return 2;
      }
      return runAnalyze(platform, keyword, limit);
    }
    case 'list': {
      const dirs = await listReports();
      console.log(dirs.length ? dirs.join('\n') : `${DEFAULT_STORE_DIR} 下暂无报告`);
      return 0;
    }
    case 'export': {
      const [target] = rest;
      if (!target) {
        console.error('用法：pnpm cli export <报告目录或 report.json 路径>');
        return 2;
      }
      return runExport(target);
    }
    default:
      console.log(
        [
          'threadbeacon —— 多平台社媒公开数据采集与聚合分析',
          '',
          '  pnpm doctor                          检查数据源可达性与凭据配置',
          '  pnpm cli analyze <platform> <关键词> [limit]   采集、分析并落盘',
          '      OpenCLI 平台写作 opencli:<site>，例如 opencli:hackernews',
          '  pnpm cli list                        列出已有报告',
          '  pnpm cli export <目录>                重新导出已有报告的 CSV/JSON',
          '',
          '每次分析落一个目录，含 report.json 与 posts/comments/clusters 三张 CSV。',
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
