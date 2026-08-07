// 端到端编排：provider → 聚类 → LLM 归纳 → 产物（洞察 + 全量原始记录）。

import { ClusteringService, type ClusterResult } from '../clustering/ClusteringService.js';
import type { ILlmClient } from '../llm/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { textsOf, type Platform, type TextBundle } from '../providers/types.js';
import { gradeQuality, type AnalysisReport, type PainPoint } from './report.js';

export interface AnalyzeDeps {
  readonly registry: ProviderRegistry;
  readonly clustering: ClusteringService;
  readonly llm: ILlmClient;
}

export interface AnalyzeRequest {
  readonly platform: Platform;
  readonly keyword: string;
  readonly limit: number;
  readonly includeComments?: boolean;
  /**
   * 取数模式。省略时自动选择：优先 searchAll（能拿历史），
   * 该平台没有可用的历史检索时退到 streamLive（只能拿订阅期间的增量）。
   */
  readonly mode?: 'searchAll' | 'streamLive';
  /** streamLive 模式的最长订阅时长，默认 60 秒。 */
  readonly maxDurationMs?: number;
}

const DEFAULT_STREAM_MS = 60_000;

/** 按模式取数。把「选哪条路」与「怎么分析」分开，编排逻辑才不会被模式差异污染。 */
async function collect(deps: AnalyzeDeps, req: AnalyzeRequest): Promise<TextBundle> {
  const wanted = req.mode;

  if (wanted !== 'streamLive') {
    const p = deps.registry.resolve(req.platform, 'searchAll');
    if (p?.searchAll) {
      return p.searchAll({
        keyword: req.keyword,
        limit: req.limit,
        ...(req.includeComments !== undefined ? { includeComments: req.includeComments } : {}),
      });
    }
    if (wanted === 'searchAll') {
      throw new Error(
        `平台 ${req.platform} 没有注册支持 searchAll 的 provider。` +
          `多数合规来源只能取授权账号自有内容或订阅实时流。`,
      );
    }
  }

  const s = deps.registry.resolve(req.platform, 'streamLive');
  if (!s?.streamLive) {
    throw new Error(
      `平台 ${req.platform} 既没有可用的 searchAll，也没有 streamLive provider。` +
        `未注册通常是缺少凭据，见 .env.example。`,
    );
  }
  return s.streamLive({
    keyword: req.keyword,
    limit: req.limit,
    maxDurationMs: req.maxDurationMs ?? DEFAULT_STREAM_MS,
  });
}

const SYSTEM_PROMPT = [
  '你是用户需求分析师。输入是一组语义相近的用户反馈。',
  '你的任务是把这组反馈归纳成一个用户痛点。',
  '',
  '要求：',
  '1. theme 是概括这组反馈的主题短语。',
  '2. summary 用两三句话讲清楚这组用户在抱怨什么、诉求是什么。',
  '3. keywords 取最能代表这组反馈的几个词。',
  '',
  '仅输出 JSON，不要代码块围栏，不要额外说明：',
  '{"theme":"主题短语","summary":"两三句概括","keywords":["词1","词2"],"severity":0}',
  'severity 取 0-5 的整数，表示该痛点的严重程度。',
].join('\n');

/** LLM 有时会套代码块围栏，剥掉后再解析。 */
function parseJson(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return JSON.parse(fenced?.[1] ?? text);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function clampSeverity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, Math.round(n)));
}

export async function analyze(
  deps: AnalyzeDeps,
  req: AnalyzeRequest,
): Promise<AnalysisReport> {
  const bundle: TextBundle = await collect(deps, req);
  const texts = textsOf(bundle);
  const clustered = await deps.clustering.cluster(texts);

  const painPoints: PainPoint[] = [];
  for (const cluster of clustered.clusters) {
    const analyzed = await summarize(deps.llm, cluster);
    if (analyzed) painPoints.push(analyzed);
  }

  painPoints.sort((a, b) => b.severity * b.size - a.severity * a.size);

  return {
    painPoints,
    items: bundle.items,
    provenance: bundle.provenance,
    stats: {
      totalTexts: clustered.totalTexts,
      clusteredTexts: clustered.clusteredTexts,
      clusterCount: clustered.clusterCount,
      noiseCount: clustered.noiseCount,
    },
    dataQuality: gradeQuality(clustered.clusteredTexts),
    keyword: req.keyword,
    generatedAt: new Date().toISOString(),
  };
}

/** 单个簇的归纳。LLM 拒答或输出不可解析时返回 undefined，跳过该簇而非中断整轮。 */
async function summarize(llm: ILlmClient, cluster: ClusterResult): Promise<PainPoint | undefined> {
  const res = await llm.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: cluster.texts.join('\n---\n') }],
  });
  if (res.refused || !res.text.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = parseJson(res.text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const o = parsed as Record<string, unknown>;
  const theme = typeof o['theme'] === 'string' ? o['theme'] : '';
  const summary = typeof o['summary'] === 'string' ? o['summary'] : '';
  if (!theme || !summary) return undefined;

  return {
    theme,
    summary,
    size: cluster.size,
    keywords: asStringArray(o['keywords']),
    severity: clampSeverity(o['severity']),
    texts: cluster.texts,
    // ClusterResult.indices 已由聚类层还原成原始输入数组的下标，
    // 与 report.items 一一对应
    memberIndices: cluster.indices,
  };
}
