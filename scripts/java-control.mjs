import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const directory = resolve('apps/control-api');
const command = process.platform === 'win32' ? resolve(directory, 'mvnw.cmd') : resolve(directory, 'mvnw');
const args = process.argv.slice(2);
const child = spawn(command, ['-q', ...(args.length ? args : ['test'])], {
  cwd: directory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
