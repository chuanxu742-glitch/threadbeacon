// 分析产物的类型与泄漏检查。
//
// 这里的类型是「什么会被持久化」的唯一定义，依据 docs/GDPR架构边界.md §0：
// 采集与聚类阶段仍是个人数据处理，但**持久化的聚类级输出**可以达到匿名标准，
// 从而摆脱数据保留、DSAR 响应与跨境传输三块义务。
//
// 因此 AnalysisReport 里刻意没有：原文、单条记录、作者信息、精确时间。

import type { Provenance } from '../providers/types.js';

export interface PainPoint {
  /** LLM 归纳的主题短语。 */
  readonly theme: string;
  /**
   * 代表性表述。**必须是改写，不得摘录原文** ——
   * 原文可回搜到原帖，会击穿 EDPB 匿名化三重测试里的 No Linkage。
   */
  readonly summary: string;
  /** 簇规模。低于 K_ANONYMITY_FLOOR 的簇不会走到这里。 */
  readonly size: number;
  readonly keywords: readonly string[];
  /** 严重度 0–5，由 LLM 评估。 */
  readonly severity: number;
}

/**
 * 数据可靠性分级。样本量太小的结论不该被当成市场信号，
 * 在产物里显式标出来，避免下游误读。
 */
export type DataQuality = 'exploratory' | 'preliminary' | 'reliable';

export function gradeQuality(clusteredTexts: number): DataQuality {
  if (clusteredTexts >= 200) return 'reliable';
  if (clusteredTexts >= 50) return 'preliminary';
  return 'exploratory';
}

export interface AnalysisStats {
  readonly totalTexts: number;
  readonly clusteredTexts: number;
  readonly clusterCount: number;
  readonly noiseCount: number;
  /** 因疑似逐字引用原文而被替换的表述条数。持续 >0 说明提示词需要收紧。 */
  readonly redactedSummaries: number;
}

export interface AnalysisReport {
  readonly painPoints: readonly PainPoint[];
  readonly provenance: Provenance;
  readonly stats: AnalysisStats;
  readonly dataQuality: DataQuality;
  readonly generatedAt: string;
}

// 判定逐字引用所用的最短片段长度，按文字体系区分。
//
// 一个汉字承载的信息量远高于一个拉丁字母：12 个汉字通常已是完整短句、
// 足以被搜索引擎回溯到原帖；而 12 个拉丁字符只有两三个词，用同样的阈值
// 会把常见短语误判成摘录。所以 CJK 用更短的窗口。
const SHINGLE_CJK = 12;
const SHINGLE_LATIN = 25;

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** CJK 字符占比超过三成就按 CJK 处理，混排文本从严。 */
function shingleFor(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk / text.length > 0.3 ? SHINGLE_CJK : SHINGLE_LATIN;
}

/**
 * 检测 summary 是否逐字包含了任一输入文本的片段。
 *
 * 局限：这是滑窗子串匹配，能抓住整条回显与长片段摘录，
 * 抓不住改写幅度很小的转述。它是防线而非证明 ——
 * 真正的保证来自提示词约束加人工抽检。
 */
export function containsVerbatim(summary: string, inputs: readonly string[]): boolean {
  const hay = normalize(summary);
  if (hay.length === 0) return false;

  for (const raw of inputs) {
    const needle = normalize(raw);
    if (needle.length === 0) continue;

    const shingle = shingleFor(needle);
    if (needle.length <= shingle) {
      if (hay.includes(needle)) return true;
      continue;
    }
    // 步长取窗口的一半，保证任意长度 >= shingle 的连续摘录都会被某个窗口覆盖
    const stride = Math.max(1, Math.floor(shingle / 2));
    for (let i = 0; i + shingle <= needle.length; i += stride) {
      if (hay.includes(needle.slice(i, i + shingle))) return true;
    }
    // 末尾不足一个步长的残余窗口单独补一次，避免尾部摘录漏检
    if (hay.includes(needle.slice(needle.length - shingle))) return true;
  }
  return false;
}
