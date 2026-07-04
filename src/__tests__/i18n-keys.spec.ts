/**
 * i18n 键集合一致性 (T16-P2 step-5e).
 *
 * 校验 zh-CN 与 en-US 的 export.* / fullscreen.* 键集合完全一致;
 * 缺失键会令 vitest 失败.
 */
import { describe, expect, it } from 'vitest';

import { zhCN } from '../i18n/zh-CN';
import { enUS } from '../i18n/en-US';

function keysOf<T extends Record<string, unknown>>(
  obj: T,
  prefix = '',
): string[] {
  const out: string[] = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...keysOf(v as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('i18n keys parity (T16-P2)', () => {
  it('export.* 键集合一致', () => {
    const zh = keysOf(zhCN.export as Record<string, unknown>).sort();
    const en = keysOf(enUS.export as Record<string, unknown>).sort();
    expect(zh).toEqual(en);
  });

  it('fullscreen.* 键集合一致', () => {
    const zh = keysOf(zhCN.fullscreen as Record<string, unknown>).sort();
    const en = keysOf(enUS.fullscreen as Record<string, unknown>).sort();
    expect(zh).toEqual(en);
  });

  it('export.html 必含 zh-CN 与 en-US 文案', () => {
    expect(zhCN.export.html).toBeTruthy();
    expect(enUS.export.html).toBeTruthy();
    expect(zhCN.export.html).not.toBe(enUS.export.html);
  });

  it('fullscreen.enter / fullscreen.exit 必含', () => {
    expect(zhCN.fullscreen.enter).toBeTruthy();
    expect(zhCN.fullscreen.exit).toBeTruthy();
    expect(enUS.fullscreen.enter).toBeTruthy();
    expect(enUS.fullscreen.exit).toBeTruthy();
  });
});