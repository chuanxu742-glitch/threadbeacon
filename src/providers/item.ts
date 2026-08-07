// SourceItem 的构造入口。
//
// 只做两件事：把 observedAt 归一成 ISO 字符串、派生 timeBucket。
// 不做任何裁剪 —— provider 解析出什么字段就原样带下去。

import type { RawObservation, SourceItem } from './types.js';

/** 由发布时刻派生 YYYY-MM-DD，便于按日聚合。 */
export function toDateKey(when: Date | string): string {
  const d = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`toDateKey: 无法解析的时间值 ${String(when)}`);
  }
  return d.toISOString().slice(0, 10);
}

function toIso(when: Date | string): string {
  const d = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`buildSourceItem: 无法解析的时间值 ${String(when)}`);
  }
  return d.toISOString();
}

/** 可选字段只在有值时写入，避免产物里出现一堆 undefined。 */
function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export function buildSourceItem(raw: RawObservation): SourceItem {
  return {
    text: raw.text,
    postedAt: toIso(raw.observedAt),
    timeBucket: toDateKey(raw.observedAt),
    platform: raw.platform,
    itemType: raw.itemType ?? 'post',
    ...optional('id', raw.id),
    ...optional('parentId', raw.parentId),
    ...optional('author', raw.author),
    ...optional('authorId', raw.authorId),
    ...optional('url', raw.url),
    ...optional('title', raw.title),
    ...optional('metrics', raw.metrics),
    ...optional('region', raw.region),
    ...optional('lang', raw.lang),
    ...optional('raw', raw.raw),
  };
}

export function buildSourceItems(raws: readonly RawObservation[]): SourceItem[] {
  return raws.map(buildSourceItem);
}
