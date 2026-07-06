/**
 * prefStore.test.ts — T04 store 形状扩展回归测试 (设计 §3.3.2).
 *
 * 覆盖:
 *   - T03 setTheme 行为不回退 (TypeError / console.warn).
 *   - T04 setFontSize: clamp + NaN fallback.
 *   - T04 setLineHeight: 三档离散校验.
 *   - T04 hydrate: 部分字段 + 空对象 + 越界值.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefStore } from '../prefStore';

describe('prefStore (T04 扩展)', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: {
        theme: 'system',
        fontSize: 16,
        lineHeight: 1.6,
        codeBlockTheme: 'github',
        fontSizeId: 'md',
        lineHeightId: 'cozy',
        codeFontSizeId: 'md',
        language: 'zh-CN',
        mermaidEnabled: false,
        katexEnabled: false,
        externalEditor: 'system',
        externalEditorCustomCmd: '',
      },
      hydrated: false,
      loaded: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('T03 回归: setTheme 行为不变', () => {
    it('accepts valid theme strings', () => {
      usePrefStore.getState().setTheme('dark');
      expect(usePrefStore.getState().prefs.theme).toBe('dark');
      usePrefStore.getState().setTheme('light');
      expect(usePrefStore.getState().prefs.theme).toBe('light');
      usePrefStore.getState().setTheme('system');
      expect(usePrefStore.getState().prefs.theme).toBe('system');
    });

    it('throws TypeError on null / non-string (T03 行为)', () => {
      const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => usePrefStore.getState().setTheme(null as never)).toThrow(TypeError);
      expect(warn).toHaveBeenCalled();
    });

    it('warns and ignores invalid literals', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setTheme('sepia' as never);
      expect(usePrefStore.getState().prefs.theme).toBe('system'); // 保持原值
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('T04: setFontSize', () => {
    it('writes value within [12, 24]', () => {
      usePrefStore.getState().setFontSize(20);
      expect(usePrefStore.getState().prefs.fontSize).toBe(20);
      usePrefStore.getState().setFontSize(12);
      expect(usePrefStore.getState().prefs.fontSize).toBe(12);
      usePrefStore.getState().setFontSize(24);
      expect(usePrefStore.getState().prefs.fontSize).toBe(24);
    });

    it('clamps below 12 to 12 (AC-FR02-2)', () => {
      usePrefStore.getState().setFontSize(11);
      expect(usePrefStore.getState().prefs.fontSize).toBe(12);
      usePrefStore.getState().setFontSize(0);
      expect(usePrefStore.getState().prefs.fontSize).toBe(12);
      usePrefStore.getState().setFontSize(-5);
      expect(usePrefStore.getState().prefs.fontSize).toBe(12);
    });

    it('clamps above 24 to 24', () => {
      usePrefStore.getState().setFontSize(25);
      expect(usePrefStore.getState().prefs.fontSize).toBe(24);
      usePrefStore.getState().setFontSize(200);
      expect(usePrefStore.getState().prefs.fontSize).toBe(24);
    });

    it('rounds non-integer values', () => {
      usePrefStore.getState().setFontSize(17.6);
      expect(usePrefStore.getState().prefs.fontSize).toBe(18);
      usePrefStore.getState().setFontSize(17.4);
      expect(usePrefStore.getState().prefs.fontSize).toBe(17);
    });

    it('falls back to 16 on NaN with warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setFontSize(NaN);
      expect(usePrefStore.getState().prefs.fontSize).toBe(16);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('T04: setLineHeight', () => {
    it('accepts the three allowed values (AC-FR03-1)', () => {
      usePrefStore.getState().setLineHeight(1.4);
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.4);
      usePrefStore.getState().setLineHeight(1.6);
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.6);
      usePrefStore.getState().setLineHeight(1.8);
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.8);
    });

    it('warns and ignores invalid values (AC-FR03-2)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setLineHeight(2.5 as never);
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.6); // 保持原值
      expect(warn).toHaveBeenCalled();

      usePrefStore.getState().setLineHeight(NaN as never);
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.6);
    });
  });

  describe('T04: hydrate', () => {
    it('sets hydrated=true and merges partial prefs (AC-FR01-1)', () => {
      usePrefStore.getState().hydrate({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
      const s = usePrefStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.prefs.theme).toBe('dark');
      expect(s.prefs.fontSize).toBe(20);
      expect(s.prefs.lineHeight).toBe(1.8);
    });

    it('handles empty object: keeps defaults (AC-FR01-2)', () => {
      usePrefStore.getState().hydrate({});
      const s = usePrefStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.prefs.theme).toBe('system');
      expect(s.prefs.fontSize).toBe(16);
      expect(s.prefs.lineHeight).toBe(1.6);
    });

    it('clamps out-of-range values during hydrate', () => {
      usePrefStore.getState().hydrate({ fontSize: 200, lineHeight: 2.5 as never });
      const s = usePrefStore.getState();
      expect(s.prefs.fontSize).toBe(24); // clamped
      expect(s.prefs.lineHeight).toBe(1.6); // invalid → defaults
      expect(s.hydrated).toBe(true);
    });

    it('ignores invalid theme', () => {
      usePrefStore.getState().hydrate({ theme: 'sepia' as never });
      expect(usePrefStore.getState().prefs.theme).toBe('system');
    });

    it('does not call undefined', () => {
      usePrefStore.getState().hydrate();
      expect(usePrefStore.getState().hydrated).toBe(true);
    });
  });

  describe('T11: cycleTheme', () => {
    it('light → dark', () => {
      usePrefStore.getState().setTheme('light');
      usePrefStore.getState();
      // dynamic import cycleTheme (avoid module cycle).
      return import('../prefStore').then((m) => {
        m.cycleTheme();
        expect(usePrefStore.getState().prefs.theme).toBe('dark');
      });
    });

    it('dark → system', async () => {
      usePrefStore.getState().setTheme('dark');
      const m = await import('../prefStore');
      m.cycleTheme();
      expect(usePrefStore.getState().prefs.theme).toBe('system');
    });

    it('system → light', async () => {
      usePrefStore.getState().setTheme('system');
      const m = await import('../prefStore');
      m.cycleTheme();
      expect(usePrefStore.getState().prefs.theme).toBe('light');
    });

    it('三次循环回到 light', async () => {
      usePrefStore.getState().setTheme('light');
      const m = await import('../prefStore');
      m.cycleTheme();
      m.cycleTheme();
      m.cycleTheme();
      expect(usePrefStore.getState().prefs.theme).toBe('light');
    });
  });

  describe('legacy: codeBlockTheme preserved', () => {
    it('default is github', () => {
      expect(usePrefStore.getState().prefs.codeBlockTheme).toBe('github');
    });

    it('hydrate accepts codeBlockTheme string', () => {
      usePrefStore.getState().hydrate({ codeBlockTheme: 'monokai' });
      expect(usePrefStore.getState().prefs.codeBlockTheme).toBe('monokai');
    });
  });

  describe('T12: 离散档位 actions', () => {
    it('default fontSizeId is md / lineHeightId is cozy / codeFontSizeId is md', () => {
      usePrefStore.setState({
        prefs: {
          theme: 'system',
          fontSize: 16,
          lineHeight: 1.6,
          codeBlockTheme: 'github',
          fontSizeId: 'md',
          lineHeightId: 'cozy',
          codeFontSizeId: 'md',
        language: 'zh-CN',
        mermaidEnabled: false,
        katexEnabled: false,
        externalEditor: 'system',
        externalEditorCustomCmd: '',
        },
        hydrated: true,
        loaded: true,
      });
      const s = usePrefStore.getState();
      expect(s.prefs.fontSizeId).toBe('md');
      expect(s.prefs.lineHeightId).toBe('cozy');
      expect(s.prefs.codeFontSizeId).toBe('md');
    });

    it('setFontSizeId("xl") writes fontSize=20 and fontSizeId="xl"', () => {
      usePrefStore.getState().setFontSizeId('xl');
      const s = usePrefStore.getState();
      expect(s.prefs.fontSizeId).toBe('xl');
      expect(s.prefs.fontSize).toBe(20);
    });

    it('setFontSizeId with invalid id warns and ignores', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setFontSizeId('xxl' as never);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('md');
      expect(warn).toHaveBeenCalled();
    });

    it('setLineHeightId("comfortable") writes lineHeight=1.8 and lineHeightId="comfortable"', () => {
      usePrefStore.getState().setLineHeightId('comfortable');
      const s = usePrefStore.getState();
      expect(s.prefs.lineHeightId).toBe('comfortable');
      expect(s.prefs.lineHeight).toBe(1.8);
    });

    it('setLineHeightId with invalid id warns and ignores', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      usePrefStore.getState().setLineHeightId('wide' as never);
      expect(usePrefStore.getState().prefs.lineHeightId).toBe('cozy');
      expect(warn).toHaveBeenCalled();
    });

    it('setCodeFontSize("lg") updates codeFontSizeId', () => {
      usePrefStore.getState().setCodeFontSize('lg');
      expect(usePrefStore.getState().prefs.codeFontSizeId).toBe('lg');
    });

    it('cycleFontSize(+1) from md → lg', () => {
      usePrefStore.getState().cycleFontSize(1);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('lg');
      expect(usePrefStore.getState().prefs.fontSize).toBe(18);
    });

    it('cycleFontSize(-1) from md → sm', () => {
      usePrefStore.getState().cycleFontSize(-1);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('sm');
      expect(usePrefStore.getState().prefs.fontSize).toBe(14);
    });

    it('cycleFontSize(0) resets to md (16)', () => {
      usePrefStore.getState().setFontSizeId('2xl');
      usePrefStore.getState().cycleFontSize(0);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('md');
      expect(usePrefStore.getState().prefs.fontSize).toBe(16);
    });

    it('cycleFontSize(+1) at 2xl stays 2xl', () => {
      usePrefStore.getState().setFontSizeId('2xl');
      usePrefStore.getState().cycleFontSize(1);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('2xl');
    });

    it('cycleLineHeight(+1) from cozy → comfortable', () => {
      usePrefStore.getState().cycleLineHeight(1);
      expect(usePrefStore.getState().prefs.lineHeightId).toBe('comfortable');
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.8);
    });

    it('cycleLineHeight(0) resets to cozy (1.6)', () => {
      usePrefStore.getState().setLineHeightId('comfortable');
      usePrefStore.getState().cycleLineHeight(0);
      expect(usePrefStore.getState().prefs.lineHeightId).toBe('cozy');
      expect(usePrefStore.getState().prefs.lineHeight).toBe(1.6);
    });

    it('resetReadingPrefs restores defaults', () => {
      usePrefStore.getState().setFontSizeId('2xl');
      usePrefStore.getState().setLineHeightId('comfortable');
      usePrefStore.getState().setCodeFontSize('xs');
      usePrefStore.getState().resetReadingPrefs();
      const s = usePrefStore.getState();
      expect(s.prefs.fontSizeId).toBe('md');
      expect(s.prefs.lineHeightId).toBe('cozy');
      expect(s.prefs.codeFontSizeId).toBe('md');
      expect(s.prefs.fontSize).toBe(16);
      expect(s.prefs.lineHeight).toBe(1.6);
    });

    it('setFontSize(20) also updates fontSizeId (T04 → T12 一致性)', () => {
      usePrefStore.getState().setFontSize(20);
      expect(usePrefStore.getState().prefs.fontSizeId).toBe('xl');
    });

    it('hydrate({fontSize:18}) also sets fontSizeId="lg"', () => {
      usePrefStore.getState().hydrate({ fontSize: 18 });
      const s = usePrefStore.getState();
      expect(s.prefs.fontSize).toBe(18);
      expect(s.prefs.fontSizeId).toBe('lg');
    });
  });
});