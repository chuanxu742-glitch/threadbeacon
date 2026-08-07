#!/usr/bin/env python3
# encoding: utf-8
"""caiji <-> Spider_XHS 桥接层。

Spider_XHS (https://github.com/cv-cat/Spider_XHS) 仓库**没有 LICENSE 文件**，
按全版权保留处理：它的代码一行都不进本仓库，只在运行时 import。
使用者需自行 clone 到本地，并用 SPIDER_XHS_PATH 指向该目录。
其 README 声明「仅供学习交流使用，禁止任何商业化行为」——遵守它是使用者的责任。

本文件是 caiji 原创的调用层，只做三件事：命令分发、调用、把结果转成统一 JSON。

用法（stdout 只输出一行 JSON，日志一律走 stderr）：
    python spider_xhs_bridge.py login   --cookie-file <path>
    python spider_xhs_bridge.py search  --cookie-file <path> --keyword <kw> --limit <n>
    python spider_xhs_bridge.py comments --cookie-file <path> --url <note_url>

统一输出：{"ok": bool, "message": str, "data": any}
"""

import argparse
import json
import os
import sys
from pathlib import Path


def emit(ok: bool, message: str, data=None) -> int:
    """把结果写到 stdout。调用方按行读 JSON，因此这里必须是最后一次输出。"""
    json.dump({"ok": ok, "message": message, "data": data},
              sys.stdout, ensure_ascii=False, default=str)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if ok else 1


def log(msg: str) -> None:
    """日志走 stderr，避免污染 stdout 的 JSON。"""
    print(f"[bridge] {msg}", file=sys.stderr, flush=True)


def bootstrap_spider_path() -> None:
    """把 Spider_XHS 的目录加进 sys.path。

    不做 pip install：那个项目没有发布到 PyPI，也没有 license 允许再分发。
    """
    raw = os.environ.get("SPIDER_XHS_PATH")
    if not raw:
        raise RuntimeError(
            "未设置 SPIDER_XHS_PATH。请先 clone 并在 .env.local 里指向它：\n"
            "  git clone https://github.com/cv-cat/Spider_XHS\n"
            "  SPIDER_XHS_PATH=/abs/path/to/Spider_XHS"
        )
    path = Path(raw).expanduser().resolve()
    if not (path / "apis").is_dir():
        raise RuntimeError(f"SPIDER_XHS_PATH 下没有 apis/ 目录，不像 Spider_XHS 仓库：{path}")
    sys.path.insert(0, str(path))
    # 它的 JS 签名脚本按相对路径查找，工作目录必须切过去
    os.chdir(path)


def load_auth(cookie_file: Path):
    from xhs_utils.xhs_auth import XHSPcAuth

    if not cookie_file.is_file():
        raise RuntimeError(
            f"找不到 cookie 文件 {cookie_file}。请先跑一次登录：\n"
            f"  pnpm xhs:login"
        )
    cookies = json.loads(cookie_file.read_text(encoding="utf-8"))
    return XHSPcAuth.from_cookie(cookies)


def make_api(auth):
    from apis.xhs_pc_apis import XHS_Apis

    return XHS_Apis(auth).bootstrap()


def cmd_login(args) -> int:
    """扫码登录一次，把 cookie 存下来供后续复用。"""
    from xhs_utils.xhs_auth import XHSPcAuth

    log("请用小红书 App 扫描下方二维码")
    auth = XHSPcAuth.from_qrcode_login(show_in_terminal=True)

    cookies = auth.host_cookies_snapshot()
    out = Path(args.cookie_file)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")
    # cookie 是用户会话凭据，权限收到仅本人可读；Windows 上 chmod 无效果，忽略
    try:
        out.chmod(0o600)
    except OSError:
        pass

    return emit(True, f"登录成功，cookie 已写入 {out}", {"cookieFile": str(out)})


def cmd_search(args) -> int:
    api = make_api(load_auth(Path(args.cookie_file)))
    log(f"搜索 {args.keyword!r}，目标 {args.limit} 条")

    success, message, notes = api.search_some_note(args.keyword, args.limit)
    if not success:
        return emit(False, f"搜索失败：{message}", None)
    return emit(True, message or "ok", notes)


def cmd_comments(args) -> int:
    api = make_api(load_auth(Path(args.cookie_file)))
    log(f"取评论 {args.url}")

    success, message, comments = api.get_note_all_comment(args.url)
    if not success:
        # 关评论 / 已删除 / 限流都会走到这里，交给调用方决定要不要中断
        return emit(False, f"取评论失败：{message}", None)
    return emit(True, message or "ok", comments)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="caiji <-> Spider_XHS 桥接")
    sub = p.add_subparsers(dest="cmd", required=True)

    login = sub.add_parser("login", help="扫码登录并保存 cookie")
    login.add_argument("--cookie-file", required=True)
    login.set_defaults(func=cmd_login)

    search = sub.add_parser("search", help="按关键词搜索笔记")
    search.add_argument("--cookie-file", required=True)
    search.add_argument("--keyword", required=True)
    search.add_argument("--limit", type=int, default=20)
    search.set_defaults(func=cmd_search)

    comments = sub.add_parser("comments", help="取一篇笔记的全部评论")
    comments.add_argument("--cookie-file", required=True)
    comments.add_argument("--url", required=True)
    comments.set_defaults(func=cmd_comments)

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        bootstrap_spider_path()
        return args.func(args)
    except Exception as e:  # noqa: BLE001 - 边界层，任何异常都要转成 JSON 报给调用方
        return emit(False, f"{type(e).__name__}: {e}", None)


if __name__ == "__main__":
    sys.exit(main())
