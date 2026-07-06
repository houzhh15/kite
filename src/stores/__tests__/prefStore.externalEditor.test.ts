/**
 * prefStore.externalEditor.test.ts — T24 (F-26) prefStore externalEditor* 字段行为.
 *
 * 设计依据: docs/design/compiled.md §3.1.3 / 需求 AC-03-1, AC-06-1~4.
 *
 * 覆盖:
 *   - setExternalEditor 接受 8 档已知值 (AC-03-1).
 *   - setExternalEditor 非法字面量 console.warn + 忽略 (AC-06-3).
 *   - setExternalEditorCustomCmd 截断到 256 字符 (AC-06-4).
 *   - setExternalEditorCustomCmd 空字符串允许 (AC-06-1).
 *   - setExternalEditorCustomCmd 非字符串 console.warn + 忽略.
 *   - hydrate 缺字段保留 default ("system" / "") (AC-06-2).
 *   - hydrate 含非法 externalEditor 回退 'system' (AC-06-3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefStore } from '../prefStore';
import type { ExternalEditor as TauriExternalEditor } from '../prefStore';

const BASE_PREFS = {
  theme: 'system' as const,
  fontSize: 16,
  lineHeight: 1.6 as const,
  codeBlockTheme: 'github',
  fontSizeId: 'md' as const,
  lineHeightId: 'cozy' as const,
  codeFontSizeId: 'md' as const,
  language: 'zh-CN' as const,
  mermaidEnabled: false,
  katexEnabled: false,
  externalEditor: 'system' as const,
  externalEditorCustomCmd: '',
};

describe('prefStore externalEditor (T24 F-26)', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: { ...BASE_PREFS },
      hydrated: false,
      loaded: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('defaults', () => {
    it('default externalEditor is "system"', () => {
      expect(usePrefStore.getState().prefs.externalEditor).toBe('system');
    });

    it('default externalEditorCustomCmd is empty string', () => {
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd).toBe('');
    });
  });

  describe('setExternalEditor — 8 档预设', () => {
    const KNOWN: TauriExternalEditor[] = [
      'system',
      'code',
      'cursor',
      'subl',
      'mate',
      'notepad++',
      'typora',
      'custom',
    ];
    for (const v of KNOWN) {
      it(`accepts "${v}" (AC-03-1)`, () => {
        usePrefStore.getState().setExternalEditor(v);
        expect(usePrefStore.getState().prefs.externalEditor).toBe(v);
      });
    }
  });

  describe('setExternalEditor — 非法值', () => {
    it('unknown literal warns and keeps current value (AC-06-3)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setExternalEditor('notepad' as never);
      expect(usePrefStore.getState().prefs.externalEditor).toBe('system');
      expect(warn).toHaveBeenCalled();
    });

    it('empty string warns and keeps current value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setExternalEditor('' as never);
      expect(usePrefStore.getState().prefs.externalEditor).toBe('system');
      expect(warn).toHaveBeenCalled();
    });

    it('null warns and keeps current value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setExternalEditor(null as never);
      expect(usePrefStore.getState().prefs.externalEditor).toBe('system');
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('setExternalEditorCustomCmd — 长度截断 (AC-06-4)', () => {
    it('writes short string as-is', () => {
      usePrefStore.getState().setExternalEditorCustomCmd('cursor {{path}}');
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd).toBe(
        'cursor {{path}}',
      );
    });

    it('writes empty string (AC-06-1)', () => {
      usePrefStore.getState().setExternalEditorCustomCmd('cursor {{path}}');
      usePrefStore.getState().setExternalEditorCustomCmd('');
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd).toBe('');
    });

    it('truncates to 256 chars when user pastes 1000 chars (AC-06-4)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const long = 'x'.repeat(1000);
      usePrefStore.getState().setExternalEditorCustomCmd(long);
      const stored = usePrefStore.getState().prefs.externalEditorCustomCmd;
      expect(stored.length).toBe(256);
      expect(warn).toHaveBeenCalled();
    });

    it('truncates to exactly 256 when string is 257 chars', () => {
      const long = 'x'.repeat(257);
      usePrefStore.getState().setExternalEditorCustomCmd(long);
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd.length).toBe(256);
    });

    it('non-string warns and keeps current value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setExternalEditorCustomCmd(null as never);
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd).toBe('');
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('hydrate — 缺 / 非法字段兼容', () => {
    it('missing externalEditor keeps current value (AC-06-2)', () => {
      // 先设置一个非默认值
      usePrefStore.getState().setExternalEditor('code');
      // hydrate({}) → 缺字段保留
      usePrefStore.getState().hydrate({});
      expect(usePrefStore.getState().prefs.externalEditor).toBe('code');
    });

    it('valid externalEditor in patch applies', () => {
      usePrefStore.getState().hydrate({ externalEditor: 'cursor' });
      expect(usePrefStore.getState().prefs.externalEditor).toBe('cursor');
    });

    it('invalid externalEditor falls back to "system" (AC-06-3)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setExternalEditor('code');
      usePrefStore.getState().hydrate({ externalEditor: 'garbage' as TauriExternalEditor });
      expect(usePrefStore.getState().prefs.externalEditor).toBe('system');
      // hydrate 路径不 console.warn (静默兜底, 与 mermaid/katex hydrate 一致).
      expect(warn).not.toHaveBeenCalled();
    });

    it('custom cmd truncates to 256 during hydrate', () => {
      const long = 'x'.repeat(500);
      usePrefStore.getState().hydrate({ externalEditorCustomCmd: long });
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd.length).toBe(256);
    });

    it('non-string custom cmd keeps current value', () => {
      usePrefStore.getState().setExternalEditorCustomCmd('preset');
      usePrefStore.getState().hydrate({ externalEditorCustomCmd: 12345 as never });
      expect(usePrefStore.getState().prefs.externalEditorCustomCmd).toBe('preset');
    });
  });
});
