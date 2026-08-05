import { describe, expect, it } from 'vitest';
import { ClusteringService } from '../src/clustering/ClusteringService.js';
import { analyze } from '../src/pipeline/analyze.js';
import { containsVerbatim, gradeQuality } from '../src/pipeline/report.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { ChatRequest, ILlmClient, LlmResult } from '../src/llm/types.js';
import type { IDataProvider, TextBundle } from '../src/providers/types.js';
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

function fakeProvider(texts: readonly string[]): IDataProvider {
  const bundle: TextBundle = {
    items: texts.map((text) => ({ text, timeBucket: '2026-08-05', platform: 'bluesky' as const })),
    provenance: {
      providerId: 'fake',
      platform: 'bluesky',
      kind: 'open-protocol',
      mode: 'searchAll',
      fetchedAt: '2026-08-05T00:00:00.000Z',
      legalBasis: 'test',
      robotsChecked: true,
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
  const clustering = new ClusteringService(new FakeEmbeddingProvider(PROBES), {
    minSamples: 3,
    unsafeAllowSmallClusters: true,
  });
  return { registry, clustering, llm };
}

const req = { platform: 'bluesky' as const, keyword: 'x', limit: 50 };

describe('analyze 端到端', () => {
  it('跑通 provider → 聚类 → LLM → 聚类级产物', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);

    expect(report.painPoints).toHaveLength(2);
    expect(report.stats.clusterCount).toBe(2);
    expect(report.stats.noiseCount).toBe(0);
    expect(report.painPoints.map((p) => p.theme).sort()).toEqual(['价格', '续航']);
    expect(report.provenance.auth).toBe('anonymous');
  });

  it('产物中不含任何原文 —— 这是整个架构的目的', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);

    const dump = JSON.stringify(report);
    for (const t of TEXTS) {
      expect(dump).not.toContain(t);
    }
    // 也不该出现单条级别的字段
    expect(dump).not.toContain('timeBucket');
  });

  it('LLM 逐字回显原文时替换该表述并计数', async () => {
    // 让 LLM 把第一条原文原样塞进 summary
    const llm = fakeLlm((r) => {
      const first = r.messages[0]!.content.split('\n---\n')[0]!;
      return JSON.stringify({ theme: '主题', summary: first, keywords: [], severity: 3 });
    });
    const report = await analyze(deps(llm), req);

    expect(report.stats.redactedSummaries).toBe(2);
    const dump = JSON.stringify(report);
    for (const t of TEXTS) expect(dump).not.toContain(t);
    expect(report.painPoints[0]!.summary).toMatch(/略去细节/);
  });

  it('LLM 拒答时跳过该簇而不中断整轮', async () => {
    const report = await analyze(deps(fakeLlm(() => '', true)), req);
    expect(report.painPoints).toHaveLength(0);
    expect(report.stats.clusterCount).toBe(2);
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

  it('severity 超范围时收敛到 0–5', async () => {
    const llm = fakeLlm(() =>
      JSON.stringify({ theme: 'T', summary: '概括表述，与原文无关。', keywords: [], severity: 99 }),
    );
    const report = await analyze(deps(llm), req);
    expect(report.painPoints.every((p) => p.severity >= 0 && p.severity <= 5)).toBe(true);
  });

  it('平台没有 searchAll provider 时给出可操作的报错', async () => {
    const llm = fakeLlm(() => goodJson('x'));
    await expect(
      analyze(deps(llm), { ...req, platform: 'xiaohongshu' }),
    ).rejects.toThrow(/没有注册支持 searchAll/);
  });

  it('样本量小时标记为 exploratory', async () => {
    const llm = fakeLlm((r) => goodJson(r.messages[0]!.content.includes('续航') ? '续航' : '价格'));
    const report = await analyze(deps(llm), req);
    expect(report.dataQuality).toBe('exploratory');
  });
});

describe('containsVerbatim', () => {
  it('识别整条回显', () => {
    expect(containsVerbatim('前缀 续航太差 后缀', ['续航太差'])).toBe(true);
  });

  it('识别长文本中的片段摘录', () => {
    const input = '这个手机续航太差了，一天要充两次电，出门必须带充电宝才敢用';
    expect(containsVerbatim(`用户提到「${input.slice(6, 40)}」这一点`, [input])).toBe(true);
  });

  it('对真正的改写不误报', () => {
    expect(
      containsVerbatim('用户群体普遍反映电池表现不足，需要频繁补电。', [
        '这个手机续航太差了，一天要充两次电，出门必须带充电宝才敢用',
      ]),
    ).toBe(false);
  });

  it('忽略空白差异', () => {
    expect(containsVerbatim('a  b', ['a b'])).toBe(true);
  });
});

describe('gradeQuality', () => {
  it('按聚类样本量分三档', () => {
    expect(gradeQuality(10)).toBe('exploratory');
    expect(gradeQuality(50)).toBe('preliminary');
    expect(gradeQuality(200)).toBe('reliable');
  });
});
