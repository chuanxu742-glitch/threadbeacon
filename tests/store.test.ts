import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listReports, loadReport, saveReport } from '../src/pipeline/store.js';
import type { AnalysisReport } from '../src/pipeline/report.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'caiji-store-'));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const report: AnalysisReport = {
  painPoints: [{ theme: '续航', summary: '群体反映电池不足。', size: 12, keywords: ['续航'], severity: 4 }],
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
    totalTexts: 30,
    clusteredTexts: 24,
    clusterCount: 2,
    noiseCount: 6,
    redactedSummaries: 0,
  },
  dataQuality: 'exploratory',
  generatedAt: '2026-08-05T12:34:56.789Z',
};

describe('saveReport', () => {
  it('写入后可原样读回', async () => {
    const dir = await tmp();
    const file = await saveReport(report, { dir, label: '续航' });

    expect(await loadReport(file)).toEqual(report);
  });

  it('文件名不含冒号 —— Windows 上冒号不能做文件名', async () => {
    const dir = await tmp();
    const file = await saveReport(report, { dir, label: 'x' });
    expect(file.slice(dir.length)).not.toContain(':');
  });

  it('label 中的路径分隔符不会逃出目标目录', async () => {
    const dir = await tmp();
    const file = await saveReport(report, { dir, label: '../../etc/passwd' });

    expect(file.startsWith(dir)).toBe(true);
    expect(file).not.toContain('..');
  });

  it('空 label 也能产出合法文件名', async () => {
    const dir = await tmp();
    const file = await saveReport(report, { dir, label: '!!!' });
    expect(await loadReport(file)).toEqual(report);
  });

  it('落盘内容不含原文字段 —— 只有聚类级产物才允许持久化', async () => {
    const dir = await tmp();
    const file = await saveReport(report, { dir, label: 'x' });
    const raw = await readFile(file, 'utf8');

    for (const forbidden of ['timeBucket', 'items', 'texts', 'handle', 'permalink']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('自动创建不存在的目录', async () => {
    const dir = join(await tmp(), 'nested', 'deeper');
    const file = await saveReport(report, { dir, label: 'x' });
    expect(await loadReport(file)).toEqual(report);
  });
});

describe('listReports', () => {
  it('列出目录下的报告并排序', async () => {
    const dir = await tmp();
    await saveReport({ ...report, generatedAt: '2026-08-05T01:00:00.000Z' }, { dir, label: 'a' });
    await saveReport({ ...report, generatedAt: '2026-08-05T02:00:00.000Z' }, { dir, label: 'b' });

    const files = await listReports(dir);
    expect(files).toHaveLength(2);
    expect(files[0]! < files[1]!).toBe(true);
  });

  it('目录不存在时返回空数组而不是抛错', async () => {
    expect(await listReports(join(tmpdir(), 'caiji-does-not-exist-xyz'))).toEqual([]);
  });
});
