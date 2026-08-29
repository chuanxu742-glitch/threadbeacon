import { describe, expect, it, vi } from 'vitest';
import {
  OpenCliError,
  createOpenCliProvider,
  inspectOpenCliRuntime,
  normalizeOpenCliRows,
  openCliCapabilities,
  parseOpenCliVersion,
  parseOpenCliJson,
  type OpenCliCommand,
} from '../src/providers/opencli.js';

const catalog: OpenCliCommand[] = [
  {
    site: 'zhihu',
    name: 'search',
    command: 'zhihu/search',
    access: 'read',
    strategy: 'cookie',
    browser: true,
    args: [
      { name: 'query', required: true, positional: true },
      { name: 'limit', required: false, positional: false, default: 10 },
    ],
  },
  {
    site: 'zhihu',
    name: 'like',
    command: 'zhihu/like',
    access: 'write',
    browser: true,
    args: [{ name: 'target', required: true, positional: true }],
  },
  {
    site: 'hackernews',
    name: 'top',
    command: 'hackernews/top',
    access: 'read',
    strategy: 'public',
    browser: false,
    args: [{ name: 'limit', required: false, positional: false, default: 20 }],
  },
];

describe('OpenCLI dynamic provider', () => {
  it('parses catalog JSON after a leading notice', () => {
    expect(parseOpenCliJson(`notice\n${JSON.stringify(catalog)}`)).toEqual(catalog);
  });

  it('publishes every site with at least one read command as a worker capability', () => {
    expect(openCliCapabilities(catalog)).toEqual(['opencli:hackernews', 'opencli:zhihu']);
  });

  it('verifies the pinned binary and hides browser commands when CDP is unavailable', async () => {
    const runner = vi.fn(async (_binary: string, args: readonly string[]) =>
      args[0] === '--version' ? 'OpenCLI v1.8.5\n' : JSON.stringify(catalog));
    const report = await inspectOpenCliRuntime({ runner });

    expect(report).toMatchObject({
      version: '1.8.5',
      expectedVersion: '1.8.5',
      discoveredCommandCount: 3,
      executableCommandCount: 1,
      readSiteCount: 1,
      browserCommandCount: 2,
      browserReady: false,
      cdpConfigured: false,
    });
    expect(report.catalog.map((command) => command.command)).toEqual(['hackernews/top']);
    expect(runner).toHaveBeenNthCalledWith(1, 'opencli', ['--version'], 30_000);
    expect(runner).toHaveBeenNthCalledWith(2, 'opencli', ['list', '-f', 'json'], 30_000);
  });

  it('keeps browser capabilities only after the configured CDP endpoint is healthy', async () => {
    const runner = vi.fn(async (_binary: string, args: readonly string[]) =>
      args[0] === '--version' ? '1.8.5' : JSON.stringify(catalog));
    const cdpProbe = vi.fn(async () => undefined);
    const report = await inspectOpenCliRuntime({
      runner,
      cdpEndpoint: 'http://browser:9222',
      cdpProbe,
    });

    expect(report.browserReady).toBe(true);
    expect(report.executableCommandCount).toBe(3);
    expect(report.readSiteCount).toBe(2);
    expect(cdpProbe).toHaveBeenCalledWith('http://browser:9222', 5_000);
  });

  it('fails closed on version drift and degrades only browser capabilities on CDP failure', async () => {
    const mismatch = vi.fn(async () => 'OpenCLI 1.9.0');
    await expect(inspectOpenCliRuntime({ runner: mismatch })).rejects.toThrow(
      '期望 1.8.5，实际 1.9.0',
    );
    expect(mismatch).toHaveBeenCalledTimes(1);

    const runner = vi.fn(async (_binary: string, args: readonly string[]) =>
      args[0] === '--version' ? 'OpenCLI 1.8.5' : JSON.stringify(catalog));
    const degraded = await inspectOpenCliRuntime({
      runner,
      cdpEndpoint: 'http://127.0.0.1:9',
      cdpProbe: async () => { throw new Error('connection refused token=do-not-leak'); },
    });
    expect(degraded).toMatchObject({ browserReady: false, executableCommandCount: 1 });
    expect(degraded.cdpError).toBe('connection refused token=[REDACTED]');
  });

  it('parses semantic versions from normal OpenCLI banners', () => {
    expect(parseOpenCliVersion('@jackwener/opencli version 1.8.5 (node)')).toBe('1.8.5');
    expect(() => parseOpenCliVersion('development build')).toThrow(OpenCliError);
  });

  it('auto-selects search and safely appends query, limit and JSON format', async () => {
    const runner = vi.fn(async () => JSON.stringify([
      { id: 'a1', title: 'AI agent 怎么用', author: 'Alice', votes: 12, url: 'https://example.test/a1' },
    ]));
    const provider = await createOpenCliProvider('zhihu', { catalog, runner });
    const bundle = await provider.searchAll({ keyword: 'AI agent', limit: 8 });
    expect(runner).toHaveBeenCalledWith(
      'opencli',
      ['zhihu', 'search', 'AI agent', '--limit', '8', '-f', 'json'],
      180_000,
    );
    expect(bundle.items[0]).toMatchObject({
      platform: 'opencli:zhihu',
      text: 'AI agent 怎么用',
      author: 'Alice',
      metrics: { likes: 12 },
    });
    expect(bundle.provenance.auth).toBe('user-session');
  });

  it('rejects write commands and sensitive/output arguments', async () => {
    const runner = vi.fn(async () => '[]');
    const write = await createOpenCliProvider('zhihu', { catalog, runner, command: 'like', args: ['x'] });
    await expect(write.searchAll({ keyword: 'x', limit: 1 })).rejects.toThrow(OpenCliError);

    const sensitive = await createOpenCliProvider('zhihu', {
      catalog,
      runner,
      command: 'search',
      args: ['x', '--include-sensitive'],
    });
    await expect(sensitive.searchAll({ keyword: 'x', limit: 1 })).rejects.toThrow(
      '禁止参数 --include-sensitive',
    );
  });

  it('normalizes heterogeneous rows without dropping the raw record', () => {
    expect(normalizeOpenCliRows('eastmoney', {
      data: [{ code: '600519', name: '贵州茅台', price: 1418.8, time: '2026-08-27T01:00:00Z' }],
    }, 10)[0]).toMatchObject({
      platform: 'opencli:eastmoney',
      title: '贵州茅台',
      raw: { code: '600519', name: '贵州茅台', price: 1418.8 },
    });
  });
});
