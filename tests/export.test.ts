import { describe, expect, it } from 'vitest';
import { clustersCsv, commentsCsv, escapeCsv, postsCsv } from '../src/pipeline/export.js';
import type { AnalysisReport } from '../src/pipeline/report.js';
import type { SourceItem } from '../src/providers/types.js';

const post: SourceItem = {
  text: '续航太差',
  postedAt: '2026-08-05T10:00:00.000Z',
  timeBucket: '2026-08-05',
  platform: 'reddit',
  itemType: 'post',
  id: 'p1',
  author: 'alice',
  authorId: 't2_a',
  title: '标题',
  url: 'https://www.reddit.com/r/x/comments/p1/',
  metrics: { likes: 10, comments: 2, shares: 1 },
};

const comment: SourceItem = {
  text: '同感',
  postedAt: '2026-08-05T11:00:00.000Z',
  timeBucket: '2026-08-05',
  platform: 'reddit',
  itemType: 'comment',
  id: 'c1',
  parentId: 'p1',
  author: 'bob',
  metrics: { likes: 3 },
};

const report: AnalysisReport = {
  painPoints: [
    {
      theme: '续航',
      summary: '电池不够用。',
      size: 2,
      keywords: ['续航', '电池'],
      severity: 4,
      texts: ['续航太差', '同感'],
      memberIndices: [0, 1],
    },
  ],
  items: [post, comment],
  provenance: {
    providerId: 'fake',
    platform: 'reddit',
    kind: 'official-api',
    mode: 'searchAll',
    fetchedAt: '2026-08-05T00:00:00.000Z',
    legalBasis: 'test',
    robots: 'not-applicable',
    auth: 'app-credential',
  },
  stats: {
    totalTexts: 2,
    clusteredTexts: 2,
    clusterCount: 1,
    noiseCount: 0,
    summarizedClusters: 1,
    skippedClusters: 0,
  },
  dataQuality: 'exploratory',
  keyword: '续航',
  generatedAt: '2026-08-05T12:00:00.000Z',
};

describe('escapeCsv', () => {
  it('给含逗号、引号、换行的字段加引号并转义内部引号', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });

  it('普通字段不加引号', () => {
    expect(escapeCsv('hello')).toBe('hello');
    expect(escapeCsv(42)).toBe('42');
  });

  it('undefined 与 null 输出空串', () => {
    expect(escapeCsv(undefined)).toBe('');
    expect(escapeCsv(null)).toBe('');
  });

  it('中和 Excel 公式注入 —— 以 = + - @ 开头的字段前缀单引号', () => {
    // 这几种开头在 Excel 里会被当公式执行，=cmd|... 是典型的攻击载荷
    expect(escapeCsv('=1+1')).toBe("'=1+1");
    expect(escapeCsv('+44 123')).toBe("'+44 123");
    expect(escapeCsv('-2')).toBe("'-2");
    // @ 开头的还含逗号，前缀与引号都要有
    expect(escapeCsv('@user,x')).toBe('"\'@user,x"');
  });
});

describe('CSV 分表', () => {
  it('posts.csv 只含帖子', () => {
    const csv = postsCsv(report);
    expect(csv).toContain('alice');
    expect(csv).not.toContain('bob');
    expect(csv).toContain('https://www.reddit.com/r/x/comments/p1/');
    expect(csv).toContain('标题');
  });

  it('comments.csv 只含评论，且带 parent_id', () => {
    const csv = commentsCsv(report);
    expect(csv).toContain('bob');
    expect(csv).not.toContain('alice');
    // 表头有 parent_id，数据行有 p1
    expect(csv).toContain('parent_id');
    expect(csv).toContain('p1');
  });

  it('带 UTF-8 BOM —— 否则简体中文版 Excel 打开会乱码', () => {
    expect(postsCsv(report).charCodeAt(0)).toBe(0xfeff);
    expect(commentsCsv(report).charCodeAt(0)).toBe(0xfeff);
    expect(clustersCsv(report).charCodeAt(0)).toBe(0xfeff);
  });

  it('clusters.csv 把簇成员关联回原始记录 ID', () => {
    const csv = clustersCsv(report);
    expect(csv).toContain('续航');
    expect(csv).toContain('p1 | c1');
  });

  it('空报告只产出表头', () => {
    const empty: AnalysisReport = { ...report, items: [], painPoints: [] };
    // BOM + 表头 + 结尾换行
    expect(postsCsv(empty).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
