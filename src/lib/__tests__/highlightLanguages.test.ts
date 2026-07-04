/**
 * T13 highlightLanguages.test.ts — T13 step-16c (FR-04)
 *
 * 覆盖:
 *   - COMMON_LANG_KEYS 长度 = 14 (T08 step-0a 已落地)
 *   - 关键键 (ts / tsx / rust / yaml / sql) 存在
 *   - 类型 CommonLangKey 由 typeof 派生, 元素都属于 COMMON_LANG_KEYS
 */
import { describe, expect, it } from 'vitest';

import {
  COMMON_LANG_KEYS,
  type CommonLangKey,
} from '../highlightLanguages';

describe('highlightLanguages — T13 step-05a / FR-04', () => {
  it('COMMON_LANG_KEYS.length === 14', () => {
    expect(COMMON_LANG_KEYS).toHaveLength(14);
  });

  it('包含 ts / tsx / js / jsx / rust / yaml / sql', () => {
    expect(new Set(COMMON_LANG_KEYS)).toEqual(
      new Set([
        'ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'md',
        'bash', 'rust', 'python', 'go', 'yaml', 'sql',
      ]),
    );
  });

  it('每项是字符串字面量 (type CommonLangKey)', () => {
    for (const k of COMMON_LANG_KEYS) {
      const v: CommonLangKey = k;
      expect(typeof v).toBe('string');
    }
  });
});
