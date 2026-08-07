// 从 .env.local / .env 读取配置。
//
// 为什么需要这个模块：.env.example 让使用者「复制为 .env.local」，但此前没有
// 任何代码去读它 —— 文件建了也不生效，凭据只能靠 shell 里手工 export。
//
// 用 Node 22 内置的 process.loadEnvFile()，不引 dotenv 依赖：
// 凭据加载路径上的第三方依赖越少越好。
//
// 优先级：真实环境变量 > .env.local > .env。
// loadEnvFile() 不覆盖已存在的键，因此按此顺序依次加载即可得到该优先级
// （Node 22.15 实测：shell 里已 export 的值不会被文件里的同名键顶掉）。

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录。本文件位于 src/ 下，上跳一级。 */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 按优先级加载的候选文件，靠前者优先。 */
const CANDIDATES = ['.env.local', '.env'] as const;

/**
 * 加载 env 文件，返回实际加载到的文件名。
 *
 * 文件不存在时静默跳过 —— 全部走系统环境变量是完全合法的部署方式。
 * 解析失败则抛错而非静默忽略：一个语法坏掉的 .env.local 若被无声跳过，
 * 表现会是「凭据明明填了却报缺少凭据」，比直接报错难排查得多。
 */
export function loadEnvFiles(root: string = REPO_ROOT): string[] {
  const loaded: string[] = [];
  for (const name of CANDIDATES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    loaded.push(name);
  }
  return loaded;
}
