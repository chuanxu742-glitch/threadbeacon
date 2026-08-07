#!/usr/bin/env -S npx tsx
// 小红书扫码登录 —— 跑一次，把 cookie 存下来供后续采集复用。
//
//   pnpm xhs:login
//
// 需要先在 .env.local 里配好 SPIDER_XHS_PATH（本地 Spider_XHS 仓库路径）。
// 二维码打在终端里，用小红书 App 扫。
//
// 这个脚本刻意是交互式的、且独立于采集流程：登录态只该在人明确操作时产生，
// 不该在某次 analyze 里被静默触发。

import { spawn } from 'node:child_process';
import { loadEnvFiles } from '../src/env.js';

const BRIDGE = 'scripts/spider_xhs_bridge.py';

function main(): void {
  const files = loadEnvFiles();
  const env = process.env;

  const spiderPath = env['SPIDER_XHS_PATH'];
  if (!spiderPath) {
    console.error(
      '未设置 SPIDER_XHS_PATH。Spider_XHS 无 LICENSE 文件，其代码不随本项目分发，\n' +
        '需要你自行 clone 后指向它：\n\n' +
        '  git clone https://github.com/cv-cat/Spider_XHS\n' +
        '  # 然后在 .env.local 里写：\n' +
        '  SPIDER_XHS_PATH=/abs/path/to/Spider_XHS\n\n' +
        '注意该项目 README 声明「仅供学习交流使用，禁止任何商业化行为」。',
    );
    process.exit(2);
  }

  const cookieFile = env['SPIDER_XHS_COOKIE'] ?? '.spider-xhs-cookie.json';
  const python = env['PYTHON_BIN'] ?? 'python';

  console.log(`配置来源：${files.length ? files.join(' + ') : '仅系统环境变量'}`);
  console.log(`Spider_XHS：${spiderPath}`);
  console.log(`cookie 将写入：${cookieFile}\n`);

  // stdio 全继承：二维码要打到真实终端才能被扫
  const child = spawn(python, [BRIDGE, 'login', '--cookie-file', cookieFile], {
    stdio: 'inherit',
    env: { ...env, SPIDER_XHS_PATH: spiderPath },
  });

  child.on('error', (e) => {
    console.error(`启动 ${python} 失败：${e.message}\n若 python 不在 PATH，请设置 PYTHON_BIN。`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n登录成功。cookie 已保存，可以跑：pnpm cli analyze xiaohongshu "关键词" 50`);
      console.log('⚠️ cookie 是账号凭据，已被 .gitignore 排除，不要提交或外发。');
    }
    process.exit(code ?? 1);
  });
}

main();
