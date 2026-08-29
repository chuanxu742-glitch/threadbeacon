#!/usr/bin/env -S npx tsx

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { InMemoryGatewayCoordination, type GatewayResultEnvelope } from './gateway-coordination.js';
import { GATEWAY_PROTOCOL_VERSION, parseAgentMessage, parseGatewayJob, type GatewayJob, type GatewayToAgentMessage } from './gateway-protocol.js';
import { loadWorkerStateFile, saveWorkerStateFile, type NodeCredentials } from './worker.js';

export interface GatewayControlConfig {
  controlUrl: string;
  publicUrl: string;
  nodeName: string;
  registrationKey?: string;
  nodeId?: string;
  nodeToken?: string;
  stateFile?: string;
  heartbeatMs: number;
}
export interface GatewayConfig { host: string; port: number; agentToken: string; controlToken: string; gatewayId: string; dispatchTimeoutMs: number; control?: GatewayControlConfig }
export interface GatewaySnapshot { capabilities: string[]; maxConcurrency: number; activeJobs: number; connectedAgents: number }
export interface GatewayControlLink { credentials: NodeCredentials; heartbeatNow(): Promise<void>; close(): void }
export type GatewayResultSink = (result: GatewayResultEnvelope, job: GatewayJob) => Promise<void>;
interface AgentConnection { id: string; socket: WebSocket; capabilities: Set<string>; maxConcurrency: number; activeJobs: number; lastSeenAt: number; registered: boolean }
interface Assignment { agent: AgentConnection; job: GatewayJob; mode: 'sync' | 'async'; leaseOwner: string; leaseTtlMs: number; ack: Promise<void>; acknowledge(): void }

function positive(raw: string | undefined, fallback: number, min: number, max: number, name: string) {
  const value = raw ? Number(raw) : fallback; if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} 必须是 ${min}-${max}`); return value;
}
export function gatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const listen = env['THREADBEACON_GATEWAY_LISTEN']?.trim() || '127.0.0.1:8789'; let url: URL;
  try { url = new URL(listen.includes('://') ? listen : `http://${listen}`); } catch { throw new RangeError('THREADBEACON_GATEWAY_LISTEN 必须是 host:port'); }
  if (url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new RangeError('THREADBEACON_GATEWAY_LISTEN 必须是 host:port');
  const port = Number(url.port); if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError('Gateway 端口无效');
  const agentToken = env['THREADBEACON_GATEWAY_AGENT_TOKEN']?.trim() || env['THREADBEACON_GATEWAY_SHARED_SECRET']?.trim() || ''; const controlToken = env['THREADBEACON_GATEWAY_CONTROL_TOKEN']?.trim() ?? '';
  if (agentToken.length < 16 || controlToken.length < 16 || agentToken === controlToken) throw new RangeError('Gateway Agent/Control token 必须不同且至少 16 字符');
  const gatewayId = env['THREADBEACON_GATEWAY_ID']?.trim() || `gateway-${process.pid}`;
  const controlUrlRaw = env['THREADBEACON_CONTROL_URL']?.trim(); let control: GatewayControlConfig | undefined;
  if (controlUrlRaw) {
    const parsedControl = new URL(controlUrlRaw);
    if (!['http:', 'https:'].includes(parsedControl.protocol) || parsedControl.username || parsedControl.password || parsedControl.search || parsedControl.hash) throw new RangeError('THREADBEACON_CONTROL_URL 必须是无凭据的 HTTP(S) URL');
    const publicUrl = new URL(env['THREADBEACON_GATEWAY_PUBLIC_URL']?.trim() || '');
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new RangeError('THREADBEACON_GATEWAY_PUBLIC_URL 必须是公开 HTTPS URL');
    const nodeId = env['THREADBEACON_GATEWAY_NODE_ID']?.trim() || env['THREADBEACON_NODE_ID']?.trim();
    const nodeToken = env['THREADBEACON_GATEWAY_NODE_TOKEN']?.trim() || env['THREADBEACON_NODE_TOKEN']?.trim();
    if ((nodeId && !nodeToken) || (!nodeId && nodeToken)) throw new RangeError('THREADBEACON_GATEWAY_NODE_ID 与 THREADBEACON_GATEWAY_NODE_TOKEN 必须同时配置');
    if (nodeToken && (nodeToken.length < 16 || nodeToken.length > 500)) throw new RangeError('THREADBEACON_GATEWAY_NODE_TOKEN 长度必须是 16-500');
    const nodeName = env['THREADBEACON_GATEWAY_NODE_NAME']?.trim() || env['THREADBEACON_GATEWAY_ID']?.trim() || hostname();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/.test(nodeName)) throw new RangeError('THREADBEACON_GATEWAY_NODE_NAME 格式无效');
    control = {
      controlUrl: parsedControl.toString().replace(/\/$/, ''), publicUrl: publicUrl.toString().replace(/\/$/, ''), nodeName,
      ...(env['THREADBEACON_NODE_REGISTRATION_KEY']?.trim() ? { registrationKey: env['THREADBEACON_NODE_REGISTRATION_KEY'].trim() } : {}),
      ...(nodeId ? { nodeId } : {}), ...(nodeToken ? { nodeToken } : {}),
      ...((env['THREADBEACON_GATEWAY_STATE_FILE']?.trim() || env['THREADBEACON_WORKER_STATE_FILE']?.trim()) ? { stateFile: resolve((env['THREADBEACON_GATEWAY_STATE_FILE']?.trim() || env['THREADBEACON_WORKER_STATE_FILE']!.trim())) } : {}),
      heartbeatMs: positive(env['THREADBEACON_GATEWAY_HEARTBEAT_MS'], 20_000, 1_000, 60_000, 'THREADBEACON_GATEWAY_HEARTBEAT_MS'),
    };
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, agentToken, controlToken, gatewayId, dispatchTimeoutMs: positive(env['THREADBEACON_GATEWAY_DISPATCH_TIMEOUT_MS'], 15_000, 1_000, 120_000, 'THREADBEACON_GATEWAY_DISPATCH_TIMEOUT_MS'), ...(control ? { control } : {}) };
}
function authorized(request: IncomingMessage, token: string) { const header = request.headers.authorization; const supplied = header?.startsWith('Bearer ') ? header.slice(7) : ''; const a = Buffer.from(supplied); const b = Buffer.from(token); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); }
function json(response: ServerResponse, status: number, value: unknown) { const body = JSON.stringify(value); response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }); response.end(body); }
async function body(request: IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += value.length; if (size > 1_048_576) throw new RangeError('请求体超过 1 MiB'); chunks.push(value); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new TypeError('请求体不是合法 JSON'); } }
function send(socket: WebSocket, message: GatewayToAgentMessage) { if (socket.readyState !== WebSocket.OPEN) throw new Error('Agent WebSocket 已断开'); socket.send(JSON.stringify(message)); }
const safeMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replaceAll(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 1000);

export class AgentGateway {
  private readonly agents = new Map<string, AgentConnection>();
  private readonly assignments = new Map<string, Assignment>();
  private readonly server = createServer((request, response) => { void this.http(request, response); });
  private readonly ws = new WebSocketServer({ noServer: true, maxPayload: 9_000_000 });
  private sweep?: ReturnType<typeof setInterval>;
  private readonly snapshotListeners = new Set<() => void>();
  private resultSink: GatewayResultSink | null = null;
  constructor(readonly config: GatewayConfig, readonly coordination = new InMemoryGatewayCoordination()) {
    this.server.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://gateway.local').pathname;
      if (path !== '/agent' || !authorized(request, config.agentToken)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      this.ws.handleUpgrade(request, socket, head, (client) => this.accept(client));
    });
  }
  private accept(socket: WebSocket) {
    let connection: AgentConnection | null = null;
    const registrationTimer = setTimeout(() => socket.close(1008, 'register timeout'), 5_000);
    socket.on('message', (data) => { void (async () => {
      const message = parseAgentMessage(JSON.parse(data.toString()) as unknown);
      if (message.type === 'register') {
        if (connection) throw new Error('Agent 已注册');
        const previous = this.agents.get(message.agentId); previous?.socket.close(1012, 'replaced by reconnect');
        connection = { id: message.agentId, socket, capabilities: new Set(message.capabilities), maxConcurrency: message.maxConcurrency, activeJobs: 0, lastSeenAt: Date.now(), registered: true };
        this.agents.set(connection.id, connection); clearTimeout(registrationTimer);
        this.notifySnapshot();
        send(socket, { type: 'registered', protocolVersion: 1, heartbeatIntervalMs: 15_000 }); return;
      }
      if (!connection) throw new Error('Agent 必须先注册'); connection.lastSeenAt = Date.now();
      if (message.type === 'heartbeat') return;
      const assignment = this.assignments.get(message.jobId); if (!assignment || assignment.agent !== connection) return;
      if (message.type === 'ack') { assignment.acknowledge(); return; }
      const result: GatewayResultEnvelope = message.type === 'result'
        ? { jobId: message.jobId, status: 'completed', report: message.report, agentId: connection.id, completedAt: new Date().toISOString(), attempt: assignment.job.attempt }
        : { jobId: message.jobId, status: 'failed', error: message.error, agentId: connection.id, completedAt: new Date().toISOString(), attempt: assignment.job.attempt };
      await this.coordination.publishResult(result, 10 * 60_000);
      if (assignment.mode === 'async') await this.deliverResult(result, assignment.job).catch((error) => console.error(`Gateway 结果回调失败，将由控制面租约恢复：${safeMessage(error)}`));
      await this.finishAssignment(message.jobId, assignment);
    })().catch((error) => socket.close(1008, safeMessage(error))); });
    socket.on('close', () => { clearTimeout(registrationTimer); if (!connection || this.agents.get(connection.id) !== connection) return; this.agents.delete(connection.id); this.notifySnapshot(); void this.failAgentAssignments(connection, 'Agent 连接中断'); });
    socket.on('error', () => undefined);
  }
  private async failAgentAssignments(agent: AgentConnection, reason: string) {
    for (const [jobId, assignment] of this.assignments) if (assignment.agent === agent) {
      const result: GatewayResultEnvelope = { jobId, status: 'failed', error: reason, agentId: agent.id, completedAt: new Date().toISOString(), attempt: assignment.job.attempt };
      await this.coordination.publishResult(result, 60_000);
      if (assignment.mode === 'async') await this.deliverResult(result, assignment.job).catch((error) => console.error(`Gateway 断连回调失败，将由控制面租约恢复：${safeMessage(error)}`));
      await this.finishAssignment(jobId, assignment);
    }
  }
  private async finishAssignment(jobId: string, assignment: Assignment) {
    if (this.assignments.get(jobId) !== assignment) return; this.assignments.delete(jobId); assignment.agent.activeJobs = Math.max(0, assignment.agent.activeJobs - 1); this.notifySnapshot(); await this.coordination.releaseLease(jobId, assignment.leaseOwner);
  }
  snapshot(): GatewaySnapshot {
    const agents = [...this.agents.values()];
    return {
      capabilities: [...new Set(agents.flatMap((agent) => [...agent.capabilities]))].sort(),
      maxConcurrency: agents.reduce((sum, agent) => sum + agent.maxConcurrency, 0),
      activeJobs: this.assignments.size,
      connectedAgents: agents.length,
    };
  }
  disconnectAgents(reason = 'operator requested reconnect') { for (const agent of this.agents.values()) agent.socket.close(1012, reason); }
  onSnapshotChange(listener: () => void) { this.snapshotListeners.add(listener); return () => this.snapshotListeners.delete(listener); }
  setResultSink(sink: GatewayResultSink | null) { this.resultSink = sink; }
  private notifySnapshot() { for (const listener of this.snapshotListeners) listener(); }
  private async deliverResult(result: GatewayResultEnvelope, job: GatewayJob) {
    if (!this.resultSink) throw new Error('Gateway 尚未连接控制面结果回调');
    let lastError: unknown;
    for (const delayMs of [0, 250, 1_000, 3_000]) {
      if (delayMs) await delay(delayMs);
      try { await this.resultSink(result, job); return; } catch (error) { lastError = error; }
    }
    throw lastError ?? new Error('Gateway 结果回调失败');
  }
  private choose(job: GatewayJob) { return [...this.agents.values()].filter((agent) => agent.registered && agent.socket.readyState === WebSocket.OPEN && agent.capabilities.has(job.platform) && agent.activeJobs < agent.maxConcurrency).sort((a, b) => a.activeJobs - b.activeJobs || b.lastSeenAt - a.lastSeenAt)[0]; }
  async dispatch(jobInput: unknown, timeoutMs = this.config.dispatchTimeoutMs): Promise<GatewayResultEnvelope> {
    const job = parseGatewayJob(jobInput); const cached = await this.coordination.getResult(job.id);
    if (cached?.status === 'completed') return cached;
    if (cached?.status === 'failed') await this.coordination.deleteResult(job.id);
    const leaseOwner = `${this.config.gatewayId}:${crypto.randomUUID()}`; const leased = await this.coordination.acquireLease(job.id, leaseOwner, timeoutMs + 10_000);
    if (!leased) { const shared = await this.coordination.waitForResult(job.id, timeoutMs); if (shared) return shared; throw new Error('任务正在其他 Gateway 执行但等待超时'); }
    const agent = this.choose(job); if (!agent) { await this.coordination.releaseLease(job.id, leaseOwner); throw new RangeError(`没有可用 Agent 支持 ${job.platform}`); }
    let acknowledge!: () => void; const ack = new Promise<void>((resolve) => { acknowledge = resolve; });
    const assignment: Assignment = { agent, job, mode: 'sync', leaseOwner, leaseTtlMs: timeoutMs + 10_000, ack, acknowledge }; this.assignments.set(job.id, assignment); agent.activeJobs += 1; this.notifySnapshot();
    try {
      send(agent.socket, { type: 'job', job });
      const acked = await Promise.race([ack.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000))]);
      if (!acked) throw new Error('Agent 未在 3 秒内 ACK');
      const result = await this.coordination.waitForResult(job.id, timeoutMs); if (!result) { send(agent.socket, { type: 'cancel', jobId: job.id, reason: 'Gateway 等待结果超时' }); throw new Error('Gateway 等待任务结果超时'); }
      return result;
    } finally { await this.finishAssignment(job.id, assignment); }
  }
  async dispatchAsync(jobInput: unknown): Promise<{ jobId: string; agentId: string; idempotent: boolean }> {
    if (!this.resultSink) throw new Error('Gateway 异步派发需要先连接控制面');
    const job = parseGatewayJob(jobInput);
    const current = this.assignments.get(job.id);
    if (current) {
      if (current.job.attempt !== job.attempt) throw new Error(`任务 ${job.id} 的前一尝试仍在运行`);
      await Promise.race([current.ack, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Agent ACK 等待超时')), 3_000))]);
      return { jobId: job.id, agentId: current.agent.id, idempotent: true };
    }
    const cached = await this.coordination.getResult(job.id);
    if (cached && (cached.attempt ?? 1) === job.attempt) {
      await this.deliverResult(cached, job);
      return { jobId: job.id, agentId: cached.agentId, idempotent: true };
    }
    if (cached) await this.coordination.deleteResult(job.id);
    const leaseOwner = `${this.config.gatewayId}:${crypto.randomUUID()}`; const leaseTtlMs = 60_000;
    const leased = await this.coordination.acquireLease(job.id, leaseOwner, leaseTtlMs);
    if (!leased) throw new Error('任务正在其他 Gateway 执行');
    const agent = this.choose(job);
    if (!agent) { await this.coordination.releaseLease(job.id, leaseOwner); throw new RangeError(`没有可用 Agent 支持 ${job.platform}`); }
    let acknowledge!: () => void; const ack = new Promise<void>((resolve) => { acknowledge = resolve; });
    const assignment: Assignment = { agent, job, mode: 'async', leaseOwner, leaseTtlMs, ack, acknowledge };
    this.assignments.set(job.id, assignment); agent.activeJobs += 1; this.notifySnapshot();
    try {
      send(agent.socket, { type: 'job', job });
      await Promise.race([ack, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Agent 未在 3 秒内 ACK')), 3_000))]);
      return { jobId: job.id, agentId: agent.id, idempotent: false };
    } catch (error) { await this.finishAssignment(job.id, assignment); throw error; }
  }
  private async http(request: IncomingMessage, response: ServerResponse) {
    try {
      const path = new URL(request.url ?? '/', 'http://gateway.local').pathname;
      if (request.method === 'GET' && path === '/healthz') { json(response, 200, { state: 'ready', protocolVersion: GATEWAY_PROTOCOL_VERSION }); return; }
      if (!authorized(request, this.config.controlToken)) { response.setHeader('www-authenticate', 'Bearer'); json(response, 401, { error: 'Bearer token 无效' }); return; }
      if (request.method === 'GET' && path === '/health') { const snapshot = this.snapshot(); json(response, 200, { state: 'ready', gatewayId: this.config.gatewayId, agentCount: snapshot.connectedAgents, activeJobs: snapshot.activeJobs, coordination: 'memory' }); return; }
      if (request.method === 'GET' && path === '/capabilities') { json(response, 200, { capabilities: [...new Set([...this.agents.values()].flatMap((agent) => [...agent.capabilities]))], agents: [...this.agents.values()].map((agent) => ({ id: agent.id, activeJobs: agent.activeJobs, maxConcurrency: agent.maxConcurrency, capabilities: [...agent.capabilities], lastSeenAt: new Date(agent.lastSeenAt).toISOString() })) }); return; }
      if (request.method === 'POST' && path === '/dispatch') {
        const input = await body(request); const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
        if (value['mode'] === 'async') {
          const accepted = await this.dispatchAsync(value['job']);
          json(response, 202, { accepted: true, ...accepted }); return;
        }
        const timeoutMs = positive(value['timeoutMs'] === undefined ? undefined : String(value['timeoutMs']), this.config.dispatchTimeoutMs, 1_000, 120_000, 'timeoutMs');
        const result = await this.dispatch(value['job'] ?? input, timeoutMs);
        if (result.status === 'failed') { json(response, 502, { jobId: result.jobId, error: result.error, agentId: result.agentId }); return; }
        json(response, 200, { jobId: result.jobId, report: result.report, agentId: result.agentId }); return;
      }
      json(response, 404, { error: 'Not Found' });
    } catch (error) { json(response, error instanceof RangeError || error instanceof TypeError ? 400 : 503, { error: safeMessage(error) }); }
  }
  async listen() {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.port, this.config.host, () => { this.server.off('error', reject); resolve(); }); });
    this.sweep = setInterval(() => { void (async () => {
      const cutoff = Date.now() - 45_000;
      for (const agent of this.agents.values()) if (agent.lastSeenAt < cutoff) agent.socket.close(1012, 'heartbeat timeout'); else try { send(agent.socket, { type: 'ping', sentAt: new Date().toISOString() }); } catch { agent.socket.close(1012, 'ping failed'); }
      for (const [jobId, assignment] of this.assignments) if (!await this.coordination.renewLease(jobId, assignment.leaseOwner, assignment.leaseTtlMs)) assignment.agent.socket.close(1012, 'job lease lost');
    })().catch((error) => console.error(`Gateway sweep 失败：${safeMessage(error)}`)); }, 15_000);
    const address = this.server.address(); const port = typeof address === 'object' && address ? address.port : this.config.port; const host = this.config.host.includes(':') ? `[${this.config.host}]` : this.config.host;
    return `http://${host}:${port}`;
  }
  async close() { if (this.sweep) clearInterval(this.sweep); for (const agent of [...this.agents.values()]) await this.failAgentAssignments(agent, 'Gateway 正在关闭'); for (const agent of this.agents.values()) agent.socket.close(1001, 'gateway shutdown'); this.ws.close(); await new Promise<void>((resolve) => this.server.close(() => resolve())); await this.coordination.close(); }
}

async function controlPost<T>(config: GatewayControlConfig, path: string, bodyValue: unknown, signal: AbortSignal, options: { credentials?: NodeCredentials; registrationKey?: string } = {}): Promise<T> {
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
  if (options.credentials) headers.set('authorization', `Bearer ${options.credentials.token}`);
  if (options.registrationKey) headers.set('x-threadbeacon-registration-key', options.registrationKey);
  const response = await fetch(`${config.controlUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(bodyValue), signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]) });
  const text = await response.text(); let value: unknown = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { error: text.slice(0, 300) }; }
  if (!response.ok) {
    const error = value && typeof value === 'object' && typeof (value as Record<string, unknown>)['error'] === 'string' ? (value as Record<string, unknown>)['error'] : `HTTP ${response.status}`;
    throw new Error(`Gateway 控制面请求失败（${response.status}）：${String(error).slice(0, 500)}`);
  }
  return value as T;
}

export async function startGatewayControlLink(gateway: AgentGateway, config: GatewayControlConfig, signal: AbortSignal): Promise<GatewayControlLink> {
  let credentials = config.nodeId && config.nodeToken ? { id: config.nodeId, token: config.nodeToken } : null;
  if (!credentials && config.stateFile) credentials = await loadWorkerStateFile(config.stateFile);
  if (!credentials) {
    if (!config.registrationKey) throw new Error('Gateway 首次注册需 THREADBEACON_NODE_REGISTRATION_KEY，或配置持久化节点凭据');
    const snapshot = gateway.snapshot();
    const registered = await controlPost<{ node?: { id?: unknown }; token?: unknown }>(config, '/api/nodes', {
      name: config.nodeName, platform: 'gateway', version: '0.8.0', capabilities: snapshot.capabilities,
      maxConcurrency: Math.max(1, Math.min(64, snapshot.maxConcurrency)),
      runtime: { transport: 'gateway-ws', endpoint: config.publicUrl, token: gateway.config.controlToken, protocolVersion: GATEWAY_PROTOCOL_VERSION },
    }, signal, { registrationKey: config.registrationKey });
    const id = registered.node?.id; const token = registered.token;
    if (typeof id !== 'string' || !id || typeof token !== 'string' || token.length < 16) throw new Error('Gateway 注册响应缺少有效节点凭据');
    credentials = { id, token };
    if (config.stateFile) await saveWorkerStateFile(config.stateFile, credentials);
  }
  gateway.setResultSink(async (result, job) => {
    const path = result.status === 'completed'
      ? `/api/worker/jobs/${encodeURIComponent(result.jobId)}/complete`
      : `/api/worker/jobs/${encodeURIComponent(result.jobId)}/fail`;
    await controlPost(config, path, result.status === 'completed'
      ? { nodeId: credentials!.id, attempt: job.attempt, report: result.report }
      : { nodeId: credentials!.id, attempt: job.attempt, error: result.error ?? 'Gateway Agent 执行失败' }, signal, { credentials: credentials! });
  });
  const sendHeartbeat = async () => {
    const snapshot = gateway.snapshot();
    await controlPost(config, '/api/worker/heartbeat', {
      nodeId: credentials!.id, activeJobs: snapshot.activeJobs, capabilities: snapshot.capabilities,
      maxConcurrency: Math.max(1, Math.min(64, snapshot.maxConcurrency)),
      health: { state: 'ready', connectedAgents: snapshot.connectedAgents, activeJobs: snapshot.activeJobs, protocolVersion: GATEWAY_PROTOCOL_VERSION },
      runtime: { transport: 'gateway-ws', endpoint: config.publicUrl, token: gateway.config.controlToken, protocolVersion: GATEWAY_PROTOCOL_VERSION },
    }, signal, { credentials: credentials! });
  };
  await sendHeartbeat();
  let pending = false; let debounce: ReturnType<typeof setTimeout> | null = null;
  const queueHeartbeat = () => {
    if (pending || signal.aborted) return; pending = true;
    debounce = setTimeout(() => { debounce = null; void sendHeartbeat().catch((error) => console.error(safeMessage(error))).finally(() => { pending = false; }); }, 50);
  };
  const unsubscribe = gateway.onSnapshotChange(queueHeartbeat);
  const interval = setInterval(() => { void sendHeartbeat().catch((error) => console.error(safeMessage(error))); }, config.heartbeatMs);
  const close = () => { clearInterval(interval); if (debounce) clearTimeout(debounce); unsubscribe(); };
  signal.addEventListener('abort', close, { once: true });
  return { credentials, heartbeatNow: sendHeartbeat, close };
}

export async function runGateway(env: NodeJS.ProcessEnv = process.env) {
  const config = gatewayConfigFromEnv(env); const gateway = new AgentGateway(config); const url = await gateway.listen(); console.log(`ThreadBeacon Agent Gateway 已监听 ${url}`);
  const controller = new AbortController();
  let link: GatewayControlLink | null = null;
  try { link = config.control ? await startGatewayControlLink(gateway, config.control, controller.signal) : null; }
  catch (error) { controller.abort(); await gateway.close(); throw error; }
  if (link) console.log(`Gateway 聚合节点 ${config.control!.nodeName} 已连接控制面`);
  const stop = () => { link?.close(); void gateway.close().finally(() => { controller.abort(); process.exit(0); }); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runGateway().catch((error) => { console.error(safeMessage(error)); process.exitCode = 1; });
