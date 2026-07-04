/**
 * prefStore.diagrams.test.ts — T17-P2 (F-21/F-22) prefStore mermaid/katex 字段行为.
 *
 * 设计依据: docs/design/compiled.md §3.2.3 / 需求 AC-03-1, AC-03-3.
 *
 * 覆盖:
 *   - setMermaidEnabled(true) → prefs.mermaidEnabled=true.
 *   - setMermaidEnabled(false) → prefs.mermaidEnabled=false.
 *   - setMermaidEnabled(non-boolean) → console.warn + 保持当前值.
 *   - setKatexEnabled(true) → prefs.katexEnabled=true.
 *   - hydrate 接受 mermaidEnabled / katexEnabled 字段; 非法值兜底当前值.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefStore } from '../prefStore';

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
};

describe('prefStore mermaid/katex (T17-P2)', () => {
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

  it('setMermaidEnabled(true) toggles prefs.mermaidEnabled', () => {
    usePrefStore.getState().setMermaidEnabled(true);
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(true);
  });

  it('setMermaidEnabled(false) toggles back', () => {
    usePrefStore.getState().setMermaidEnabled(true);
    usePrefStore.getState().setMermaidEnabled(false);
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(false);
  });

  it('setMermaidEnabled(non-boolean) warns + noop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePrefStore.getState().setMermaidEnabled('yes' as unknown as boolean);
    expect(warn).toHaveBeenCalled();
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(false);
  });

  it('setKatexEnabled(true) toggles prefs.katexEnabled', () => {
    usePrefStore.getState().setKatexEnabled(true);
    expect(usePrefStore.getState().prefs.katexEnabled).toBe(true);
  });

  it('hydrate with mermaidEnabled=true applies it', () => {
    usePrefStore.getState().hydrate({ mermaidEnabled: true });
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(true);
    expect(usePrefStore.getState().hydrated).toBe(true);
  });

  it('hydrate with katexEnabled=true applies it', () => {
    usePrefStore.getState().hydrate({ katexEnabled: true });
    expect(usePrefStore.getState().prefs.katexEnabled).toBe(true);
  });

  it('hydrate with non-boolean mermaidEnabled keeps current value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePrefStore.getState().setMermaidEnabled(true);
    usePrefStore.getState().hydrate({ mermaidEnabled: 'invalid' as unknown as boolean });
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(true);
    expect(warn).not.toHaveBeenCalled(); // hydrate 路径走 console 不 warn (静默兜底)
  });
});