import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER,
  buildSourceItem,
  redactStructured,
  toTimeBucket,
} from '../src/privacy/minimize.js';

describe('redactStructured', () => {
  it('替换邮箱、URL、@handle 与电话，且用占位符而非 hash', () => {
    const out = redactStructured(
      '联系 zhang.san+work@example.com 或看 https://x.com/somebody/status/123，也可以找 @some_user，电话 13800138000',
    );
    expect(out).toContain(PLACEHOLDER.email);
    expect(out).toContain(PLACEHOLDER.url);
    expect(out).toContain(PLACEHOLDER.handle);
    expect(out).toContain(PLACEHOLDER.phone);
    // 原始标识符不得以任何形式残留
    expect(out).not.toContain('zhang.san');
    expect(out).not.toContain('somebody');
    expect(out).not.toContain('13800138000');
  });

  it('替换身份证号与 IP', () => {
    const out = redactStructured('证件 11010119900307461X，来源 IP 192.168.31.7');
    expect(out).toContain(PLACEHOLDER.idNumber);
    expect(out).toContain(PLACEHOLDER.ip);
    expect(out).not.toContain('11010119900307461X');
  });

  it('不误伤产品型号等短数字串', () => {
    const out = redactStructured('iPhone 15 Pro 和 RTX 4090 都很贵');
    expect(out).toBe('iPhone 15 Pro 和 RTX 4090 都很贵');
  });

  it('脱敏是幂等的', () => {
    const once = redactStructured('mail me at a@b.com');
    expect(redactStructured(once)).toBe(once);
  });
});

describe('toTimeBucket', () => {
  it('把精确时间戳降采样到日', () => {
    expect(toTimeBucket('2026-08-05T13:47:22.531Z')).toBe('2026-08-05');
  });

  it('拒绝无法解析的时间值', () => {
    expect(() => toTimeBucket('not-a-date')).toThrow(TypeError);
  });
});

describe('buildSourceItem', () => {
  it('是唯一入口，构造时强制脱敏', async () => {
    const item = await buildSourceItem({
      text: '这个 App 老崩溃，找客服 support@vendor.com 也没用',
      observedAt: '2026-08-05T13:47:22Z',
      platform: 'reddit',
    });
    expect(item.text).toContain(PLACEHOLDER.email);
    expect(item.text).not.toContain('support@vendor.com');
    expect(item.timeBucket).toBe('2026-08-05');
  });

  it('产出的 SourceItem 结构上不含任何标识符字段', async () => {
    const item = await buildSourceItem({
      text: '续航太差',
      observedAt: new Date('2026-08-05T00:00:00Z'),
      platform: 'bluesky',
    });
    // 这些字段不存在于类型中，运行时也不应被夹带进来
    for (const forbidden of ['authorId', 'handle', 'permalink', 'avatarUrl', 'userId']) {
      expect(Object.hasOwn(item, forbidden)).toBe(false);
    }
  });

  it('拒绝比国家更细的地理粒度', async () => {
    await expect(
      buildSourceItem({
        text: 'x',
        observedAt: '2026-08-05T00:00:00Z',
        platform: 'reddit',
        region: '浙江省杭州市',
      }),
    ).rejects.toThrow(RangeError);
  });

  it('接受并规范化 ISO 国家代码', async () => {
    const item = await buildSourceItem({
      text: 'x',
      observedAt: '2026-08-05T00:00:00Z',
      platform: 'reddit',
      region: 'de',
    });
    expect(item.region).toBe('DE');
  });

  it('自定义 recognizer 可叠加在正则层之上', async () => {
    const item = await buildSourceItem(
      {
        text: '张伟说这个不好用',
        observedAt: '2026-08-05T00:00:00Z',
        platform: 'douyin',
      },
      { redact: async (t) => t.replace('张伟', '<PERSON>') },
    );
    expect(item.text).toBe('<PERSON>说这个不好用');
  });
});
