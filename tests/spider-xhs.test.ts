import { describe, expect, it } from 'vitest';
import { SpiderXhsError, SpiderXhsProvider } from '../src/providers/xiaohongshu/spider-xhs.js';

/** 记录调用参数的假桥接。按子命令路由。 */
function fakeBridge(replies: Record<string, unknown>) {
  const calls: string[][] = [];
  const runner = async (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    const cmd = args[0] ?? '';
    const reply = replies[cmd];
    if (reply === undefined) throw new Error(`未预置子命令：${cmd}`);
    if (typeof reply === 'function') return (reply as () => string)();
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  };
  return { runner, calls };
}

const ok = (data: unknown) => ({ ok: true, message: 'ok', data });

function provider(replies: Record<string, unknown>) {
  const { runner, calls } = fakeBridge(replies);
  const p = new SpiderXhsProvider({
    spiderPath: '/fake/Spider_XHS',
    cookieFile: '/fake/cookie.json',
    runner,
  });
  return { p, calls };
}

const noteCard = {
  id: 'note123',
  xsec_token: 'TOKEN_ABC',
  note_card: {
    display_title: '这款粉底液真的踩雷了',
    desc: '用了一周就闷痘',
    type: 'normal',
    time: 1785000000,
    user: { nickname: '小美', user_id: 'user789' },
    interact_info: { liked_count: '128', comment_count: '45', share_count: '6' },
  },
};

describe('SpiderXhsProvider 取数', () => {
  it('解析笔记正文、作者、链接与互动量', async () => {
    const { p } = provider({ search: ok([noteCard]) });

    const bundle = await p.searchAll({ keyword: '粉底液', limit: 10 });
    const it = bundle.items[0]!;

    expect(it.text).toBe('这款粉底液真的踩雷了\n\n用了一周就闷痘');
    expect(it.title).toBe('这款粉底液真的踩雷了');
    expect(it.id).toBe('note123');
    expect(it.author).toBe('小美');
    expect(it.authorId).toBe('user789');
    expect(it.itemType).toBe('post');
    // 计数字段是字符串，要能转成数字
    expect(it.metrics).toEqual({ likes: 128, comments: 45, shares: 6 });
  });

  it('链接带上 xsec_token —— 没有它拿不到详情与评论', async () => {
    const { p } = provider({ search: ok([noteCard]) });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });
    expect(bundle.items[0]!.url).toContain('https://www.xiaohongshu.com/explore/note123');
    expect(bundle.items[0]!.url).toContain('xsec_token=TOKEN_ABC');
    expect(bundle.items[0]!.raw?.['xsecToken']).toBe('TOKEN_ABC');
  });

  it('把 keyword 与 limit 透传给桥接脚本', async () => {
    const { p, calls } = provider({ search: ok([]) });
    await p.searchAll({ keyword: '口红 测评', limit: 37 });

    expect(calls[0]).toEqual([
      'search',
      '--cookie-file', '/fake/cookie.json',
      '--keyword', '口红 测评',
      '--limit', '37',
    ]);
  });

  it('provenance 如实记录 user-authorized / user-session', async () => {
    const { p } = provider({ search: ok([]) });
    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });

    // 用的是运行者自有账号的登录态，不能标成 anonymous 或 app-credential
    expect(bundle.provenance.kind).toBe('user-authorized');
    expect(bundle.provenance.auth).toBe('user-session');
    expect(bundle.provenance.platform).toBe('xiaohongshu');
    // legalBasis 必须说明这不是官方授权通道
    expect(bundle.provenance.legalBasis).toMatch(/非平台官方授权/);
  });

  it('时间戳缺失时回退到采集时刻并标记', async () => {
    const bare = { id: 'n1', note_card: { display_title: '标题够长可以入选了', user: {} } };
    const { p } = provider({ search: ok([bare]) });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });
    expect(bundle.items[0]!.raw?.['timeMissing']).toBe(true);
  });

  it('毫秒级时间戳也能解析', async () => {
    const ms = { id: 'n1', note_card: { display_title: '标题够长可以入选了', time: 1785000000000, user: {} } };
    const { p } = provider({ search: ok([ms]) });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });
    expect(bundle.items[0]!.postedAt).toBe('2026-07-25T17:20:00.000Z');
  });

  it('跳过没有正文的条目', async () => {
    const { p } = provider({ search: ok([{ id: 'n1', note_card: { user: {} } }, noteCard]) });
    const bundle = await p.searchAll({ keyword: 'x', limit: 10 });
    expect(bundle.items).toHaveLength(1);
  });
});

describe('SpiderXhsProvider 评论', () => {
  const comments = ok([
    {
      id: 'c1',
      content: '我也踩雷了，太干了',
      create_time: 1785003600,
      like_count: 9,
      sub_comment_count: 2,
      user_info: { nickname: '路人甲', user_id: 'u2' },
      ip_location: '浙江',
    },
  ]);

  it('抓评论并用 parentId 关联回笔记', async () => {
    const { p } = provider({ search: ok([noteCard]), comments });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1, includeComments: true });
    expect(bundle.items).toHaveLength(2);

    const c = bundle.items[1]!;
    expect(c.itemType).toBe('comment');
    expect(c.parentId).toBe('note123');
    expect(c.text).toBe('我也踩雷了，太干了');
    expect(c.author).toBe('路人甲');
    expect(c.metrics).toEqual({ likes: 9, comments: 2 });
    expect(c.raw?.['ipLocation']).toBe('浙江');
  });

  it('评论请求带上含 xsec_token 的完整链接', async () => {
    const { p, calls } = provider({ search: ok([noteCard]), comments });
    await p.searchAll({ keyword: 'x', limit: 1, includeComments: true });

    const commentCall = calls.find((c) => c[0] === 'comments')!;
    expect(commentCall[commentCall.indexOf('--url') + 1]).toContain('xsec_token=TOKEN_ABC');
  });

  it('取评论失败时跳过而不中断整批', async () => {
    const { p } = provider({
      search: ok([noteCard]),
      comments: { ok: false, message: '该笔记已关闭评论', data: null },
    });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1, includeComments: true });
    expect(bundle.items).toHaveLength(1);
  });

  it('不请求评论时不调 comments 子命令', async () => {
    const { p, calls } = provider({ search: ok([noteCard]) });
    await p.searchAll({ keyword: 'x', limit: 1 });
    expect(calls.some((c) => c[0] === 'comments')).toBe(false);
  });
});

describe('SpiderXhsProvider 错误处理', () => {
  it('桥接报 ok:false 时抛出可读错误', async () => {
    const { p } = provider({
      search: { ok: false, message: '找不到 cookie 文件，请先跑 pnpm xhs:login', data: null },
    });
    await expect(p.searchAll({ keyword: 'x', limit: 1 })).rejects.toThrow(SpiderXhsError);
    await expect(p.searchAll({ keyword: 'x', limit: 1 })).rejects.toThrow(/xhs:login/);
  });

  it('输出不是 JSON 时报错并带上原文片段', async () => {
    const { p } = provider({ search: 'Traceback (most recent call last): ...' });
    await expect(p.searchAll({ keyword: 'x', limit: 1 })).rejects.toThrow(/不是 JSON/);
  });

  it('忽略 JSON 之前的杂音输出，只取最后一行', async () => {
    // 第三方库常往 stdout 打日志，桥接约定 JSON 在最后一行
    const noisy = `loading js engine...\nwarning: xxx\n${JSON.stringify(ok([noteCard]))}`;
    const { p } = provider({ search: noisy });

    const bundle = await p.searchAll({ keyword: 'x', limit: 1 });
    expect(bundle.items).toHaveLength(1);
  });

  it('checkAvailability 在桥接失败时返回 false 而不是抛错', async () => {
    const { p } = provider({ search: { ok: false, message: '未登录', data: null } });
    expect(await p.checkAvailability()).toBe(false);
  });
});
