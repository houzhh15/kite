/**
 * shortcuts 单元测试 (T11 step-6).
 *
 * 设计依据: docs/design/compiled.md §3.3.2 / FR-13.
 *
 * 覆盖:
 *   - isMac: 多种 UA / platform 组合 → mac / not mac.
 *   - getShortcutLabel: macOS ⌘ 符号 / Win Ctrl+ 符号.
 *   - SHORTCUTS 数组完整性: 10 条, id 唯一.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { SHORTCUTS, isMac, getShortcutLabel, __resetShortcutsForTest } from '../shortcuts';

beforeEach(() => {
  __resetShortcutsForTest();
});

describe('isMac (T11 step-6)', () => {
  function setNav(ua: string, platform: string): void {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  }

  it('jsdom 默认 UA (darwin) + 空 platform → mac=false (vitest jsdom behavior)', () => {
    setNav('Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/25.0.1', '');
    expect(isMac()).toBe(false);
  });

  it('Windows UA → mac=false', () => {
    setNav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32');
    expect(isMac()).toBe(false);
  });

  it('Linux UA → mac=false', () => {
    setNav('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64');
    expect(isMac()).toBe(false);
  });

  it('Mac UA → mac=true', () => {
    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel');
    expect(isMac()).toBe(true);
  });
});

describe('getShortcutLabel (T11 step-6)', () => {
  it('mac=true → ⌘ 符号', () => {
    expect(getShortcutLabel('open', true)).toBe('⌘O');
    expect(getShortcutLabel('find', true)).toBe('⌘F');
    expect(getShortcutLabel('cycleTheme', true)).toBe('⌘⇧L');
  });

  it('mac=false → Ctrl+ 符号', () => {
    expect(getShortcutLabel('open', false)).toBe('Ctrl+O');
    expect(getShortcutLabel('find', false)).toBe('Ctrl+F');
    expect(getShortcutLabel('cycleTheme', false)).toBe('Ctrl+Shift+L');
    expect(getShortcutLabel('recentDrawer', false)).toBe('Ctrl+Shift+P');
    expect(getShortcutLabel('zoomIn', false)).toBe('Ctrl+=');
    expect(getShortcutLabel('zoomOut', false)).toBe('Ctrl+-');
    expect(getShortcutLabel('zoomReset', false)).toBe('Ctrl+0');
  });

  it('Esc / Home / End 跨平台一致', () => {
    expect(getShortcutLabel('scrollTop', true)).toBe(getShortcutLabel('scrollTop', false));
    expect(getShortcutLabel('scrollBottom', true)).toBe(getShortcutLabel('scrollBottom', false));
    expect(getShortcutLabel('closeOverlay', true)).toBe(getShortcutLabel('closeOverlay', false));
  });

  it('unknown id → 空串', () => {
    expect(getShortcutLabel('nonexistent' as never, true)).toBe('');
  });
});

describe('SHORTCUTS 注册表完整性', () => {
  it('共 15 条 (T11 10 + T15 3 + T24 1 + T26 1)', () => {
    expect(SHORTCUTS.length).toBe(15);
  });

  it('id 唯一', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id 集合与设计 §3.3.1 + T15 + T24 一致', () => {
    const ids = SHORTCUTS.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        'closeOverlay',
        'cycleTheme',
        'find',
        'historyBack',
        'historyForward',
        'open',
        'openExternalEditor',
        'recentDrawer',
        'reload',
        'scrollBottom',
        'scrollTop',
        'toggleTree',
        'zoomIn',
        'zoomOut',
        'zoomReset',
      ].sort(),
    );
  });

  it('所有 modifier 为 mod 或 none', () => {
    for (const s of SHORTCUTS) {
      expect(['mod', 'none']).toContain(s.modifier);
    }
  });

  it('find / closeOverlay 的 allowInForm=true', () => {
    expect(SHORTCUTS.find((s) => s.id === 'find')?.allowInForm).toBe(true);
    expect(SHORTCUTS.find((s) => s.id === 'closeOverlay')?.allowInForm).toBe(true);
  });

  it('其它默认 allowInForm=undefined/false', () => {
    for (const s of SHORTCUTS) {
      if (
        s.id === 'find' ||
        s.id === 'closeOverlay' ||
        // T15 (FR-04): 历史翻页快捷键即便焦点在 input 也允许触发.
        s.id === 'historyBack' ||
        s.id === 'historyForward'
      ) {
        continue;
      }
      expect(!!s.allowInForm).toBe(false);
    }
  });
});