// 端到端编排：provider → 脱敏（provider 内完成）→ 聚类 → LLM 归纳 → 聚类级产物。
//
// 全流程只有一处接触原文：聚类的输入。原文不进产物、不进日志。

import { ClusteringService, type ClusterResult } from '../clustering/ClusteringService.js';
import type { ILlmClient } from '../llm/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { textsOf, type Platform, type TextBundle } from '../providers/types.js';
import {
  containsVerbatim,
  gradeQuality,
  type AnalysisReport,
  type PainPoint,
} from './report.js';

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
  '你是用户需求分析师。输入是一组语义相近的用户反馈，它们已经过脱敏处理。',
  '你的任务是把这组反馈归纳成一个用户痛点。',
  '',
  '硬性要求：',
  '1. summary 必须是你自己的概括表述，**不得摘录、复述或拼接原文片段**。',
  '   原文可被回搜到来源，逐字引用会破坏数据的匿名性。',
  '2. 不要提及任何具体人名、账号、链接、时间点或地名，即使输入里出现了。',
  '3. 只描述群体层面的共性问题，不描述任何单个个体的情况。',
  '',
  '仅输出 JSON，不要代码块围栏，不要额外说明：',
  '{"theme":"主题短语","summary":"两三句概括","keywords":["词1","词2"],"severity":0}',
  'severity 取 0–5 的整数，表示该痛点的严重程度。',
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
  let redactedSummaries = 0;

  for (const cluster of clustered.clusters) {
    const analyzed = await summarize(deps.llm, cluster);
    if (!analyzed) continue;

    // 最后一道闸：LLM 若逐字回显了原文，丢弃该表述而不是把它写进产物
    if (containsVerbatim(analyzed.summary, cluster.texts)) {
      redactedSummaries += 1;
      painPoints.push({ ...analyzed, summary: fallbackSummary(analyzed.theme, cluster.size) });
      continue;
    }
    painPoints.push(analyzed);
  }

  painPoints.sort((a, b) => b.severity * b.size - a.severity * a.size);

  return {
    painPoints,
    provenance: bundle.provenance,
    stats: {
      totalTexts: clustered.totalTexts,
      clusteredTexts: clustered.clusteredTexts,
      clusterCount: clustered.clusterCount,
      noiseCount: clustered.noiseCount,
      redactedSummaries,
    },
    dataQuality: gradeQuality(clustered.clusteredTexts),
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
  };
}

function fallbackSummary(theme: string, size: number): string {
  return `约 ${size} 条反馈集中在「${theme}」，因原始表述无法安全概括而略去细节。`;
}
