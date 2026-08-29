import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { resolve } from 'node:path';

const mode = process.argv[2] ?? 'start';
const isWindows = process.platform === 'win32';
const controlDirectory = resolve('apps/control-api');
const mavenWrapper = resolve(controlDirectory, isWindows ? 'mvnw.cmd' : 'mvnw');
const apiPort = Number(process.env.THREADBEACON_API_PORT ?? 8080);
const controlUrl = process.env.THREADBEACON_CONTROL_URL?.trim() || `http://127.0.0.1:${apiPort}`;

function databaseAddress() {
  const value = process.env.DATABASE_URL ?? 'jdbc:postgresql://127.0.0.1:5432/threadbeacon';
  const match = /^jdbc:postgresql:\/\/([^/:?#]+)(?::(\d+))?\//.exec(value);
  if (!match) throw new Error('DATABASE_URL 必须是 jdbc:postgresql://host:port/database');
  return { name: 'PostgreSQL', host: match[1], port: Number(match[2] ?? 5432) };
}

function objectStorageAddress() {
  const endpoint = new URL(process.env.THREADBEACON_S3_ENDPOINT ?? 'http://127.0.0.1:9000');
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('THREADBEACON_S3_ENDPOINT 必须使用 HTTP(S)');
  return { name: 'S3 / MinIO', host: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)) };
}

function portOpen(host, port, timeoutMs = 1500) {
  return new Promise(resolveProbe => {
    const socket = connect({ host, port });
    const finish = value => { socket.destroy(); resolveProbe(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function javaCheck() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8', windowsHide: true });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = /version "(?:1\.)?(\d+)/.exec(output);
  const version = Number(match?.[1] ?? 0);
  return { label: version ? `Java ${version}（需要 17+）` : 'Java 17+ 可执行文件', ok: result.status === 0 && version >= 17 };
}

async function doctor({ requireFreeAppPorts = false } = {}) {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ label: `Node.js ${process.versions.node}（需要 22+）`, ok: major >= 22 });
  checks.push(javaCheck());

  for (const service of [databaseAddress(), objectStorageAddress()]) {
    checks.push({ label: `${service.name} ${service.host}:${service.port}`, ok: await portOpen(service.host, service.port) });
  }

  if (requireFreeAppPorts) {
    checks.push({ label: `控制 API 端口 ${apiPort} 可用`, ok: !(await portOpen('127.0.0.1', apiPort)) });
    checks.push({ label: 'Web 端口 3000 可用', ok: !(await portOpen('127.0.0.1', 3000)) });
  }

  for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.label}`);

  const developmentDefaults = [
    ['THREADBEACON_NODE_REGISTRATION_KEY', 'change-node-key-16'],
    ['THREADBEACON_ENCRYPTION_KEY', 'change-this-encryption-key-32-bytes'],
    ['THREADBEACON_LOCAL_AUTH_PASSWORD', 'change-me-at-least-16'],
  ].filter(([name, fallback]) => (process.env[name] ?? fallback) === fallback).map(([name]) => name);
  if (developmentDefaults.length) console.warn(`! 仅限本机开发的默认密钥仍在使用：${developmentDefaults.join(', ')}`);

  const failed = checks.filter(check => !check.ok);
  if (failed.length) {
    console.error('\n原生启动条件未满足。请先启动本机 PostgreSQL 与 S3/MinIO；Docker 不是必需项。');
    return false;
  }
  console.log('\n原生启动条件已满足。');
  return true;
}

function startProcess(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: isWindows,
    windowsHide: true,
  });
  child.once('error', error => console.error(`[${name}] ${error.message}`));
  return { name, child };
}

async function waitForApi(child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`控制 API 提前退出（${child.exitCode}）`);
    try {
      const response = await fetch(`${controlUrl}/actuator/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Spring Boot and Flyway may still be starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error(`等待控制 API 超时：${controlUrl}`);
}

async function start() {
  if (!(await doctor({ requireFreeAppPorts: true }))) process.exit(1);
  const children = [];
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    for (const { child } of children) {
      if (child.exitCode !== null || child.pid === undefined) continue;
      if (isWindows) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(code), 1500).unref();
  };
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));

  const api = startProcess('api', mavenWrapper, ['-q', 'spring-boot:run'], { cwd: controlDirectory });
  children.push(api);
  console.log('\n正在启动控制 API…');
  try {
    await waitForApi(api.child);
  } catch (error) {
    stop(1);
    throw error;
  }

  const workerEnv = {
    ...process.env,
    THREADBEACON_CONTROL_URL: controlUrl,
    THREADBEACON_NODE_REGISTRATION_KEY: process.env.THREADBEACON_NODE_REGISTRATION_KEY ?? 'change-node-key-16',
  };
  children.push(startProcess('web', 'pnpm', ['--dir', 'apps/control-plane', 'dev']));
  children.push(startProcess('worker', 'pnpm', ['worker'], { env: workerEnv }));
  console.log(`\nThreadBeacon 已启动：Web http://127.0.0.1:3000 · API ${controlUrl}`);
  console.log('按 Ctrl+C 停止本次启动的 API、Web 和 Worker。');

  for (const entry of children) {
    entry.child.once('exit', code => {
      if (!stopping) {
        console.error(`[${entry.name}] 已退出（${code ?? 'signal'}）`);
        stop(code ?? 1);
      }
    });
  }
}

if (!['doctor', 'start'].includes(mode)) {
  console.error('用法：native-control.mjs doctor|start');
  process.exit(2);
}

try {
  if (mode === 'doctor') process.exitCode = (await doctor()) ? 0 : 1;
  else await start();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
