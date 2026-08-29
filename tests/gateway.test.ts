import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { InMemoryGatewayCoordination } from '../src/gateway-coordination.js';
import { AgentGateway, gatewayConfigFromEnv, startGatewayControlLink } from '../src/gateway.js';
import { runGatewayAgent } from '../src/worker.js';

const agentToken = 'agent-token-0123456789';
const controlToken = 'control-token-01234567';

describe('Agent Gateway', () => {
  it('validates separate agent and control credentials', () => {
    expect(() => gatewayConfigFromEnv({ THREADBEACON_GATEWAY_AGENT_TOKEN: agentToken, THREADBEACON_GATEWAY_CONTROL_TOKEN: agentToken })).toThrow('必须不同');
    expect(gatewayConfigFromEnv({ THREADBEACON_GATEWAY_AGENT_TOKEN: agentToken, THREADBEACON_GATEWAY_CONTROL_TOKEN: controlToken })).toMatchObject({ port: 8789, dispatchTimeoutMs: 15_000 });
  });

  it('authenticates, registers capability, ACKs, returns results and deduplicates job IDs', async () => {
    const gateway = new AgentGateway({ host: '127.0.0.1', port: 0, agentToken, controlToken, gatewayId: 'test-gateway', dispatchTimeoutMs: 2_000 });
    const url = await gateway.listen(); let deliveries = 0;
    const agent = new WebSocket(`${url.replace('http:', 'ws:')}/agent`, { headers: { authorization: `Bearer ${agentToken}` } });
    await new Promise<void>((resolve, reject) => { agent.once('open', resolve); agent.once('error', reject); });
    agent.send(JSON.stringify({ type: 'register', protocolVersion: 1, agentId: 'agent-test', capabilities: ['rss'], maxConcurrency: 1 }));
    await new Promise<void>((resolve) => agent.once('message', () => resolve()));
    agent.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; job?: { id: string } };
      if (message.type !== 'job' || !message.job) return; deliveries += 1;
      agent.send(JSON.stringify({ type: 'ack', jobId: message.job.id }));
      agent.send(JSON.stringify({ type: 'result', jobId: message.job.id, report: { items: [], painPoints: [], generatedAt: '2026-08-28T00:00:00.000Z' } }));
    });
    const headers = { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' };
    try {
      expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ state: 'ready', protocolVersion: 1 });
      expect((await fetch(`${url}/health`)).status).toBe(401);
      const job = { id: 'job-12345678', platform: 'rss', keyword: 'test', source_options_json: '{}', limit: 10, include_comments: 0 };
      const first = await fetch(`${url}/dispatch`, { method: 'POST', headers, body: JSON.stringify({ job }) });
      expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ jobId: job.id, agentId: 'agent-test', report: { items: [] } });
      const second = await fetch(`${url}/dispatch`, { method: 'POST', headers, body: JSON.stringify({ job }) });
      expect(second.status).toBe(200); expect(deliveries).toBe(1);
    } finally { agent.close(); await gateway.close(); }
  });

  it('accepts the real reverse Worker and removes it after disconnect', async () => {
    const gateway = new AgentGateway({ host: '127.0.0.1', port: 0, agentToken, controlToken, gatewayId: 'worker-gateway', dispatchTimeoutMs: 2_000 });
    const callbacks: Array<{ attempt?: number; report?: unknown }> = []; const executions: number[] = [];
    gateway.setResultSink(async (result) => { callbacks.push({ attempt: result.attempt, report: result.report }); });
    const url = await gateway.listen(); const controller = new AbortController();
    const task = runGatewayAgent({ url: `${url.replace('http:', 'ws:')}/agent`, token: agentToken, agentId: 'real-worker', concurrency: 2 }, [], controller.signal, async (job) => {
      executions.push(job.attempt); return { items: [], painPoints: [], attempt: job.attempt };
    });
    const headers = { authorization: `Bearer ${controlToken}` }; let agents: unknown[] = [];
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const value = await (await fetch(`${url}/capabilities`, { headers })).json() as { agents: unknown[] }; agents = value.agents;
        if (agents.length) break; await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(agents).toEqual([expect.objectContaining({ id: 'real-worker', maxConcurrency: 2 })]);
      const base = { id: 'retry-job-12345', platform: 'rss', keyword: 'retry', source_options_json: '{}', limit: 10, include_comments: 0 };
      await gateway.dispatchAsync({ ...base, attempt: 1 });
      for (let attempt = 0; attempt < 30 && callbacks.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await gateway.dispatchAsync({ ...base, attempt: 2 });
      for (let attempt = 0; attempt < 30 && callbacks.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(executions).toEqual([1, 2]);
      expect(callbacks).toEqual([
        expect.objectContaining({ attempt: 1, report: expect.objectContaining({ attempt: 1 }) }),
        expect.objectContaining({ attempt: 2, report: expect.objectContaining({ attempt: 2 }) }),
      ]);
    } finally { controller.abort(); await task; await gateway.close(); }
  });

  it('registers one aggregate control-plane node, persists credentials and refreshes Agent capacity', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'threadbeacon-gateway-')); const stateFile = join(stateDir, 'state.json');
    const requests: Array<{ path: string; authorization?: string; body: Record<string, unknown> }> = [];
    const nodeToken = 'gateway-node-token-0123456789';
    const control = createServer((request, response) => { void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      requests.push({ path: request.url ?? '', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.url === '/api/nodes' ? JSON.stringify({ node: { id: 'gateway-node-id' }, token: nodeToken }) : '{"ok":true}');
    })(); });
    await new Promise<void>((resolve) => control.listen(0, '127.0.0.1', resolve));
    const address = control.address(); const controlUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const gateway = new AgentGateway({ host: '127.0.0.1', port: 0, agentToken, controlToken, gatewayId: 'aggregate-gateway', dispatchTimeoutMs: 2_000 });
    const gatewayUrl = await gateway.listen(); const controller = new AbortController();
    const link = await startGatewayControlLink(gateway, {
      controlUrl, publicUrl: 'https://gateway.example.com', nodeName: 'gateway-primary', registrationKey: 'register-secret', stateFile, heartbeatMs: 60_000,
    }, controller.signal);
    const agent = new WebSocket(`${gatewayUrl.replace('http:', 'ws:')}/agent`, { headers: { authorization: `Bearer ${agentToken}` } });
    let deliveries = 0;
    try {
      await new Promise<void>((resolve, reject) => { agent.once('open', resolve); agent.once('error', reject); });
      agent.send(JSON.stringify({ type: 'register', protocolVersion: 1, agentId: 'aggregate-agent', capabilities: ['rss', 'web'], maxConcurrency: 3 }));
      await new Promise<void>((resolve) => agent.once('message', () => resolve()));
      agent.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; job?: { id: string } };
        if (message.type !== 'job' || !message.job) return; deliveries += 1;
        agent.send(JSON.stringify({ type: 'ack', jobId: message.job.id }));
        setTimeout(() => agent.send(JSON.stringify({ type: 'result', jobId: message.job!.id, report: { items: [], painPoints: [], generatedAt: '2026-08-28T00:00:00.000Z' } })), 150);
      });
      await link.heartbeatNow();
      expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({ id: 'gateway-node-id', token: nodeToken });
      expect(requests[0]).toMatchObject({ path: '/api/nodes', body: { platform: 'gateway', capabilities: [], maxConcurrency: 1, runtime: { transport: 'gateway-ws', endpoint: 'https://gateway.example.com', token: controlToken } } });
      expect(requests.at(-1)).toMatchObject({
        path: '/api/worker/heartbeat', authorization: `Bearer ${nodeToken}`,
        body: { nodeId: 'gateway-node-id', capabilities: ['rss', 'web'], maxConcurrency: 3, health: { connectedAgents: 1 }, runtime: { transport: 'gateway-ws', token: controlToken } },
      });
      const headers = { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' };
      const asyncJob = { id: 'async-job-123456', platform: 'rss', keyword: 'long task', source_options_json: '{}', limit: 10, include_comments: 0, attempt: 2 };
      const accepted = await fetch(`${gatewayUrl}/dispatch`, { method: 'POST', headers, body: JSON.stringify({ mode: 'async', job: asyncJob }) });
      expect(accepted.status).toBe(202); expect(await accepted.json()).toMatchObject({ accepted: true, jobId: asyncJob.id, idempotent: false });
      const duplicate = await fetch(`${gatewayUrl}/dispatch`, { method: 'POST', headers, body: JSON.stringify({ mode: 'async', job: asyncJob }) });
      expect(duplicate.status).toBe(202); expect(await duplicate.json()).toMatchObject({ accepted: true, idempotent: true });
      for (let attempt = 0; attempt < 30 && !requests.some((item) => item.path.includes('/complete')); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(deliveries).toBe(1);
      expect(requests.find((item) => item.path === `/api/worker/jobs/${asyncJob.id}/complete`)).toMatchObject({
        authorization: `Bearer ${nodeToken}`, body: { nodeId: 'gateway-node-id', attempt: 2, report: { items: [] } },
      });
    } finally {
      controller.abort(); link.close(); agent.close(); await gateway.close();
      await new Promise<void>((resolve) => control.close(() => resolve()));
    }
  });
});

describe('gateway coordination', () => {
  it('leases exclusively and wakes result waiters', async () => {
    const coordination = new InMemoryGatewayCoordination();
    expect(await coordination.acquireLease('job-one', 'g1', 1000)).toBe(true);
    expect(await coordination.acquireLease('job-one', 'g2', 1000)).toBe(false);
    const waiting = coordination.waitForResult('job-one', 1000);
    await coordination.publishResult({ jobId: 'job-one', status: 'completed', report: { ok: true }, agentId: 'a1', completedAt: new Date().toISOString() }, 1000);
    expect(await waiting).toMatchObject({ status: 'completed', report: { ok: true } });
    await coordination.close();
  });
});
