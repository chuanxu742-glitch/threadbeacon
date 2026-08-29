import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { listReports, loadReport, saveReport } from '../src/pipeline/store.js';
import type { AnalysisReport } from '../src/pipeline/report.js';
import type { SourceItem } from '../src/providers/types.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'threadbeacon-store-'));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const items: SourceItem[] = [
  {
    text: '这个手机续航太差了，一天要充两次电',
    postedAt: '2026-08-05T10:00:00.000Z',
    timeBucket: '2026-08-05',
    platform: 'bluesky',
    itemType: 'post',
    id: 'post-1',
    author: 'alice.bsky.social',
    authorId: 'did:plc:alice',
    url: 'https://bsky.app/profile/did:plc:alice/post/post-1',
    metrics: { likes: 12, comments: 3, shares: 1 },
  },
  {
    text: '同感，电池撑不过半天',
    postedAt: '2026-08-05T11:00:00.000Z',
    timeBucket: '2026-08-05',
    platform: 'bluesky',
    itemType: 'comment',
    id: 'c-1',
    parentId: 'post-1',
    author: 'bob.bsky.social',
    authorId: 'did:plc:bob',
    metrics: { likes: 2 },
  },
];

const report: AnalysisReport = {
  painPoints: [
    {
      theme: '续航',
      summary: '群体反映电池不足。',
      size: 2,
      keywords: ['续航'],
      severity: 4,
      texts: items.map((i) => i.text),
      memberIndices: [0, 1],
    },
  ],
  items,
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
  generatedAt: '2026-08-05T12:34:56.789Z',
};

describe('saveReport', () => {
  it('写入后可原样读回', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: '续航' });

    expect(await loadReport(saved.dir)).toEqual(report);
  });

  it('一次落盘产出 report.json 与三张 CSV', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: 'x' });

    expect(saved.files.map((f) => basename(f)).sort()).toEqual([
      'clusters.csv',
      'comments.csv',
      'posts.csv',
      'report.json',
    ]);
  });

  it('csv: false 时只写 report.json', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: 'x', csv: false });
    expect(saved.files.map((f) => basename(f))).toEqual(['report.json']);
  });

  it('目录名不含冒号 —— Windows 上冒号不能做文件名', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: 'x' });
    expect(saved.dir.slice(dir.length)).not.toContain(':');
  });

  it('label 中的路径分隔符不会逃出目标目录', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: '../../etc/passwd' });

    expect(saved.dir.startsWith(dir)).toBe(true);
    expect(saved.dir).not.toContain('..');
  });

  it('空 label 也能产出合法目录名', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: '!!!' });
    expect(await loadReport(saved.dir)).toEqual(report);
  });

  it('落盘内容保留原文、作者与链接', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: 'x' });
    const json = await readFile(join(saved.dir, 'report.json'), 'utf8');

    expect(json).toContain('这个手机续航太差了');
    expect(json).toContain('alice.bsky.social');
    expect(json).toContain('did:plc:alice');
    expect(json).toContain('https://bsky.app/profile/did:plc:alice/post/post-1');
  });

  it('帖子与评论分别落到两张表', async () => {
    const dir = await tmp();
    const saved = await saveReport(report, { dir, label: 'x' });

    const posts = await readFile(join(saved.dir, 'posts.csv'), 'utf8');
    const comments = await readFile(join(saved.dir, 'comments.csv'), 'utf8');

    expect(posts).toContain('alice.bsky.social');
    expect(posts).not.toContain('bob.bsky.social');
    expect(comments).toContain('bob.bsky.social');
    // 评论靠 parent_id 关联回帖子
    expect(comments).toContain('post-1');
  });

  it('自动创建不存在的目录', async () => {
    const dir = join(await tmp(), 'nested', 'deeper');
    const saved = await saveReport(report, { dir, label: 'x' });
    expect(await loadReport(saved.dir)).toEqual(report);
  });
});

describe('listReports', () => {
  it('列出目录下的报告，新的在前', async () => {
    const dir = await tmp();
    await saveReport({ ...report, generatedAt: '2026-08-05T01:00:00.000Z' }, { dir, label: 'a' });
    await saveReport({ ...report, generatedAt: '2026-08-05T02:00:00.000Z' }, { dir, label: 'b' });

    const found = await listReports(dir);
    expect(found).toHaveLength(2);
    expect(found[0]! > found[1]!).toBe(true);
  });

  it('目录不存在时返回空数组而不是抛错', async () => {
    expect(await listReports(join(tmpdir(), 'threadbeacon-does-not-exist-xyz'))).toEqual([]);
  });
});
