import { describe, expect, it } from 'vitest';
import { ClusteringService } from '../src/clustering/ClusteringService.js';
import { analyze, summaryConcurrencyFromEnv } from '../src/pipeline/analyze.js';
import { gradeQuality } from '../src/pipeline/report.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { ChatRequest, ILlmClient, LlmResult } from '../src/llm/types.js';
import type { IDataProvider, SourceItem, TextBundle } from '../src/providers/types.js';
import { FakeEmbeddingProvider } from './helpers/fakeEmbedding.js';

const PROBES = ['续航', '价格'] as const;

const TEXTS = [
  '这个手机续航太差了，一天要充两次电，出门必须带充电宝才敢用',
  '续航能力完全不行，用了三个月明显下降，早上满电到下午就见底',
  '续航是最大的短板，希望下一代能把电池容量提上去，现在完全不够用',
  '价格实在太贵了，同配置别家便宜一半，性价比低到劝退',
  '这个价格买不下手，功能再好也超出预算了，等降价再说',
  '价格能降下来的话我会考虑入手，现在这个定价没有竞争力',
];

function item(text: string, i: number): SourceItem {
  return {
    text,
    postedAt: `2026-08-05T0${i}:00:00.000Z`,
    timeBucket: '2026-08-05',
    platform: 'bluesky',
    itemType: 'post',
    id: `post-${i}`,
    author: `user${i}.bsky.social`,
    authorId: `did:plc:fake${i}`,
    url: `https://bsky.app/profile/did:plc:fake${i}/post/post-${i}`,
    metrics: { likes: i, comments: 0, shares: 0 },
  };
}

function fakeProvider(texts: readonly string[]): IDataProvider {
  const bundle: TextBundle = {
    items: texts.map(item),
    provenance: {
      providerId: 'fake',
      platform: 'bluesky',
      kind: 'open-protocol',
      mode: 'searchAll',
      fetchedAt: '2026-08-05T00:00:00.000Z',
      legalBasis: 'test',
      robots: 'not-applicable',
      auth: 'anonymous',
    },
  };
  return {
    capability: {
      id: 'fake',
      platform: 'bluesky',
      kind: 'open-protocol',
      modes: ['searchAll'],
      canFetchComments: false,
      legalBasis: 'test',
      robots: 'not-applicable',
    },
    searchAll: async () => bundle,
    checkAvailability: async () => true,
  };
}

/** 按需返回固定文本的假 LLM。 */
function fakeLlm(replyFor: (req: ChatRequest) => string, refused = false): ILlmClient {
  return {
    format: 'openai',
    model: 'fake',
    async complete(req: ChatRequest): Promise<LlmResult> {
      return {
        text: replyFor(req),
        model: 'fake',
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: refused ? 'refusal' : 'end_turn',
        refused,
      };
    },
  };
}

const goodJson = (theme: string) =>
  JSON.stringify({
    theme,
    summary: `用户群体普遍反映${theme}方面存在明显不足，影响日常使用体验。`,
    keywords: [theme],
    severity: 4,
  });

function deps(llm: ILlmClient, texts: readonly string[] = TEXTS) {
  const registry = new ProviderRegistry().register(fakeProvider(texts));
  const clustering = new ClusteringService(new FakeEmbeddingProvider(PROBES), { minSamples: 3 });
  return { registry, clustering, llm };
}

const req = { platform: 'bluesky' as const, keyword: 'x', limit: 50 };

describe('analyze 端到端', () => {
  it('跑通 provider → 聚类 → LLM → 产物', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);

    expect(report.painPoints).toHaveLength(2);
    expect(report.stats.clusterCount).toBe(2);
    expect(report.stats.noiseCount).toBe(0);
    expect(report.stats.summarizedClusters).toBe(2);
    expect(report.stats.skippedClusters).toBe(0);
    expect(report.painPoints.map((p) => p.theme).sort()).toEqual(['价格', '续航']);
    expect(report.provenance.auth).toBe('anonymous');
    expect(report.keyword).toBe('x');
  });

  it('产物保留全量原始记录与标识符', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);

    expect(report.items).toHaveLength(TEXTS.length);
    const dump = JSON.stringify(report);
    for (const t of TEXTS) {
      expect(dump).toContain(t);
    }
    expect(report.items[0]!.author).toBe('user0.bsky.social');
    expect(report.items[0]!.url).toContain('bsky.app');
    expect(report.items[0]!.postedAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('memberIndices 指回 items 的正确下标', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);

    for (const p of report.painPoints) {
      expect(p.memberIndices).toHaveLength(p.size);
      // 每个下标指向的 item，其文本必须确实属于这个簇
      for (const idx of p.memberIndices) {
        expect(report.items[idx]).toBeDefined();
        expect(p.texts).toContain(report.items[idx]!.text);
      }
    }
  });

  it('清洗过滤掉部分文本后 memberIndices 仍对得上', async () => {
    // 前面插入会被清洗掉的噪音（纯符号、过短），下标会整体错位
    const noisy = ['!!!', '哈哈', ...TEXTS];
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm, noisy), req);

    expect(report.items).toHaveLength(noisy.length);
    for (const p of report.painPoints) {
      for (const idx of p.memberIndices) {
        expect(p.texts).toContain(report.items[idx]!.text);
      }
    }
  });

  it('LLM 拒答时跳过该簇而不中断整轮', async () => {
    const report = await analyze(deps(fakeLlm(() => '', true)), req);
    expect(report.painPoints).toHaveLength(0);
    expect(report.stats.clusterCount).toBe(2);
    expect(report.stats.summarizedClusters).toBe(0);
    expect(report.stats.skippedClusters).toBe(2);
    // 洞察没出来，但原始数据仍然完整落下
    expect(report.items).toHaveLength(TEXTS.length);
  });

  it('LLM 输出不可解析时跳过该簇', async () => {
    const report = await analyze(deps(fakeLlm(() => '这不是 JSON')), req);
    expect(report.painPoints).toHaveLength(0);
  });

  it('容忍 LLM 给 JSON 套代码块围栏', async () => {
    const llm = fakeLlm(() => '```json\n' + goodJson('续航') + '\n```');
    const report = await analyze(deps(llm), req);
    expect(report.painPoints.length).toBeGreaterThan(0);
  });

  it('severity 超范围时收敛到 0-5', async () => {
    const llm = fakeLlm(() =>
      JSON.stringify({ theme: 'T', summary: '概括表述。', keywords: [], severity: 99 }),
    );
    const report = await analyze(deps(llm), req);
    expect(report.painPoints.every((p) => p.severity >= 0 && p.severity <= 5)).toBe(true);
  });

  it('平台完全没有可用 provider 时给出可操作的报错', async () => {
    const llm = fakeLlm(() => goodJson('x'));
    await expect(analyze(deps(llm), { ...req, platform: 'xiaohongshu' })).rejects.toThrow(
      /既没有可用的 searchAll，也没有 streamLive/,
    );
  });

  it('显式要求 searchAll 时不静默回退到实时流', async () => {
    const llm = fakeLlm(() => goodJson('x'));
    await expect(
      analyze(deps(llm), { ...req, platform: 'xiaohongshu', mode: 'searchAll' }),
    ).rejects.toThrow(/没有注册支持 searchAll/);
  });

  it('没有 searchAll 但有 streamLive 时自动回退', async () => {
    const streamed: TextBundle = {
      items: [item('续航很差需要频繁充电', 0)],
      provenance: {
        providerId: 'stream',
        platform: 'bluesky',
        kind: 'open-protocol',
        mode: 'streamLive',
        fetchedAt: '2026-08-05T00:00:00.000Z',
        legalBasis: 'test',
        robots: 'not-applicable',
        auth: 'anonymous',
      },
    };
    const registry = new ProviderRegistry().register({
      capability: {
        id: 'stream',
        platform: 'bluesky',
        kind: 'open-protocol',
        modes: ['streamLive'],
        canFetchComments: false,
        legalBasis: 'test',
        robots: 'not-applicable',
      },
      streamLive: async () => streamed,
      checkAvailability: async () => true,
    });
    const clustering = new ClusteringService(new FakeEmbeddingProvider(PROBES), { minSamples: 3 });

    const report = await analyze({ registry, clustering, llm: fakeLlm(() => goodJson('续航')) }, req);
    expect(report.provenance.mode).toBe('streamLive');
  });

  it('样本量小时标记为 exploratory', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);
    expect(report.dataQuality).toBe('exploratory');
  });

  it('并行归纳受 summaryConcurrency 上限约束', async () => {
    let active = 0;
    let maxActive = 0;
    async function asyncReply(r: ChatRequest): Promise<string> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格');
    }

    // fakeLlm 原本接受同步回调；这里直接覆盖 complete 来模拟真实异步请求。
    const asyncLlm: ILlmClient = {
      format: 'openai',
      model: 'fake',
      async complete(r) {
        return {
          text: await asyncReply(r),
          model: 'fake',
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: 'end_turn',
          refused: false,
        };
      },
    };
    await analyze({ ...deps(asyncLlm), summaryConcurrency: 1 }, req);
    expect(maxActive).toBe(1);
  });

  it('库入口拒绝空关键词、无效 limit 与无效并发数', async () => {
    const llm = fakeLlm(() => goodJson('x'));
    await expect(analyze(deps(llm), { ...req, keyword: '  ' })).rejects.toThrow(/keyword/);
    await expect(analyze(deps(llm), { ...req, limit: 0 })).rejects.toThrow(/limit/);
    await expect(analyze({ ...deps(llm), summaryConcurrency: 0 }, req)).rejects.toThrow(
      /summaryConcurrency/,
    );
  });
});

describe('gradeQuality', () => {
  it('按聚类样本量分三档', () => {
    expect(gradeQuality(10)).toBe('exploratory');
    expect(gradeQuality(50)).toBe('preliminary');
    expect(gradeQuality(200)).toBe('reliable');
  });
});

describe('summaryConcurrencyFromEnv', () => {
  it('默认 4，且拒绝无效值', () => {
    expect(summaryConcurrencyFromEnv({})).toBe(4);
    expect(summaryConcurrencyFromEnv({ LLM_MAX_CONCURRENCY: '2' })).toBe(2);
    expect(() => summaryConcurrencyFromEnv({ LLM_MAX_CONCURRENCY: '0' })).toThrow(/正整数/);
    expect(() => summaryConcurrencyFromEnv({ LLM_MAX_CONCURRENCY: 'abc' })).toThrow(/正整数/);
  });
});
