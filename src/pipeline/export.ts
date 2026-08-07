// 原始数据导出：JSON 全量 + CSV 分表。
//
// CSV 分三张表，与上游 SeekMoney-ai 的导出形态对齐：
//   posts.csv     帖子/视频，一行一条
//   comments.csv  评论，靠 parent_id 关联回 posts
//   clusters.csv  聚类结果，一行一个痛点簇
//
// CSV 里的 BOM 是给 Excel 看的：没有它，中文在简体中文版 Excel 里会乱码。

import type { AnalysisReport } from './report.js';
import type { SourceItem } from '../providers/types.js';

/** Excel 认这个 BOM 才会把文件当 UTF-8 读。 */
const BOM = '﻿';

/**
 * CSV 字段转义。
 *
 * 除了标准的引号转义，还要处理一个安全问题：以 = + - @ 开头的字段
 * 会被 Excel 当成公式执行（CSV injection）。前缀一个单引号让它老实当文本。
 */
export function escapeCsv(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
  return BOM + lines.join('\r\n') + '\r\n';
}

const POST_HEADERS = [
  'id',
  'platform',
  'author',
  'author_id',
  'title',
  'text',
  'url',
  'posted_at',
  'likes',
  'comments',
  'shares',
  'views',
  'lang',
  'region',
] as const;

function postRow(it: SourceItem): unknown[] {
  return [
    it.id,
    it.platform,
    it.author,
    it.authorId,
    it.title,
    it.text,
    it.url,
    it.postedAt,
    it.metrics?.likes,
    it.metrics?.comments,
    it.metrics?.shares,
    it.metrics?.views,
    it.lang,
    it.region,
  ];
}

const COMMENT_HEADERS = [
  'id',
  'parent_id',
  'platform',
  'author',
  'author_id',
  'text',
  'url',
  'posted_at',
  'likes',
  'replies',
  'lang',
] as const;

function commentRow(it: SourceItem): unknown[] {
  return [
    it.id,
    it.parentId,
    it.platform,
    it.author,
    it.authorId,
    it.text,
    it.url,
    it.postedAt,
    it.metrics?.likes,
    it.metrics?.comments,
    it.lang,
  ];
}

const CLUSTER_HEADERS = [
  'rank',
  'theme',
  'summary',
  'size',
  'severity',
  'keywords',
  'member_ids',
] as const;

export function postsCsv(report: AnalysisReport): string {
  const posts = report.items.filter((it) => it.itemType === 'post');
  return toCsv(POST_HEADERS, posts.map(postRow));
}

export function commentsCsv(report: AnalysisReport): string {
  const comments = report.items.filter((it) => it.itemType === 'comment');
  return toCsv(COMMENT_HEADERS, comments.map(commentRow));
}

export function clustersCsv(report: AnalysisReport): string {
  const rows = report.painPoints.map((p, i) => [
    i + 1,
    p.theme,
    p.summary,
    p.size,
    p.severity,
    p.keywords.join(' | '),
    // 关联回原始记录：取簇成员对应 item 的平台 ID
    p.memberIndices
      .map((idx) => report.items[idx]?.id)
      .filter((id): id is string => id !== undefined)
      .join(' | '),
  ]);
  return toCsv(CLUSTER_HEADERS, rows);
}

/** 全量 JSON —— 报告对象原样序列化，含 provenance、items、raw 字段。 */
export function fullJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}

export interface ExportBundle {
  readonly 'posts.csv': string;
  readonly 'comments.csv': string;
  readonly 'clusters.csv': string;
  readonly 'full.json': string;
}

export function buildExports(report: AnalysisReport): ExportBundle {
  return {
    'posts.csv': postsCsv(report),
    'comments.csv': commentsCsv(report),
    'clusters.csv': clustersCsv(report),
    'full.json': fullJson(report),
  };
}
