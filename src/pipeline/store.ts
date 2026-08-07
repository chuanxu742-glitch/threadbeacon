// 分析产物的持久化。
//
// 每次分析落一个目录，里面是同一份数据的四种形态：
//   report.json    完整报告（洞察 + 全量 items + provenance）
//   posts.csv      帖子表
//   comments.csv   评论表
//   clusters.csv   聚类表
//
// 目录名带时间戳与关键词，便于人工辨认与排序。

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildExports } from './export.js';
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
  /** 参与目录名的关键词，仅用于人类辨认。默认取 report.keyword。 */
  readonly label?: string;
  /** 是否一并写 CSV 分表，默认写。 */
  readonly csv?: boolean;
}

export interface SaveResult {
  /** 本次落盘的目录。 */
  readonly dir: string;
  /** 实际写出的文件全路径。 */
  readonly files: readonly string[];
}

/** 写入报告与导出文件，返回落盘目录及文件清单。 */
export async function saveReport(
  report: AnalysisReport,
  opts: SaveOptions = {},
): Promise<SaveResult> {
  const root = opts.dir ?? DEFAULT_STORE_DIR;
  // 时间戳用于排序与去重，冒号在 Windows 上不能做文件名，换成连字符
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const dir = join(root, `${stamp}__${report.provenance.platform}__${slug(opts.label ?? report.keyword)}`);
  await mkdir(dir, { recursive: true });

  const exports = buildExports(report);
  const wanted: Array<[string, string]> =
    opts.csv === false
      ? [['report.json', exports['full.json']]]
      : [
          ['report.json', exports['full.json']],
          ['posts.csv', exports['posts.csv']],
          ['comments.csv', exports['comments.csv']],
          ['clusters.csv', exports['clusters.csv']],
        ];

  const files: string[] = [];
  for (const [name, content] of wanted) {
    const path = join(dir, name);
    await writeFile(path, content, 'utf8');
    files.push(path);
  }
  return { dir, files };
}

/** 列出已有的分析目录，按时间倒序（新的在前）。 */
export async function listReports(dir: string = DEFAULT_STORE_DIR): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 读回报告。传目录则取其中的 report.json，传文件则直接读。 */
export async function loadReport(path: string): Promise<AnalysisReport> {
  const file = path.endsWith('.json') ? path : join(path, 'report.json');
  return JSON.parse(await readFile(file, 'utf8')) as AnalysisReport;
}
