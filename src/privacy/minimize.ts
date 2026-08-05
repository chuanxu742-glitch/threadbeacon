// 数据最小化与 PII 脱敏。
//
// 依据 docs/GDPR架构边界.md §7.1 / §7.4。
//
// 两条不可协商的规则：
//   1. 用「替换为占位符」而不是 hash。hash 保留可逆映射关系，属于假名化，
//      而 EDPB Guidelines 01/2025 重申假名化数据始终是个人数据。
//   2. SourceItem 只能经 buildSourceItem() 产生，脱敏无法被绕过。

import type { Platform, SourceItem } from '../providers/types.js';

export const PLACEHOLDER = {
  email: '<EMAIL>',
  phone: '<PHONE>',
  url: '<URL>',
  handle: '<HANDLE>',
  idNumber: '<ID>',
  iban: '<IBAN>',
  ip: '<IP>',
} as const;

/**
 * 确定性的正则脱敏层。
 *
 * 这是二道防线中的第一道，覆盖有稳定结构的标识符。
 * 姓名、地名这类需要 NER 的实体由 PiiRecognizer 补齐（见下方接口），
 * 生产环境接 Microsoft Presidio 本地部署 —— 必须本地，不出网，避免二次传输。
 */
const RULES: ReadonlyArray<{ re: RegExp; with: string }> = [
  // 邮箱要排在 URL 与 handle 之前，否则会被它们切碎
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, with: PLACEHOLDER.email },
  // URL 常含 permalink 与用户名，整段替换
  { re: /https?:\/\/[^\s<>"']+/gi, with: PLACEHOLDER.url },
  { re: /\bwww\.[^\s<>"']+/gi, with: PLACEHOLDER.url },
  { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, with: PLACEHOLDER.iban },
  // 中国大陆身份证：18 位，末位可为 X
  { re: /\b\d{17}[\dXx]\b/g, with: PLACEHOLDER.idNumber },
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, with: PLACEHOLDER.ip },
  // 带国际区号的电话
  { re: /\+\d{1,3}[\s-]?\d[\d\s-]{6,14}\d/g, with: PLACEHOLDER.phone },
  // 裸号码：11 位中国手机号，或 7-15 位带分隔符的号码串。
  // 下限设在 7 位以避免误伤产品型号（iPhone 15、RTX 4090 之类）。
  { re: /\b1[3-9]\d{9}\b/g, with: PLACEHOLDER.phone },
  { re: /\b\d{3,4}[\s-]\d{3,4}[\s-]\d{4}\b/g, with: PLACEHOLDER.phone },
  // @handle：社媒里最常见的直接标识符
  { re: /(^|[\s(（])@[A-Za-z0-9_.一-龥-]{2,30}/g, with: `$1${PLACEHOLDER.handle}` },
];

/** 可插拔的命名实体识别层，用于姓名/地名等无固定结构的 PII。 */
export interface PiiRecognizer {
  /** 返回已把识别出的实体替换为占位符的文本。实现方不得返回可逆映射。 */
  redact(text: string): Promise<string>;
}

export function redactStructured(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.with);
  }
  return out;
}

/**
 * 把时间戳降采样到日。
 * 精确时间戳是准标识符 —— 结合平台与文本内容足以回溯到具体发帖。
 */
export function toTimeBucket(when: Date | string): string {
  const d = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`toTimeBucket: 无法解析的时间值 ${String(when)}`);
  }
  return d.toISOString().slice(0, 10);
}

/** 国家级地区，ISO 3166-1 alpha-2。更细粒度一律拒绝。 */
function normalizeRegion(region: string | undefined): string | undefined {
  if (region === undefined) return undefined;
  const r = region.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(r)) {
    throw new RangeError(
      `region 必须是 ISO 3166-1 alpha-2 国家代码，收到 "${region}"。更细粒度的地理信息是准标识符，不得保留。`,
    );
  }
  return r;
}

export interface RawObservation {
  readonly text: string;
  readonly observedAt: Date | string;
  readonly platform: Platform;
  readonly region?: string;
  readonly lang?: string;
}

/**
 * 构造 SourceItem 的唯一入口。
 *
 * 之所以不导出裸的对象字面量路径，是为了让「未脱敏文本进入持久层」
 * 在架构上不可能发生，而不是依赖 code review 去发现。
 */
export async function buildSourceItem(
  raw: RawObservation,
  recognizer?: PiiRecognizer,
): Promise<SourceItem> {
  let text = redactStructured(raw.text);
  if (recognizer) {
    text = await recognizer.redact(text);
  }
  return {
    text,
    timeBucket: toTimeBucket(raw.observedAt),
    platform: raw.platform,
    region: normalizeRegion(raw.region),
    lang: raw.lang,
  };
}

export async function buildSourceItems(
  raws: readonly RawObservation[],
  recognizer?: PiiRecognizer,
): Promise<SourceItem[]> {
  return Promise.all(raws.map((r) => buildSourceItem(r, recognizer)));
}
