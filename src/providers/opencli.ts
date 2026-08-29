import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { BaseProvider } from './base.js';
import {
  openCliPlatform,
  type ProviderCapability,
  type RawObservation,
  type SearchQuery,
  type TextBundle,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface OpenCliArg {
  name: string;
  type?: string;
  required?: boolean;
  positional?: boolean;
  default?: unknown;
  help?: string;
}

export interface OpenCliCommand {
  site: string;
  name: string;
  command: string;
  description?: string;
  access: 'read' | 'write';
  strategy?: string;
  browser?: boolean;
  args?: OpenCliArg[];
}

export type OpenCliRunner = (
  binary: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<string>;

export interface OpenCliOptions {
  binary?: string;
  timeoutMs?: number;
  runner?: OpenCliRunner;
}

export type OpenCliCdpProbe = (endpoint: string, timeoutMs: number) => Promise<void>;

export interface OpenCliRuntimeOptions extends OpenCliOptions {
  expectedVersion?: string;
  cdpEndpoint?: string;
  cdpProbe?: OpenCliCdpProbe;
}

export interface OpenCliRuntimeReport {
  binary: string;
  version: string;
  expectedVersion: string;
  catalog: readonly OpenCliCommand[];
  discoveredCommandCount: number;
  executableCommandCount: number;
  readSiteCount: number;
  browserCommandCount: number;
  browserReady: boolean;
  cdpConfigured: boolean;
  cdpError?: string;
}

export interface OpenCliTaskOptions extends OpenCliOptions {
  command?: string;
  args?: readonly string[];
  catalog?: readonly OpenCliCommand[];
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 32 * 1024 * 1024;
export const PINNED_OPENCLI_VERSION = '1.8.5';
const AUTO_COMMANDS = [
  'search',
  'search-by-query',
  'keyword-search',
  'posts',
  'timeline',
  'feed',
  'recommend',
  'latest',
  'new',
  'hot',
  'top',
  'list',
] as const;
const QUERY_ARG_NAMES = new Set(['query', 'keyword', 'keywords', 'q', 'term', 'search']);
const UNSAFE_ANALYSIS_COMMANDS = /(?:^|[-_])(login|download|upload|publish|post|delete|follow|unfollow|like|unlike|comment|reply|send|save|export|screenshot)(?:$|[-_])/i;
const FORBIDDEN_ARGS = new Set([
  '-f',
  '--format',
  '--execute',
  '--include-sensitive',
  '--output',
]);

function defaultRunner(binary: string, args: readonly string[], timeoutMs: number): Promise<string> {
  if (/\.cmd$/i.test(binary)) {
    throw new OpenCliError('为避免 cmd.exe 参数注入，OPENCLI_BIN 不接受 .cmd；请指向 opencli 的 dist/src/main.js 或原生可执行文件');
  }
  const bundledEntry = process.platform === 'win32' && binary === 'opencli'
    ? createRequire(resolve(process.cwd(), 'package.json')).resolve('@jackwener/opencli')
    : null;
  const script = bundledEntry ?? (/\.(?:c|m)?js$/i.test(binary) ? binary : null);
  return execFileAsync(script ? process.execPath : binary, script ? [script, ...args] : [...args], {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
    windowsHide: true,
  }).then((result) => result.stdout);
}

function safeRuntimeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/(token|key|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export function parseOpenCliVersion(stdout: string): string {
  const match = /(?:^|\D)(\d+\.\d+\.\d+)(?:\D|$)/.exec(stdout);
  if (!match?.[1]) throw new OpenCliError(`无法识别 OpenCLI 版本：${stdout.trim().slice(0, 200)}`);
  return match[1];
}

export function openCliCommandNeedsBrowser(command: OpenCliCommand): boolean {
  return command.browser === true || ['browser', 'cookie', 'cdp'].includes(command.strategy?.toLowerCase() ?? '');
}

export function executableOpenCliCatalog(
  catalog: readonly OpenCliCommand[],
  browserReady: boolean,
): OpenCliCommand[] {
  return catalog.filter((command) => browserReady || !openCliCommandNeedsBrowser(command));
}

async function defaultCdpProbe(endpoint: string, timeoutMs: number): Promise<void> {
  const parsed = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new OpenCliError('OPENCLI_CDP_ENDPOINT 必须是无内嵌凭据的 http/https URL');
  }
  const versionUrl = new URL('/json/version', parsed);
  const response = await fetch(versionUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new OpenCliError(`CDP 健康检查返回 HTTP ${response.status}`);
  const value = await response.json() as Record<string, unknown>;
  if (typeof value['Browser'] !== 'string' && typeof value['webSocketDebuggerUrl'] !== 'string') {
    throw new OpenCliError('CDP /json/version 响应缺少浏览器身份');
  }
}

/**
 * 验证 Worker 实际调用的 OpenCLI，而不是只相信 package.json。
 * 版本不匹配时整体拒绝该适配器；CDP 不可用时只移除需要浏览器的命令，公开命令仍可运行。
 */
export async function inspectOpenCliRuntime(
  options: OpenCliRuntimeOptions = {},
): Promise<OpenCliRuntimeReport> {
  const binary = options.binary ?? process.env['OPENCLI_BIN'] ?? 'opencli';
  const expectedVersion = options.expectedVersion ?? process.env['OPENCLI_EXPECTED_VERSION'] ?? PINNED_OPENCLI_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    throw new OpenCliError(`OPENCLI_EXPECTED_VERSION 必须是 x.y.z，收到 ${expectedVersion}`);
  }
  const runner = options.runner ?? defaultRunner;
  const inspectTimeout = Math.min(options.timeoutMs ?? 30_000, 30_000);
  const version = parseOpenCliVersion(await runner(binary, ['--version'], inspectTimeout));
  if (version !== expectedVersion) {
    throw new OpenCliError(`OpenCLI 版本不匹配：期望 ${expectedVersion}，实际 ${version}`);
  }
  const discovered = await discoverOpenCliCatalog({ binary, timeoutMs: inspectTimeout, runner });
  const cdpEndpoint = options.cdpEndpoint?.trim() ?? '';
  let browserReady = false;
  let cdpError: string | undefined;
  if (cdpEndpoint) {
    try {
      await (options.cdpProbe ?? defaultCdpProbe)(cdpEndpoint, Math.min(inspectTimeout, 5_000));
      browserReady = true;
    } catch (error) {
      cdpError = safeRuntimeError(error);
    }
  }
  const catalog = executableOpenCliCatalog(discovered, browserReady);
  const report: OpenCliRuntimeReport = {
    binary,
    version,
    expectedVersion,
    catalog,
    discoveredCommandCount: discovered.length,
    executableCommandCount: catalog.length,
    readSiteCount: openCliCapabilities(catalog).length,
    browserCommandCount: discovered.filter(openCliCommandNeedsBrowser).length,
    browserReady,
    cdpConfigured: Boolean(cdpEndpoint),
  };
  return cdpError ? { ...report, cdpError } : report;
}

/** stdout 可能在 JSON 前带更新提示；从可能的 JSON 起点逐个尝试。 */
export function parseOpenCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] !== '[' && trimmed[index] !== '{') continue;
      try {
        return JSON.parse(trimmed.slice(index)) as unknown;
      } catch {
        // 继续找下一个候选起点。
      }
    }
  }
  throw new OpenCliError('OpenCLI 输出不是合法 JSON');
}

export class OpenCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCliError';
  }
}

export async function discoverOpenCliCatalog(
  options: OpenCliOptions = {},
): Promise<OpenCliCommand[]> {
  const runner = options.runner ?? defaultRunner;
  const stdout = await runner(
    options.binary ?? process.env['OPENCLI_BIN'] ?? 'opencli',
    ['list', '-f', 'json'],
    options.timeoutMs ?? 30_000,
  );
  const parsed = parseOpenCliJson(stdout);
  if (!Array.isArray(parsed)) throw new OpenCliError('OpenCLI catalog 必须是数组');
  return parsed.filter((entry): entry is OpenCliCommand => {
    if (!entry || typeof entry !== 'object') return false;
    const value = entry as Record<string, unknown>;
    return (
      typeof value['site'] === 'string' &&
      typeof value['name'] === 'string' &&
      (value['access'] === 'read' || value['access'] === 'write')
    );
  });
}

export function openCliCapabilities(catalog: readonly OpenCliCommand[]): string[] {
  return [
    ...new Set(
      catalog
        .filter((command) => command.access === 'read')
        .map((command) => openCliPlatform(command.site)),
    ),
  ].sort();
}

function commandArgs(command: OpenCliCommand): readonly OpenCliArg[] {
  return Array.isArray(command.args) ? command.args : [];
}

function queryArg(command: OpenCliCommand): OpenCliArg | undefined {
  return commandArgs(command).find((arg) => QUERY_ARG_NAMES.has(arg.name));
}

function requiredArgs(command: OpenCliCommand): OpenCliArg[] {
  return commandArgs(command).filter((arg) => arg.required === true && arg.default == null);
}

function autoCommand(catalog: readonly OpenCliCommand[], site: string): OpenCliCommand | undefined {
  const candidates = catalog.filter(
    (command) =>
      command.site === site &&
      command.access === 'read' &&
      !UNSAFE_ANALYSIS_COMMANDS.test(command.name),
  );
  for (const name of AUTO_COMMANDS) {
    const command = candidates.find((candidate) => candidate.name === name);
    if (!command) continue;
    const required = requiredArgs(command);
    const query = queryArg(command);
    if (required.length === 0 || (required.length === 1 && query === required[0])) return command;
  }
  return undefined;
}

function validateExtraArgs(args: readonly string[]): string[] {
  if (args.length > 40) throw new OpenCliError('OpenCLI 参数不能超过 40 项');
  const safe = args.map((value) => {
    if (typeof value !== 'string' || value.length > 500 || value.includes('\0')) {
      throw new OpenCliError('OpenCLI 参数必须是长度不超过 500 的字符串');
    }
    return value;
  });
  for (const value of safe) {
    const flag = value.includes('=') ? value.slice(0, value.indexOf('=')) : value;
    if (FORBIDDEN_ARGS.has(flag)) throw new OpenCliError(`分析任务禁止参数 ${flag}`);
  }
  return safe;
}

function buildAutoArgs(command: OpenCliCommand, query: SearchQuery): string[] {
  const args: string[] = [];
  const querySpec = queryArg(command);
  if (querySpec) {
    if (querySpec.positional !== false) args.push(query.keyword);
    else args.push(`--${querySpec.name}`, query.keyword);
  }
  if (commandArgs(command).some((arg) => arg.name === 'limit')) {
    args.push('--limit', String(query.limit));
  }
  return args;
}

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [value];
  const object = value as Record<string, unknown>;
  for (const key of ['items', 'results', 'rows', 'data']) {
    const nested = object[key];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === 'object') {
      const rows = rowsOf(nested);
      if (rows.length > 0) return rows;
    }
  }
  return [value];
}

function stringValue(object: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value).trim();
    }
  }
  return undefined;
}

function numberValue(object: Record<string, unknown>, keys: readonly string[]): number | undefined {
  const raw = stringValue(object, keys);
  if (raw === undefined) return undefined;
  const value = Number(raw.replaceAll(',', ''));
  return Number.isFinite(value) ? value : undefined;
}

function observedAt(object: Record<string, unknown>): string {
  const raw = stringValue(object, [
    'postedAt', 'published_at', 'publishedAt', 'created_at', 'createdAt', 'created', 'date', 'time', 'timestamp',
  ]);
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function normalizeOpenCliRows(
  site: string,
  payload: unknown,
  limit: number,
): RawObservation[] {
  const platform = openCliPlatform(site);
  const rows = rowsOf(payload).slice(0, limit);
  return rows.flatMap((row, index): RawObservation[] => {
    const object = row && typeof row === 'object' && !Array.isArray(row)
      ? row as Record<string, unknown>
      : { value: row };
    const title = stringValue(object, ['title', 'name', 'question', 'topic', 'subject']);
    const content = stringValue(object, [
      'content', 'text', 'description', 'summary', 'excerpt', 'body', 'answer', 'value',
    ]);
    const text = [title, content && content !== title ? content : undefined].filter(Boolean).join('\n\n')
      || JSON.stringify(object);
    if (!text.trim()) return [];
    const likes = numberValue(object, ['likes', 'like_count', 'likeCount', 'votes', 'upvotes']);
    const comments = numberValue(object, ['comments', 'comment_count', 'commentCount', 'replies']);
    const shares = numberValue(object, ['shares', 'share_count', 'shareCount', 'reposts']);
    const views = numberValue(object, ['views', 'view_count', 'viewCount', 'plays']);
    const metrics = { ...(likes !== undefined ? { likes } : {}), ...(comments !== undefined ? { comments } : {}), ...(shares !== undefined ? { shares } : {}), ...(views !== undefined ? { views } : {}) };
    return [{
      text,
      observedAt: observedAt(object),
      platform,
      itemType: 'post',
      id: stringValue(object, ['id', 'post_id', 'note_id', 'video_id', 'topic_id']) ?? `${site}-${index + 1}`,
      ...(title ? { title } : {}),
      ...(stringValue(object, ['author', 'username', 'user_name', 'creator', 'channel', 'seller_name'])
        ? { author: stringValue(object, ['author', 'username', 'user_name', 'creator', 'channel', 'seller_name'])! }
        : {}),
      ...(stringValue(object, ['url', 'link', 'item_url', 'post_url', 'video_url'])
        ? { url: stringValue(object, ['url', 'link', 'item_url', 'post_url', 'video_url'])! }
        : {}),
      ...(Object.keys(metrics).length ? { metrics } : {}),
      raw: object,
    }];
  });
}

export class OpenCliProvider extends BaseProvider {
  readonly capability: ProviderCapability;
  private readonly site: string;
  private readonly opts: Required<Pick<OpenCliOptions, 'binary' | 'timeoutMs'>> & {
    runner: OpenCliRunner;
    command?: string;
    args: readonly string[];
    catalog: readonly OpenCliCommand[];
  };

  constructor(site: string, options: OpenCliTaskOptions & { catalog: readonly OpenCliCommand[] }) {
    const platform = openCliPlatform(site);
    const usesBrowser = options.catalog.some((command) => command.site === site && command.browser);
    super({ authMode: usesBrowser ? 'user-session' : 'anonymous' });
    this.site = site;
    this.opts = {
      binary: options.binary ?? process.env['OPENCLI_BIN'] ?? 'opencli',
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      runner: options.runner ?? defaultRunner,
      ...(options.command ? { command: options.command } : {}),
      args: options.args ?? [],
      catalog: options.catalog,
    };
    this.capability = {
      id: `opencli-${site}`,
      platform,
      kind: usesBrowser ? 'user-authorized' : 'open-protocol',
      modes: ['searchAll'],
      canFetchComments: false,
      legalBasis: usesBrowser
        ? `通过 OpenCLI 外部适配器复用运行者自有浏览器会话读取 ${site} 数据；非平台官方授权通道，受账号授权、站点条款和页面变化约束`
        : `通过 OpenCLI 的公开只读适配器读取 ${site} 数据；具体授权基础以对应站点和适配器声明为准`,
      robots: usesBrowser ? 'unchecked' : 'not-applicable',
    };
  }

  async checkAvailability(): Promise<boolean> {
    return this.opts.catalog.some((command) => command.site === this.site && command.access === 'read');
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const selected = this.opts.command
      ? this.opts.catalog.find((entry) => entry.site === this.site && entry.name === this.opts.command)
      : autoCommand(this.opts.catalog, this.site);
    if (!selected) {
      throw new OpenCliError(
        `${this.site} 没有可自动执行的搜索/发现命令；请在任务中指定 OpenCLI 只读命令和参数`,
      );
    }
    if (selected.access !== 'read' || UNSAFE_ANALYSIS_COMMANDS.test(selected.name)) {
      throw new OpenCliError(`分析任务拒绝执行 OpenCLI 命令 ${this.site}/${selected.name}`);
    }
    const taskArgs = this.opts.command
      ? validateExtraArgs(this.opts.args)
      : buildAutoArgs(selected, query);
    const stdout = await this.opts.runner(
      this.opts.binary,
      [this.site, selected.name, ...taskArgs, '-f', 'json'],
      this.opts.timeoutMs,
    );
    return this.bundle(normalizeOpenCliRows(this.site, parseOpenCliJson(stdout), query.limit), 'searchAll');
  }
}

export async function createOpenCliProvider(
  site: string,
  options: OpenCliTaskOptions = {},
): Promise<OpenCliProvider> {
  const catalog = options.catalog ?? await discoverOpenCliCatalog(options);
  return new OpenCliProvider(site, { ...options, catalog });
}
