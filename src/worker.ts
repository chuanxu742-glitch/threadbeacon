#!/usr/bin/env -S npx tsx

import { cpus, freemem, hostname, platform as osPlatform, totalmem } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { ClusteringService } from './clustering/ClusteringService.js';
import { loadEnvFiles } from './env.js';
import { createLlmClient, llmConfigFromEnv } from './llm/index.js';
import { configureProxyFromEnv } from './net/proxy.js';
import { analyze, summaryConcurrencyFromEnv } from './pipeline/analyze.js';
import {
  createOpenCliProvider,
  inspectOpenCliRuntime,
  OpenCliProvider,
  openCliCapabilities,
  type OpenCliCommand,
  type OpenCliRuntimeReport,
} from './providers/opencli.js';
import { GenericSourceProvider, type GenericSourceConfig } from './providers/generic-web.js';
import { ProviderRegistry } from './providers/registry.js';
import {
  attachSocialObservationEnvelope,
} from './providers/social.js';
import {
  safeSocialCapabilityMetadata,
  type SocialCapabilityMetadata,
} from './providers/social-capabilities.js';
import type { Platform } from './providers/types.js';
import { buildRegistry } from './runtime.js';
import { executeBrowserAction } from './browser-automation/executor.js';
import type { BrowserActionCommand } from './browser-automation/protocol.js';
import { executeOfficialSiteGeoReport, geoCapabilityReady } from './geo/official-site.js';
import { attestBrowserProfile, browserProfileName, isFreshAnonymousAttestation, type BrowserProfileAttestation } from './browser-profile.js';
import { executeSkillAgent, type SkillAgentRun } from './skill-agent.js';

interface WorkerConfig {
  controlUrl: string;
  nodeName: string;
  nodeId?: string;
  nodeToken?: string;
  registrationKey?: string;
  concurrency: number;
  pollMs: number;
  stateFile?: string;
}

export interface DirectAgentConfig {
  host: string;
  port: number;
  token: string;
  concurrency: number;
  publicUrl?: string;
}

export interface DirectAgentServer {
  server: Server;
  url: string;
  activeJobs(): number;
  close(): Promise<void>;
}

export interface GatewayWorkerConfig { url: string; token: string; agentId: string; concurrency: number }

export interface ControlJob {
  id: string;
  platform: Platform;
  keyword: string;
  source_options_json: string;
  limit: number;
  include_comments: number;
  attempt: number;
}

interface RuntimeWorkflowNode {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
}

interface RuntimeWorkflowEdge { source: string; target: string }

interface RuntimeWorkflowSpec {
  nodes: RuntimeWorkflowNode[];
  edges: RuntimeWorkflowEdge[];
}

export interface WorkflowNodeExecution {
  nodeId: string;
  type: string;
  status: 'completed' | 'blocked' | 'skipped' | 'deferred' | 'unsupported';
  inputCount: number;
  outputCount: number;
  output?: unknown;
  message: string;
}

export interface WorkflowExecutionResult {
  sourceNodeId: string;
  status: 'completed' | 'blocked' | 'partial';
  nodes: WorkflowNodeExecution[];
}

export interface NodeCredentials {
  id: string;
  token: string;
}

export interface WorkerCapabilityMetadata {
  readonly socialCapabilities: readonly SocialCapabilityMetadata[];
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${name} 必须是 1-${max} 之间的整数，收到 "${raw}"`);
  }
  return value;
}

export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const rawUrl = env['THREADBEACON_CONTROL_URL']?.trim();
  if (!rawUrl) throw new Error('缺少 THREADBEACON_CONTROL_URL');
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('THREADBEACON_CONTROL_URL 只允许 http 或 https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('THREADBEACON_CONTROL_URL 不应包含用户名或密码');
  }

  const nodeId = env['THREADBEACON_NODE_ID']?.trim();
  const nodeToken = env['THREADBEACON_NODE_TOKEN']?.trim();
  if ((nodeId && !nodeToken) || (!nodeId && nodeToken)) {
    throw new Error('THREADBEACON_NODE_ID 与 THREADBEACON_NODE_TOKEN 必须同时配置');
  }

  return {
    controlUrl: parsed.toString().replace(/\/$/, ''),
    nodeName: env['THREADBEACON_NODE_NAME']?.trim() || hostname(),
    ...(nodeId ? { nodeId } : {}),
    ...(nodeToken ? { nodeToken } : {}),
    ...(env['THREADBEACON_NODE_REGISTRATION_KEY']?.trim()
      ? { registrationKey: env['THREADBEACON_NODE_REGISTRATION_KEY'].trim() }
      : {}),
    concurrency: positiveInteger(env, 'THREADBEACON_WORKER_CONCURRENCY', 1, 64),
    pollMs: positiveInteger(env, 'THREADBEACON_WORKER_POLL_MS', 3_000, 60_000),
    ...(env['THREADBEACON_WORKER_STATE_FILE']?.trim() ? { stateFile: resolve(env['THREADBEACON_WORKER_STATE_FILE'].trim()) } : {}),
  };
}

export async function loadWorkerStateFile(path: string): Promise<NodeCredentials | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!value || typeof value !== 'object') throw new Error('状态文件必须是 JSON 对象');
    const id = (value as Record<string, unknown>)['id']; const token = (value as Record<string, unknown>)['token'];
    if (typeof id !== 'string' || !id.trim() || typeof token !== 'string' || token.length < 16) throw new Error('状态文件缺少有效 id/token');
    return { id: id.trim(), token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`无法读取 THREADBEACON_WORKER_STATE_FILE：${safeError(error)}`);
  }
}

export async function saveWorkerStateFile(path: string, credentials: NodeCredentials): Promise<void> {
  const target = resolve(path); await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(credentials)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600); await rename(temporary, target); await chmod(target, 0o600);
  } catch (error) {
    throw new Error(`无法写入 THREADBEACON_WORKER_STATE_FILE：${safeError(error)}`);
  }
}

export async function workerEnvWithState(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (env['THREADBEACON_NODE_ID'] || env['THREADBEACON_NODE_TOKEN'] || !env['THREADBEACON_WORKER_STATE_FILE']?.trim()) return env;
  const state = await loadWorkerStateFile(env['THREADBEACON_WORKER_STATE_FILE'].trim());
  return state ? { ...env, THREADBEACON_NODE_ID: state.id, THREADBEACON_NODE_TOKEN: state.token } : env;
}

export function directAgentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DirectAgentConfig | null {
  const raw = env['THREADBEACON_DIRECT_LISTEN']?.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw.includes('://') ? raw : `http://${raw}`); } catch { throw new Error('THREADBEACON_DIRECT_LISTEN 必须是 host:port'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('THREADBEACON_DIRECT_LISTEN 只接受 host:port；公网 TLS 请由反向代理终止');
  }
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError('THREADBEACON_DIRECT_LISTEN 端口必须是 1-65535');
  const token = env['THREADBEACON_DIRECT_TOKEN']?.trim() ?? '';
  if (token.length < 16 || token.length > 500) throw new RangeError('THREADBEACON_DIRECT_TOKEN 长度必须是 16-500');
  let publicUrl: string | undefined; const advertised = env['THREADBEACON_DIRECT_PUBLIC_URL']?.trim();
  if (advertised) {
    const parsed = new URL(advertised);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new RangeError('THREADBEACON_DIRECT_PUBLIC_URL 必须是公开 HTTPS URL');
    publicUrl = parsed.toString().replace(/\/$/, '');
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, token, concurrency: positiveInteger(env, 'THREADBEACON_WORKER_CONCURRENCY', 1, 64), ...(publicUrl ? { publicUrl } : {}) };
}

export function gatewayWorkerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayWorkerConfig | null {
  const raw = env['THREADBEACON_GATEWAY_WS_URL']?.trim(); if (!raw) return null;
  const url = new URL(raw); const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  const insecureAllowed = env['THREADBEACON_GATEWAY_ALLOW_INSECURE_WS'] === '1';
  if (!['ws:', 'wss:'].includes(url.protocol) || (url.protocol === 'ws:' && !loopback && !insecureAllowed) || url.username || url.password || url.search || url.hash) throw new RangeError('THREADBEACON_GATEWAY_WS_URL 必须是 wss:// URL；非回环 ws:// 仅可在受保护网络中配合 THREADBEACON_GATEWAY_ALLOW_INSECURE_WS=1');
  const token = env['THREADBEACON_GATEWAY_TOKEN']?.trim() || env['THREADBEACON_GATEWAY_SHARED_SECRET']?.trim() || '';
  if (token.length < 16 || token.length > 500) throw new RangeError('THREADBEACON_GATEWAY_TOKEN 长度必须是 16-500');
  const agentId = env['THREADBEACON_GATEWAY_AGENT_ID']?.trim() || env['THREADBEACON_NODE_NAME']?.trim() || hostname();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/.test(agentId)) throw new RangeError('THREADBEACON_GATEWAY_AGENT_ID 格式无效');
  return { url: url.toString(), token, agentId, concurrency: positiveInteger(env, 'THREADBEACON_WORKER_CONCURRENCY', 1, 64) };
}

function requestSignal(signal: AbortSignal, timeoutMs = 30_000): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

async function requestJson<T>(
  config: WorkerConfig,
  path: string,
  signal: AbortSignal,
  options: {
    body?: unknown;
    credentials?: NodeCredentials;
    registrationKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.credentials) headers.set('authorization', `Bearer ${options.credentials.token}`);
  if (options.registrationKey) headers.set('x-threadbeacon-registration-key', options.registrationKey);

  const response = await fetch(`${config.controlUrl}${path}`, {
    method: 'POST',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: requestSignal(signal, options.timeoutMs),
  });
  const text = await response.text();
  let value: unknown = {};
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = { error: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const message =
      value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string'
        ? (value as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(`控制平面请求失败（${response.status}）：${message}`);
  }
  return value as T;
}

function availablePlatforms(
  catalog: readonly OpenCliCommand[],
  env: NodeJS.ProcessEnv = process.env,
  browserAttestation?: BrowserProfileAttestation,
): Platform[] {
  const registry = buildRegistry(env);
  return [
    ...new Set([
      ...registry.platformsSupporting('searchAll'),
      ...registry.platformsSupporting('streamLive'),
      ...registry.platformsSupporting('fetchOwned'),
      ...openCliCapabilities(catalog) as Platform[],
      ...(['rss', 'rest', 'web'] as Platform[]),
      ...(geoCapabilityReady(catalog, env) && isFreshAnonymousAttestation(browserAttestation) ? ['geo' as Platform] : []),
    ]),
  ];
}

/**
 * 把当前 Worker 真正注册的 provider（含动态 OpenCLI 只读站点）投影成安全
 * metadata。OpenCLI 的 provider 只在这里构造能力描述，不执行任何外部命令。
 */
export function workerSocialCapabilityMetadata(
  catalog: readonly OpenCliCommand[],
  env: NodeJS.ProcessEnv = process.env,
): SocialCapabilityMetadata[] {
  const registry = buildRegistry(env);
  for (const platform of openCliCapabilities(catalog)) {
    const site = platform.slice('opencli:'.length);
    registry.register(new OpenCliProvider(site, { catalog }));
  }
  return safeSocialCapabilityMetadata(registry.socialCapabilities());
}

export function workerCapabilityMetadata(
  catalog: readonly OpenCliCommand[],
  env: NodeJS.ProcessEnv = process.env,
): WorkerCapabilityMetadata {
  return { socialCapabilities: workerSocialCapabilityMetadata(catalog, env) };
}

function reportCapabilityMetadata(registry: ProviderRegistry): WorkerCapabilityMetadata {
  return { socialCapabilities: safeSocialCapabilityMetadata(registry.socialCapabilities()) };
}

function sourceIdFromOptions(options: Record<string, unknown>): string | undefined {
  const sourceId = typeof options['sourceId'] === 'string' ? options['sourceId'].trim() : '';
  return sourceId || undefined;
}

/**
 * 报告出 Worker 边界前统一做两件事：把已支持社媒 item 绑定标准 envelope，
 * 并把所有 item 的 raw 递归脱敏。分析核心仍只见原始 SourceItem。
 */
function prepareWorkerReport(
  report: unknown,
  registry: ProviderRegistry,
  options: Record<string, unknown> = {},
): unknown {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return report;
  const value = report as Record<string, unknown>;
  const withSocial = attachSocialObservationEnvelope(value, {
    ...(sourceIdFromOptions(options) ? { sourceId: sourceIdFromOptions(options) } : {}),
  });
  return {
    ...withSocial,
    capabilityMetadata: reportCapabilityMetadata(registry),
  };
}

async function credentialsFor(
  config: WorkerConfig,
  capabilities: readonly string[],
  signal: AbortSignal,
  direct?: DirectAgentConfig | null,
  browserAttestation?: BrowserProfileAttestation,
  capabilityMetadata: WorkerCapabilityMetadata = { socialCapabilities: [] },
): Promise<NodeCredentials> {
  if (config.nodeId && config.nodeToken) return { id: config.nodeId, token: config.nodeToken };
  if (!config.registrationKey) {
    throw new Error(
      '首次启动需配置 THREADBEACON_NODE_REGISTRATION_KEY；注册成功后可改用 THREADBEACON_NODE_ID 与 THREADBEACON_NODE_TOKEN',
    );
  }
  const registered = await requestJson<{ node: { id: string }; token: string }>(
    config,
    '/api/nodes',
    signal,
    {
      registrationKey: config.registrationKey,
      body: {
        name: config.nodeName,
        platform: `${osPlatform()}-${process.arch}`,
        version: '0.8.0',
        capabilities,
        maxConcurrency: config.concurrency,
        runtime: {
          transport: direct?.publicUrl ? 'direct-http' : 'outbound-polling',
          ...(direct?.publicUrl ? { endpoint: direct.publicUrl, token: direct.token } : {}),
          os: osPlatform(),
          arch: process.arch,
          browserProfile: browserAttestation?.profileName ?? browserProfileName(process.env),
          browserProfileKind: browserAttestation?.profileKind ?? 'authenticated',
          browserEndpointConfigured: Boolean(process.env['OPENCLI_CDP_ENDPOINT']?.trim()),
          ...(browserAttestation ? { browserAttestation } : {}),
          cpuCount: cpus().length,
          capabilityMetadata,
        },
      },
    },
  );
  console.log(`节点注册成功：THREADBEACON_NODE_ID=${registered.node.id}`);
  console.log(`请安全保存一次性令牌：THREADBEACON_NODE_TOKEN=${registered.token}`);
  const credentials = { id: registered.node.id, token: registered.token };
  if (config.stateFile) { await saveWorkerStateFile(config.stateFile, credentials); console.log(`节点凭据已安全保存到 ${config.stateFile}`); }
  return credentials;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replaceAll(/(?:sk|key|token)-[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .slice(0, 1_000);
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function taskOptions(job: ControlJob): Record<string, unknown> {
  try {
    const value = JSON.parse(job.source_options_json || '{}') as unknown;
    if (!value || typeof value !== 'object') return {};
    const object = value as Record<string, unknown>;
    return object;
  } catch {
    throw new Error('任务的 source_options_json 不是合法 JSON');
  }
}

function nestedValue(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function itemText(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item ?? '');
  const value = item as Record<string, unknown>;
  return ['text', 'content', 'title', 'description', 'summary']
    .map((key) => value[key]).filter((part): part is string => typeof part === 'string').join('\n');
}

function normalizeItem(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const value = item as Record<string, unknown>;
  const normalized = { ...value };
  for (const key of ['title', 'text', 'content', 'author']) {
    if (typeof normalized[key] === 'string') normalized[key] = normalized[key].trim().replaceAll(/\s+/g, ' ');
  }
  return normalized;
}

function dedupeItems(items: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const key = String(value['id'] ?? value['url'] ?? itemText(item)).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function filterItems(items: readonly unknown[], config: Record<string, unknown>): unknown[] {
  const field = typeof config['field'] === 'string' ? config['field'] : '';
  const operator = typeof config['operator'] === 'string' ? config['operator'] : 'contains';
  const expected = config['value'];
  if (expected === undefined || expected === '') return [...items];
  return items.filter((item) => {
    const actual = field ? nestedValue(item, field) : itemText(item);
    if (operator === 'exists') return actual !== undefined && actual !== null && actual !== '';
    if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
      const left = Number(actual); const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return operator === 'gt' ? left > right : operator === 'gte' ? left >= right : operator === 'lt' ? left < right : left <= right;
    }
    const left = String(actual ?? '').toLowerCase(); const right = String(expected).toLowerCase();
    if (operator === 'equals') return left === right;
    if (operator === 'not-contains') return !left.includes(right);
    if (operator === 'regex') {
      try { return new RegExp(String(expected), 'i').test(String(actual ?? '')); } catch { return false; }
    }
    return left.includes(right);
  });
}

function runtimeSpec(input: unknown): RuntimeWorkflowSpec | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value['nodes']) || !Array.isArray(value['edges'])) return null;
  const nodes = value['nodes'].filter((node): node is RuntimeWorkflowNode => Boolean(node && typeof node === 'object'
    && typeof (node as { id?: unknown }).id === 'string' && typeof (node as { type?: unknown }).type === 'string'));
  const edges = value['edges'].filter((edge): edge is RuntimeWorkflowEdge => Boolean(edge && typeof edge === 'object'
    && typeof (edge as { source?: unknown }).source === 'string' && typeof (edge as { target?: unknown }).target === 'string'));
  return { nodes, edges };
}

/** Execute the source-local portion of a workflow DAG and report merge-dependent nodes explicitly. */
export function executeWorkflowPostProcessing(
  report: Record<string, unknown>,
  specInput: unknown,
  sourceNodeId: string,
): WorkflowExecutionResult {
  const spec = runtimeSpec(specInput);
  if (!spec || !spec.nodes.some((node) => node.id === sourceNodeId && node.type === 'source')) {
    return { sourceNodeId, status: 'partial', nodes: [] };
  }
  const incoming = new Map<string, string[]>(); const outgoing = new Map<string, string[]>();
  for (const edge of spec.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const reachable = new Set([sourceNodeId]); const queue = [sourceNodeId];
  while (queue.length) for (const target of outgoing.get(queue.shift()!) ?? []) if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
  const pending = new Map(spec.nodes.map((node) => [node.id, (incoming.get(node.id) ?? []).length]));
  const ordered: RuntimeWorkflowNode[] = []; const ready = spec.nodes.filter((node) => pending.get(node.id) === 0);
  while (ready.length) {
    const node = ready.shift()!; ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const left = (pending.get(target) ?? 0) - 1; pending.set(target, left);
      if (left === 0) { const next = spec.nodes.find((candidate) => candidate.id === target); if (next) ready.push(next); }
    }
  }
  const data = new Map<string, unknown[]>(); const states = new Map<string, WorkflowNodeExecution>();
  data.set(sourceNodeId, Array.isArray(report['items']) ? [...report['items']] : []);
  const painPoints = Array.isArray(report['painPoints']) ? report['painPoints'] : [];
  const results: WorkflowNodeExecution[] = [];
  for (const node of ordered) {
    if (!reachable.has(node.id) || node.id === sourceNodeId || node.type === 'source') continue;
    const parents = incoming.get(node.id) ?? [];
    if (parents.some((id) => !reachable.has(id))) {
      const result: WorkflowNodeExecution = { nodeId: node.id, type: node.type, status: 'deferred', inputCount: 0, outputCount: 0, message: '等待其他来源分支在控制平面合并' };
      states.set(node.id, result); results.push(result); continue;
    }
    if (parents.some((id) => ['blocked', 'skipped', 'deferred', 'unsupported'].includes(states.get(id)?.status ?? ''))) {
      const result: WorkflowNodeExecution = { nodeId: node.id, type: node.type, status: 'skipped', inputCount: 0, outputCount: 0, message: '上游节点未产生可用输出' };
      states.set(node.id, result); results.push(result); continue;
    }
    const input = parents.flatMap((id) => data.get(id) ?? []); const config = node.config ?? {};
    let output = input; let status: WorkflowNodeExecution['status'] = 'completed'; let detail: unknown;
    let message = `${node.type} 处理完成`;
    if (node.type === 'normalize') output = input.map(normalizeItem);
    else if (node.type === 'dedupe') output = dedupeItems(input);
    else if (node.type === 'filter') output = filterItems(input, config);
    else if (node.type === 'gate') {
      let passed: boolean; let actual: number; let expected: number;
      if (typeof config['metric'] === 'string') {
        const quality = report['dataQuality'] === 'reliable' ? 100 : report['dataQuality'] === 'preliminary' ? 60 : 25;
        const metrics: Record<string, number> = { itemCount: input.length, painPointCount: painPoints.length, sourceCount: 1, qualityScore: quality };
        actual = metrics[config['metric']] ?? 0; expected = Number(config['threshold'] ?? 0) || 0;
        const operator = String(config['operator'] ?? 'gte');
        passed = operator === 'gt' ? actual > expected : operator === 'lte' ? actual <= expected
          : operator === 'lt' ? actual < expected : operator === 'eq' ? actual === expected : actual >= expected;
      } else {
        const minItems = Math.max(0, Number(config['minItems'] ?? 1) || 0); const minPainPoints = Math.max(0, Number(config['minPainPoints'] ?? 0) || 0);
        actual = input.length; expected = minItems; passed = input.length >= minItems && painPoints.length >= minPainPoints;
      }
      detail = { passed, actual, threshold: expected, metric: config['metric'] ?? 'itemCount', operator: config['operator'] ?? 'gte' };
      if (!passed) {
        const onReject = String(config['onReject'] ?? 'stop');
        status = onReject === 'continue' ? 'completed' : onReject === 'skip' ? 'skipped' : 'blocked';
        if (status !== 'completed') output = [];
        message = onReject === 'continue' ? '门禁未通过，按配置继续执行' : onReject === 'skip' ? '门禁未通过，已跳过该分支' : '门禁未通过，已停止该分支';
      } else message = '门禁条件已通过';
    } else if (node.type === 'agent') {
      const themes = painPoints.slice(0, 10).map((point) => point && typeof point === 'object' ? (point as Record<string, unknown>)['theme'] : undefined).filter(Boolean);
      detail = { instruction: String(config['instructions'] ?? config['instruction'] ?? config['prompt'] ?? ''), itemCount: input.length, painPointCount: painPoints.length, topThemes: themes };
      message = 'Agent 已基于本分支分析结果生成结构化结论';
    } else if (node.type === 'dataset') {
      const fields = new Set<string>(); input.slice(0, 100).forEach((item) => { if (item && typeof item === 'object') Object.keys(item).forEach((key) => fields.add(key)); });
      detail = { name: String(config['name'] ?? node.label ?? node.id), rowCount: input.length, fields: [...fields].slice(0, 100), rows: input.slice(0, 1000) };
      message = `数据集已生成 ${input.length} 行`;
    } else if (['cluster', 'llm', 'report'].includes(node.type)) {
      detail = { painPointCount: painPoints.length, generatedAt: report['generatedAt'] };
      message = `${node.type} 已由分析流水线产物满足`;
    } else if (node.type === 'deliver') {
      status = 'deferred'; message = '交付由控制平面规则执行';
    } else {
      status = 'unsupported'; message = `Worker 尚未实现 ${node.type} 节点`;
    }
    if (status === 'completed') data.set(node.id, output);
    const result: WorkflowNodeExecution = { nodeId: node.id, type: node.type, status, inputCount: input.length, outputCount: output.length, ...(detail === undefined ? {} : { output: detail }), message };
    states.set(node.id, result); results.push(result);
  }
  const status = results.some((result) => result.status === 'blocked') ? 'blocked'
    : results.some((result) => result.status !== 'completed') ? 'partial' : 'completed';
  return { sourceNodeId, status, nodes: results };
}

function attachWorkflowExecution(report: Record<string, unknown>, options: Record<string, unknown>): Record<string, unknown> {
  const sourceNodeId = typeof options['workflowSourceNodeId'] === 'string' ? options['workflowSourceNodeId'] : '';
  return sourceNodeId && options['workflowSpec']
    ? { ...report, workflowExecution: executeWorkflowPostProcessing(report, options['workflowSpec'], sourceNodeId) }
    : report;
}

export async function executeCreatorOwned(job: ControlJob, registry: ProviderRegistry): Promise<unknown> {
  const options = taskOptions(job); const grantHandle = typeof options['grantHandle'] === 'string' ? options['grantHandle'].trim() : '';
  if (!grantHandle) throw new Error('自有账号任务缺少授权句柄');
  const provider = registry.resolve(job.platform, 'fetchOwned');
  if (!provider?.fetchOwned) throw new Error(`平台 ${job.platform} 没有已启用的 fetchOwned Provider`);
  const bundle = await provider.fetchOwned({ grantHandle, limit: job.limit });
  const report = attachWorkflowExecution({
    painPoints: [], items: bundle.items, provenance: bundle.provenance,
    stats: { totalTexts: bundle.items.length, clusteredTexts: 0, clusterCount: 0, noiseCount: 0, summarizedClusters: 0, skippedClusters: 0 },
    dataQuality: 'authorized-first-party', keyword: job.keyword, generatedAt: new Date().toISOString(), acquisitionMode: 'fetchOwned',
  }, options);
  return prepareWorkerReport(report, registry, options);
}

async function executeJob(job: ControlJob, catalog: readonly OpenCliCommand[]): Promise<unknown> {
  const options = taskOptions(job);
  if (job.platform === 'geo') {
    const report = await executeOfficialSiteGeoReport(job.keyword, options);
    return attachWorkflowExecution(
      { ...report },
      options,
    );
  }
  let registry: ProviderRegistry;
  if (job.platform.startsWith('opencli:')) {
    const site = job.platform.slice('opencli:'.length);
    const command = typeof options['command'] === 'string' ? options['command'] : undefined;
    const args = Array.isArray(options['args'])
      ? options['args'].filter((item): item is string => typeof item === 'string') : undefined;
    registry = new ProviderRegistry();
    registry.register(await createOpenCliProvider(site, {
      catalog, ...(command ? { command } : {}), ...(args?.length ? { args } : {}),
    }));
  } else if (job.platform === 'rss' || job.platform === 'rest' || job.platform === 'web') {
    const config = options['config'];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('通用数据源任务缺少 config');
    }
    registry = new ProviderRegistry();
    registry.register(new GenericSourceProvider(job.platform, config as GenericSourceConfig));
  } else {
    registry = buildRegistry();
  }
  if (options['mode'] === 'fetchOwned') return executeCreatorOwned(job, registry);
  if (options['sourceTest'] === true) {
    const provider = registry.resolve(job.platform, 'searchAll');
    if (!provider?.searchAll) throw new Error(`平台 ${job.platform} 不支持连接测试`);
    const bundle = await provider.searchAll({ keyword: job.keyword, limit: job.limit, includeComments: false });
    const cursor = provider instanceof GenericSourceProvider ? provider.cursor() : {};
    const report = attachWorkflowExecution({
      painPoints: [], items: bundle.items, provenance: bundle.provenance,
      stats: { totalTexts: bundle.items.length, clusteredTexts: 0, clusterCount: 0, noiseCount: 0, summarizedClusters: 0, skippedClusters: 0 },
      dataQuality: 'exploratory', keyword: job.keyword, generatedAt: new Date().toISOString(),
      sourceCursor: cursor, sourceTest: true,
    }, options);
    return prepareWorkerReport(report, registry, options);
  }
  const report = await analyze(
    {
      registry,
      clustering: new ClusteringService(),
      llm: createLlmClient(llmConfigFromEnv()),
      summaryConcurrency: summaryConcurrencyFromEnv(),
    },
    {
      platform: job.platform,
      keyword: job.keyword,
      limit: job.limit,
      includeComments: job.include_comments !== 0,
      ...(options['playbookKey'] === 'competitive-research' ? { researchMethod: 'competitive-research' as const } : {}),
    },
  );
  const provider = registry.resolve(job.platform, 'searchAll');
  const output = attachWorkflowExecution({
    ...report,
    ...(provider instanceof GenericSourceProvider ? { sourceCursor: provider.cursor() } : {}),
  }, options);
  return prepareWorkerReport(output, registry, options);
}

function directAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization; const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function directJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value); response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }); response.end(body);
}

async function directBody(request: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > maxBytes) throw new RangeError('请求体超过 1 MiB'); chunks.push(buffer);
  }
  if (!chunks.length) throw new TypeError('请求体必须是 JSON 对象');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new TypeError('请求体不是合法 JSON'); }
}

function directJob(input: unknown, capabilities: readonly Platform[]): ControlJob {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('任务必须是 JSON 对象');
  const value = input as Record<string, unknown>; const platform = value['platform']; const keyword = typeof value['keyword'] === 'string' ? value['keyword'].trim() : '';
  if (typeof platform !== 'string' || !capabilities.includes(platform as Platform)) throw new RangeError('Agent 不支持该任务平台');
  const limit = Number(value['limit'] ?? 100); const attempt = Number(value['attempt'] ?? 1); if (!keyword || keyword.length > 200) throw new RangeError('keyword 长度必须是 1-200');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit 必须是 1-1000');
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) throw new RangeError('attempt 必须是 1-100');
  const sourceOptions = typeof value['source_options_json'] === 'string' ? value['source_options_json'] : '{}';
  if (sourceOptions.length > 100_000) throw new RangeError('source_options_json 过大');
  try { JSON.parse(sourceOptions); } catch { throw new TypeError('source_options_json 不是合法 JSON'); }
  return { id: typeof value['id'] === 'string' && value['id'] ? value['id'].slice(0, 100) : crypto.randomUUID(), platform: platform as Platform, keyword, source_options_json: sourceOptions, limit, include_comments: value['include_comments'] === 0 || value['includeComments'] === false ? 0 : 1, attempt };
}

export async function startDirectAgentServer(
  config: DirectAgentConfig,
  catalog: readonly OpenCliCommand[],
  signal?: AbortSignal,
): Promise<DirectAgentServer> {
  const capabilities = availablePlatforms(catalog); let active = 0; const startedAt = Date.now();
  const executions = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();
  const server = createServer((request, response) => { void (async () => {
    if (!directAuthorized(request, config.token)) { response.setHeader('www-authenticate', 'Bearer'); directJson(response, 401, { error: 'Bearer token 无效' }); return; }
    const path = new URL(request.url ?? '/', 'http://agent.local').pathname;
    if (request.method === 'GET' && path === '/health') { directJson(response, 200, { state: 'ready', transport: 'direct-http', activeJobs: active, maxConcurrency: config.concurrency, uptimeSeconds: Math.trunc((Date.now() - startedAt) / 1000) }); return; }
    if (request.method === 'GET' && path === '/capabilities') { directJson(response, 200, { capabilities, transport: 'direct-http', protocolVersion: 1 }); return; }
    if (request.method === 'POST' && path === '/execute') {
      const job = directJob(await directBody(request), capabilities); active += 1;
      const cached = executions.get(job.id);
      if (cached && cached.expiresAt > Date.now()) { active -= 1; directJson(response, 200, { jobId: job.id, report: await cached.promise, idempotentReplay: true }); return; }
      if (active > config.concurrency) { active -= 1; directJson(response, 503, { error: 'Agent 并发已满' }); return; }
      if (executions.size > 1000) for (const [id, entry] of executions) if (entry.expiresAt <= Date.now()) executions.delete(id);
      const entry: { promise: Promise<unknown>; expiresAt: number } = { promise: Promise.resolve({}), expiresAt: Number.POSITIVE_INFINITY };
      const promise = executeJob(job, catalog).then((report) => { entry.expiresAt = Date.now() + 10 * 60_000; return report; }).catch((error) => { executions.delete(job.id); throw error; });
      entry.promise = promise; executions.set(job.id, entry);
      try { directJson(response, 200, { jobId: job.id, report: await promise }); } finally { active -= 1; }
      return;
    }
    directJson(response, 404, { error: 'Not Found' });
  })().catch((error) => { if (!response.headersSent) directJson(response, error instanceof RangeError || error instanceof TypeError ? 400 : 500, { error: safeError(error) }); else response.destroy(); }); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); const host = config.host.includes(':') ? `[${config.host}]` : config.host; const port = typeof address === 'object' && address ? address.port : config.port;
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (signal) signal.addEventListener('abort', () => { void close(); }, { once: true });
  return { server, url: `http://${host}:${port}`, activeJobs: () => active, close };
}

export async function runGatewayAgent(
  config: GatewayWorkerConfig,
  catalog: readonly OpenCliCommand[],
  signal: AbortSignal,
  executor: (job: ControlJob, catalog: readonly OpenCliCommand[]) => Promise<unknown> = executeJob,
): Promise<void> {
  const capabilities = availablePlatforms(catalog); let active = 0; let backoff = 1_000; let current: WebSocket | null = null;
  const executions = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();
  const sendMessage = (value: unknown) => { if (!current || current.readyState !== WebSocket.OPEN) return false; current.send(JSON.stringify(value)); return true; };
  while (!signal.aborted) {
    try {
      const socket = new WebSocket(config.url, { headers: { authorization: `Bearer ${config.token}` }, handshakeTimeout: 10_000 }); current = socket;
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      backoff = 1_000;
      socket.send(JSON.stringify({ type: 'register', protocolVersion: 1, agentId: config.agentId, capabilities, maxConcurrency: config.concurrency }));
      const heartbeat = setInterval(() => { sendMessage({ type: 'heartbeat', activeJobs: active, sentAt: new Date().toISOString() }); }, 15_000);
      await new Promise<void>((resolve) => {
        socket.on('message', (data) => { void (async () => {
          const message = JSON.parse(data.toString()) as Record<string, unknown>;
          if (message['type'] === 'registered' || message['type'] === 'ping') { sendMessage({ type: 'heartbeat', activeJobs: active, sentAt: new Date().toISOString() }); return; }
          if (message['type'] === 'cancel') return; // Pipelines are not fully abortable; late results remain idempotent and are ignored by an expired lease.
          if (message['type'] !== 'job') return;
          const job = directJob(message['job'], capabilities); const executionKey = `${job.id}:${job.attempt}`; const cached = executions.get(executionKey);
          sendMessage({ type: 'ack', jobId: job.id });
          if (cached && cached.expiresAt > Date.now()) {
            try { sendMessage({ type: 'result', jobId: job.id, report: await cached.promise }); } catch (error) { sendMessage({ type: 'error', jobId: job.id, error: safeError(error) }); }
            return;
          }
          if (active >= config.concurrency) { sendMessage({ type: 'error', jobId: job.id, error: 'Agent 并发已满' }); return; }
          if (executions.size > 1000) for (const [id, entry] of executions) if (entry.expiresAt <= Date.now()) executions.delete(id);
          active += 1; const entry = { promise: Promise.resolve<unknown>({}), expiresAt: Number.POSITIVE_INFINITY };
          const promise = executor(job, catalog).then((report) => { entry.expiresAt = Date.now() + 10 * 60_000; return report; }).catch((error) => { executions.delete(executionKey); throw error; }).finally(() => { active = Math.max(0, active - 1); });
          entry.promise = promise; executions.set(executionKey, entry);
          try { sendMessage({ type: 'result', jobId: job.id, report: await promise }); } catch (error) { sendMessage({ type: 'error', jobId: job.id, error: safeError(error) }); }
        })().catch((error) => { const input = (() => { try { return JSON.parse(data.toString()) as Record<string, unknown>; } catch { return {}; } })(); if (typeof input['jobId'] === 'string') sendMessage({ type: 'error', jobId: input['jobId'], error: safeError(error) }); }); });
        socket.once('close', () => { clearInterval(heartbeat); resolve(); });
        socket.once('error', () => undefined);
        signal.addEventListener('abort', () => { clearInterval(heartbeat); socket.close(1000, 'worker shutdown'); resolve(); }, { once: true });
      });
    } catch (error) { if (!signal.aborted) console.warn(`Gateway 连接失败，将重试：${safeError(error)}`); }
    finally { if (current?.readyState === WebSocket.OPEN) current.close(); current = null; }
    if (!signal.aborted) { await wait(backoff, signal); backoff = Math.min(30_000, backoff * 2); }
  }
}

async function runSlot(
  slot: number,
  config: WorkerConfig,
  credentials: NodeCredentials,
  signal: AbortSignal,
  activeJobs: Set<string>,
  catalog: readonly OpenCliCommand[],
  cdpEndpoint: string,
): Promise<void> {
  while (!signal.aborted) {
    let job: ControlJob | null = null;
    try {
      const claimed = await requestJson<{ job: ControlJob | null }>(
        config,
        '/api/worker/claim',
        signal,
        { credentials, body: { nodeId: credentials.id } },
      );
      job = claimed.job;
    } catch (error) {
      if (signal.aborted) return;
      console.error(`[slot ${slot}] 抢单失败：${safeError(error)}`);
      await wait(config.pollMs, signal);
      continue;
    }

    if (!job && cdpEndpoint && process.env['LLM_API_KEY']?.trim() && process.env['LLM_MODEL']?.trim()) {
      let skillRun: SkillAgentRun | null = null;
      try {
        const claimed = await requestJson<{ run: SkillAgentRun | null }>(config, '/api/worker/skills/claim', signal, {
          credentials, body: { nodeId: credentials.id },
        });
        skillRun = claimed.run;
      } catch (error) {
        if (!signal.aborted) console.error(`[slot ${slot}] Agent Skill 抢单失败：${safeError(error)}`);
      }
      if (skillRun) {
        activeJobs.add(skillRun.id);
        console.log(`[slot ${slot}] 开始 Agent Skill ${skillRun.id}：${skillRun.capability}`);
        try {
          const result = await executeSkillAgent(skillRun, createLlmClient(llmConfigFromEnv()), cdpEndpoint);
          const path = result.status === 'paused'
            ? `/api/worker/skills/${encodeURIComponent(skillRun.id)}/pause`
            : `/api/worker/skills/${encodeURIComponent(skillRun.id)}/complete`;
          await requestJson(config, path, signal, {
            credentials,
            body: { nodeId: credentials.id, events: result.events, state: result.state,
              ...(result.outcome ? { outcome: result.outcome } : {}),
              ...(result.action ? { action: result.action } : {}),
              ...(result.element ? { element: result.element } : {}) },
            timeoutMs: 60_000,
          });
          console.log(`[slot ${slot}] Agent Skill ${skillRun.id} ${result.status === 'paused' ? '等待人工确认' : '执行完成'}`);
        } catch (error) {
          const message = safeError(error);
          console.error(`[slot ${slot}] Agent Skill ${skillRun.id} 失败：${message}`);
          if (!signal.aborted) await requestJson(config, `/api/worker/skills/${encodeURIComponent(skillRun.id)}/fail`, signal, {
            credentials, body: { nodeId: credentials.id, error: message },
          }).catch(reportError => console.error(`[slot ${slot}] 回报 Agent Skill 失败状态失败：${safeError(reportError)}`));
        } finally { activeJobs.delete(skillRun.id); }
        continue;
      }
    }

    if (!job && cdpEndpoint) {
      let action: BrowserActionCommand | null = null;
      try {
        const claimed = await requestJson<{ action: BrowserActionCommand | null }>(config, '/api/browser/worker/claim', signal, { credentials, body: { nodeId: credentials.id } });
        action = claimed.action;
      } catch (error) {
        if (!signal.aborted) console.error(`[slot ${slot}] 浏览器动作抢单失败：${safeError(error)}`);
      }
      if (action) {
        activeJobs.add(action.id);
        console.log(`[slot ${slot}] 开始浏览器动作 ${action.id}：${action.type}`);
        try {
          const timeout = new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error(`浏览器动作超时（${action!.timeoutMs}ms）`)), action!.timeoutMs); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('worker stopping')); }, { once: true }); });
          const result = await Promise.race([executeBrowserAction(action, cdpEndpoint), timeout]);
          await requestJson(config, `/api/browser/worker/actions/${encodeURIComponent(action.id)}/complete`, signal, { credentials, body: { nodeId: credentials.id, result }, timeoutMs: 60_000 });
          console.log(`[slot ${slot}] 完成浏览器动作 ${action.id}`);
        } catch (error) {
          const message = safeError(error);
          console.error(`[slot ${slot}] 浏览器动作 ${action.id} 失败：${message}`);
          if (!signal.aborted) await requestJson(config, `/api/browser/worker/actions/${encodeURIComponent(action.id)}/fail`, signal, { credentials, body: { nodeId: credentials.id, error: message } }).catch(reportError => console.error(`[slot ${slot}] 回报浏览器动作失败状态失败：${safeError(reportError)}`));
        } finally { activeJobs.delete(action.id); }
        continue;
      }
    }

    if (!job) { await wait(config.pollMs, signal); continue; }

    activeJobs.add(job.id);
    console.log(`[slot ${slot}] 开始任务 ${job.id}：${job.platform} / ${job.keyword}`);
    try {
      const report = await executeJob(job, catalog);
      await requestJson(config, `/api/worker/jobs/${encodeURIComponent(job.id)}/complete`, signal, {
        credentials,
        body: { nodeId: credentials.id, report },
        timeoutMs: 60_000,
      });
      console.log(`[slot ${slot}] 完成任务 ${job.id}`);
    } catch (error) {
      const message = safeError(error);
      console.error(`[slot ${slot}] 任务 ${job.id} 失败：${message}`);
      if (!signal.aborted) {
        try {
          await requestJson(config, `/api/worker/jobs/${encodeURIComponent(job.id)}/fail`, signal, {
            credentials,
            body: { nodeId: credentials.id, error: message },
          });
        } catch (reportError) {
          console.error(`[slot ${slot}] 回报失败状态失败：${safeError(reportError)}`);
        }
      }
    } finally {
      activeJobs.delete(job.id);
    }
  }
}

async function runBrowserSlot(
  slot: number,
  config: WorkerConfig,
  credentials: NodeCredentials,
  signal: AbortSignal,
  activeJobs: Set<string>,
  cdpEndpoint: string,
): Promise<void> {
  while (!signal.aborted) {
    let action: BrowserActionCommand | null = null;
    try {
      const claimed = await requestJson<{ action: BrowserActionCommand | null }>(
        config,
        '/api/browser/worker/claim',
        signal,
        { credentials, body: { nodeId: credentials.id } },
      );
      action = claimed.action;
    } catch (error) {
      if (signal.aborted) return;
      console.error(`[browser slot ${slot}] 浏览器动作抢单失败：${safeError(error)}`);
      await wait(config.pollMs, signal);
      continue;
    }

    if (!action) { await wait(config.pollMs, signal); continue; }
    activeJobs.add(action.id);
    console.log(`[browser slot ${slot}] 开始浏览器动作 ${action.id}：${action.type}`);
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`浏览器动作超时（${action!.timeoutMs}ms）`)), action!.timeoutMs);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('worker stopping')); }, { once: true });
      });
      const result = await Promise.race([executeBrowserAction(action, cdpEndpoint), timeout]);
      await requestJson(config, `/api/browser/worker/actions/${encodeURIComponent(action.id)}/complete`, signal, {
        credentials, body: { nodeId: credentials.id, result }, timeoutMs: 60_000,
      });
      console.log(`[browser slot ${slot}] 完成浏览器动作 ${action.id}`);
    } catch (error) {
      const message = safeError(error);
      console.error(`[browser slot ${slot}] 浏览器动作 ${action.id} 失败：${message}`);
      if (!signal.aborted) {
        await requestJson(config, `/api/browser/worker/actions/${encodeURIComponent(action.id)}/fail`, signal, {
          credentials, body: { nodeId: credentials.id, error: message },
        }).catch((reportError) => console.error(`[browser slot ${slot}] 回报浏览器动作失败状态失败：${safeError(reportError)}`));
      }
    } finally { activeJobs.delete(action.id); }
  }
}

export async function runWorker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  loadEnvFiles();
  const effectiveEnv = await workerEnvWithState(env);
  await configureProxyFromEnv(effectiveEnv);
  const directConfig = directAgentConfigFromEnv(effectiveEnv);
  const gatewayConfig = gatewayWorkerConfigFromEnv(effectiveEnv);
  const config = effectiveEnv['THREADBEACON_CONTROL_URL']?.trim() ? workerConfigFromEnv(effectiveEnv) : null;
  if (!config && !directConfig && !gatewayConfig) throw new Error('缺少执行传输配置：THREADBEACON_CONTROL_URL、THREADBEACON_DIRECT_LISTEN 或 THREADBEACON_GATEWAY_WS_URL');
  let openCliCatalog: OpenCliCommand[] = [];
  let openCliRuntime: OpenCliRuntimeReport | null = null;
  try {
    openCliRuntime = await inspectOpenCliRuntime({
      ...(effectiveEnv['OPENCLI_BIN']?.trim() ? { binary: effectiveEnv['OPENCLI_BIN']!.trim() } : {}),
      ...(effectiveEnv['OPENCLI_EXPECTED_VERSION']?.trim() ? { expectedVersion: effectiveEnv['OPENCLI_EXPECTED_VERSION']!.trim() } : {}),
      ...(effectiveEnv['OPENCLI_CDP_ENDPOINT']?.trim() ? { cdpEndpoint: effectiveEnv['OPENCLI_CDP_ENDPOINT']!.trim() } : {}),
    });
    openCliCatalog = [...openCliRuntime.catalog];
    const browserState = openCliRuntime.browserReady
      ? 'CDP ready'
      : openCliRuntime.cdpConfigured ? `CDP unavailable: ${openCliRuntime.cdpError}` : 'CDP not configured';
    console.log(`OpenCLI ${openCliRuntime.version} 运行时已验证；可执行 ${openCliRuntime.executableCommandCount}/${openCliRuntime.discoveredCommandCount} 个命令，${openCliRuntime.readSiteCount} 个只读站点；${browserState}`);
  } catch (error) {
    console.warn(`OpenCLI 运行时契约验证失败，仅启用原生数据源：${safeError(error)}`);
  }
  let browserAttestation = await attestBrowserProfile(effectiveEnv);
  if (browserAttestation.profileKind === 'anonymous' && !browserAttestation.verified) {
    console.warn(`匿名浏览器证明失败，GEO 不会上报：${browserAttestation.error ?? 'Cookie jar 非空'}`);
  }
  const capabilities = availablePlatforms(openCliCatalog, effectiveEnv, browserAttestation);
  if (capabilities.length === 0) throw new Error('当前节点没有可用的数据源能力');
  // Gateway 模式把数据能力交给 Gateway 聚合；控制面节点自身不应同时声明一份
  // 可派发的 social catalog，避免 runtime metadata 与 capabilities_json 分叉。
  const capabilityMetadata = gatewayConfig
    ? { socialCapabilities: [] as readonly SocialCapabilityMetadata[] }
    : workerCapabilityMetadata(openCliCatalog, effectiveEnv);

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const directServer = directConfig ? await startDirectAgentServer(directConfig, openCliCatalog, controller.signal) : null;
  if (directServer) console.log(`Direct Agent 已监听 ${directServer.url}；公网使用时必须置于 HTTPS 反向代理之后`);
  const gatewayTask = gatewayConfig ? runGatewayAgent(gatewayConfig, openCliCatalog, controller.signal) : null;
  if (gatewayConfig) console.log(`Reverse Agent 正在连接 Gateway：${gatewayConfig.url}`);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    if (!config) {
      if (gatewayTask) await gatewayTask;
      else await new Promise<void>((resolve) => controller.signal.aborted ? resolve() : controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      return;
    }
    // Gateway 的数据能力由 Gateway 聚合节点登记；本 Worker 只保留控制面身份和浏览器动作通道，
    // 避免同一数据任务同时被 polling 与 WebSocket 抢到。
    const agentSkillReady = !gatewayConfig && Boolean(effectiveEnv['OPENCLI_CDP_ENDPOINT']?.trim()
      && effectiveEnv['LLM_API_KEY']?.trim() && effectiveEnv['LLM_MODEL']?.trim());
    const controlCapabilities: string[] = gatewayConfig ? [] : [...capabilities, ...(agentSkillReady ? ['agent-skill'] : [])];
    const credentials = await credentialsFor(config, controlCapabilities, controller.signal, gatewayConfig ? null : directConfig, browserAttestation, capabilityMetadata); const activeJobs = new Set<string>();
    console.log(`节点 ${config.nodeName} 已上线；能力 ${gatewayConfig ? 'browser-only' : capabilities.join(', ')}；并发 ${config.concurrency}`);
    const sendHeartbeat = async () => {
      if (Date.parse(browserAttestation.expiresAt) - Date.now() < 30_000) browserAttestation = await attestBrowserProfile(effectiveEnv);
      const reportedCapabilities: string[] = gatewayConfig ? [] : [
        ...availablePlatforms(openCliCatalog, effectiveEnv, browserAttestation),
        ...(agentSkillReady ? ['agent-skill'] : []),
      ];
      return requestJson(config, '/api/worker/heartbeat', controller.signal, {
        credentials,
        body: {
          nodeId: credentials.id, activeJobs: activeJobs.size + (directServer?.activeJobs() ?? 0),
          capabilities: reportedCapabilities,
          maxConcurrency: config.concurrency,
          health: { state: 'ready', memoryFreeBytes: freemem(), memoryTotalBytes: totalmem(), uptimeSeconds: Math.trunc(process.uptime()) },
          runtime: {
            transport: directConfig?.publicUrl && !gatewayConfig ? 'direct-http' : 'outbound-polling',
            ...(directConfig?.publicUrl && !gatewayConfig ? { endpoint: directConfig.publicUrl, token: directConfig.token } : {}),
            role: gatewayConfig ? 'browser-actions' : 'worker',
            os: osPlatform(),
            arch: process.arch,
            browserProfile: browserAttestation.profileName,
            browserProfileKind: browserAttestation.profileKind,
            browserEndpointConfigured: Boolean(effectiveEnv['OPENCLI_CDP_ENDPOINT']?.trim()),
            browserAttestation,
            cpuCount: cpus().length,
            capabilityMetadata,
            opencli: openCliRuntime ? {
              ready: true,
              version: openCliRuntime.version,
              expectedVersion: openCliRuntime.expectedVersion,
              discoveredCommands: openCliRuntime.discoveredCommandCount,
              executableCommands: openCliRuntime.executableCommandCount,
              readSites: openCliRuntime.readSiteCount,
              browserCommands: openCliRuntime.browserCommandCount,
              browserReady: openCliRuntime.browserReady,
              cdpConfigured: openCliRuntime.cdpConfigured,
              ...(openCliRuntime.cdpError ? { cdpError: openCliRuntime.cdpError } : {}),
            } : { ready: false },
          },
        },
      });
    };
    await sendHeartbeat().catch((error) => { console.warn(`首次心跳失败，将继续重试：${safeError(error)}`); });
    const heartbeatMs = capabilities.includes('geo' as Platform) ? 5_000 : 20_000;
    heartbeat = setInterval(() => { void sendHeartbeat().catch((error) => { if (!controller.signal.aborted) console.error(`心跳失败：${safeError(error)}`); }); }, heartbeatMs);
    if (gatewayConfig) {
      const cdpEndpoint = effectiveEnv['OPENCLI_CDP_ENDPOINT']?.trim() ?? '';
      const browserTasks = cdpEndpoint
        ? Array.from({ length: config.concurrency }, (_, index) => runBrowserSlot(index + 1, config, credentials, controller.signal, activeJobs, cdpEndpoint))
        : [];
      if (!cdpEndpoint) console.log('Gateway 模式未配置 OPENCLI_CDP_ENDPOINT；仅运行反向数据 Agent 和控制面心跳');
      await Promise.all([gatewayTask!, ...browserTasks]);
    } else if (directConfig?.publicUrl) {
      console.log('节点运行于 direct-http 模式；为避免并发超配，已禁用 outbound polling slots');
      await new Promise<void>((resolve) => controller.signal.aborted ? resolve() : controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    } else {
      await Promise.all(Array.from({ length: config.concurrency }, (_, index) => runSlot(index + 1, config, credentials, controller.signal, activeJobs, openCliCatalog, effectiveEnv['OPENCLI_CDP_ENDPOINT']?.trim() ?? '')));
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (directServer?.server.listening) await directServer.close().catch(() => undefined);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runWorker().catch((error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  });
}
