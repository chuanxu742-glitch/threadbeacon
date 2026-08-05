// 分析产物的持久化。
//
// 只写 AnalysisReport —— 它按设计不含原文、不含单条记录、不含标识符。
// 中间产物（原始响应、SourceItem、簇内原文）一律不落盘：
// 依据 docs/GDPR架构边界.md §7.3，禁止落盘原始 payload 是硬性控制点。

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalysisReport } from './report.js';

export const DEFAULT_STORE_DIR = './analysis-results';

/** 文件名里只允许安全字符，避免关键词里的路径分隔符逃逸出目录。 */
function slug(s: string): string {
  const cleaned = s
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'query';
}

export interface SaveOptions {
  readonly dir?: string;
  /** 参与文件名的关键词，仅用于人类辨认。 */
  readonly label?: string;
}

/** 写入报告，返回文件路径。 */
export async function saveReport(report: AnalysisReport, opts: SaveOptions = {}): Promise<string> {
  const dir = opts.dir ?? DEFAULT_STORE_DIR;
  await mkdir(dir, { recursive: true });

  // 时间戳用于排序与去重，冒号在 Windows 上不能做文件名，换成连字符
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}__${report.provenance.platform}__${slug(opts.label ?? '')}.json`);

  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

export async function listReports(dir: string = DEFAULT_STORE_DIR): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export async function loadReport(path: string): Promise<AnalysisReport> {
  return JSON.parse(await readFile(path, 'utf8')) as AnalysisReport;
}
