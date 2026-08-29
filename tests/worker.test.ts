import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { directAgentConfigFromEnv, gatewayWorkerConfigFromEnv, loadWorkerStateFile, saveWorkerStateFile, startDirectAgentServer, workerConfigFromEnv, workerEnvWithState } from '../src/worker.js';

describe('workerConfigFromEnv', () => {
  it('normalizes the control URL and applies bounded defaults', () => {
    const config = workerConfigFromEnv({
      THREADBEACON_CONTROL_URL: 'https://control.example.com/',
      THREADBEACON_NODE_NAME: 'worker-01',
      THREADBEACON_NODE_REGISTRATION_KEY: 'register-me',
    });
    expect(config).toMatchObject({
      controlUrl: 'https://control.example.com',
      nodeName: 'worker-01',
      registrationKey: 'register-me',
      concurrency: 1,
      pollMs: 3_000,
    });
  });

  it('requires an http(s) control URL', () => {
    expect(() => workerConfigFromEnv({})).toThrow('THREADBEACON_CONTROL_URL');
    expect(() => workerConfigFromEnv({ THREADBEACON_CONTROL_URL: 'file:///tmp/control' })).toThrow(
      'http 或 https',
    );
  });

  it('requires node id and token as a pair', () => {
    expect(() =>
      workerConfigFromEnv({ THREADBEACON_CONTROL_URL: 'http://localhost:3000', THREADBEACON_NODE_ID: 'n1' }),
    ).toThrow('必须同时配置');
  });

  it('rejects unsafe concurrency and polling values', () => {
    expect(() =>
      workerConfigFromEnv({
        THREADBEACON_CONTROL_URL: 'http://localhost:3000',
        THREADBEACON_WORKER_CONCURRENCY: '65',
      }),
    ).toThrow('THREADBEACON_WORKER_CONCURRENCY');
    expect(() =>
      workerConfigFromEnv({
        THREADBEACON_CONTROL_URL: 'http://localhost:3000',
        THREADBEACON_WORKER_POLL_MS: '0',
      }),
    ).toThrow('THREADBEACON_WORKER_POLL_MS');
  });
});

describe('direct HTTP agent', () => {
  it('requires an explicit strong bearer token', () => {
    expect(() => directAgentConfigFromEnv({ THREADBEACON_DIRECT_LISTEN: '127.0.0.1:8789' })).toThrow('THREADBEACON_DIRECT_TOKEN');
    expect(directAgentConfigFromEnv({ THREADBEACON_DIRECT_LISTEN: '127.0.0.1:8789', THREADBEACON_DIRECT_TOKEN: '0123456789abcdef' }))
      .toMatchObject({ host: '127.0.0.1', port: 8789, concurrency: 1 });
    expect(directAgentConfigFromEnv({ THREADBEACON_DIRECT_LISTEN: '0.0.0.0:8789', THREADBEACON_DIRECT_TOKEN: '0123456789abcdef', THREADBEACON_DIRECT_PUBLIC_URL: 'https://agent.example.com/' }))
      .toMatchObject({ publicUrl: 'https://agent.example.com' });
    expect(() => directAgentConfigFromEnv({ THREADBEACON_DIRECT_LISTEN: '0.0.0.0:8789', THREADBEACON_DIRECT_TOKEN: '0123456789abcdef', THREADBEACON_DIRECT_PUBLIC_URL: 'http://agent.example.com' }))
      .toThrow('公开 HTTPS');
  });

  it('protects health, capabilities and execute with Bearer auth', async () => {
    const token = '0123456789abcdef';
    const agent = await startDirectAgentServer({ host: '127.0.0.1', port: 0, token, concurrency: 1 }, []);
    try {
      expect((await fetch(`${agent.url}/health`)).status).toBe(401);
      const health = await fetch(`${agent.url}/health`, { headers: { authorization: `Bearer ${token}` } });
      expect(await health.json()).toMatchObject({ state: 'ready', transport: 'direct-http' });
      const capabilities = await fetch(`${agent.url}/capabilities`, { headers: { authorization: `Bearer ${token}` } });
      expect(await capabilities.json()).toMatchObject({ protocolVersion: 1, capabilities: expect.arrayContaining(['rss', 'rest', 'web']) });
      const invalid = await fetch(`${agent.url}/execute`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      expect(invalid.status).toBe(400);
    } finally { await agent.close(); }
  });
});

describe('reverse Gateway agent config', () => {
  it('requires WSS off loopback and validates credentials', () => {
    expect(gatewayWorkerConfigFromEnv({ THREADBEACON_GATEWAY_WS_URL: 'wss://gateway.example.com/agent', THREADBEACON_GATEWAY_TOKEN: '0123456789abcdef', THREADBEACON_GATEWAY_AGENT_ID: 'agent-01' }))
      .toMatchObject({ url: 'wss://gateway.example.com/agent', agentId: 'agent-01', concurrency: 1 });
    expect(() => gatewayWorkerConfigFromEnv({ THREADBEACON_GATEWAY_WS_URL: 'ws://gateway.example.com/agent', THREADBEACON_GATEWAY_TOKEN: '0123456789abcdef' })).toThrow('wss://');
    expect(gatewayWorkerConfigFromEnv({ THREADBEACON_GATEWAY_WS_URL: 'ws://gateway:8789/agent', THREADBEACON_GATEWAY_TOKEN: '0123456789abcdef', THREADBEACON_GATEWAY_AGENT_ID: 'cluster-agent', THREADBEACON_GATEWAY_ALLOW_INSECURE_WS: '1' }))
      .toMatchObject({ url: 'ws://gateway:8789/agent' });
    expect(gatewayWorkerConfigFromEnv({ THREADBEACON_GATEWAY_WS_URL: 'ws://127.0.0.1:8789/agent', THREADBEACON_GATEWAY_TOKEN: '0123456789abcdef', THREADBEACON_GATEWAY_AGENT_ID: 'local-agent' }))
      .toMatchObject({ url: 'ws://127.0.0.1:8789/agent' });
  });
});

describe('worker credential state', () => {
  it('atomically persists credentials and lets explicit env win', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'threadbeacon-worker-')); const path = join(directory, 'state', 'worker.json');
    await saveWorkerStateFile(path, { id: 'node-one', token: '0123456789abcdef' });
    expect(await loadWorkerStateFile(path)).toEqual({ id: 'node-one', token: '0123456789abcdef' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ id: 'node-one', token: '0123456789abcdef' });
    expect(await workerEnvWithState({ THREADBEACON_WORKER_STATE_FILE: path })).toMatchObject({ THREADBEACON_NODE_ID: 'node-one', THREADBEACON_NODE_TOKEN: '0123456789abcdef' });
    expect(await workerEnvWithState({ THREADBEACON_WORKER_STATE_FILE: path, THREADBEACON_NODE_ID: 'explicit' })).not.toHaveProperty('THREADBEACON_NODE_TOKEN');
  });
});
