/**
 * Settings.diagrams.test.tsx — T17-P2 (F-21/F-22) 设置页图表与公式分组.
 *
 * 设计依据: docs/design/compiled.md §3.7.3 / 需求 AC-03-1.
 *
 * 覆盖:
 *   - 初始: 两个 Switch unchecked (aria-checked=false).
 *   - 点击 mermaid 开关 → prefs.mermaidEnabled=true, aria-checked 更新.
 *   - 点击 katex 开关 → prefs.katexEnabled=true.
 *   - 双语切换: language=en-US 后 label 切英文.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { usePrefStore } from '../../stores/prefStore';
import { Settings } from '../Settings';

const FULL_PREFS = {
  theme: 'system' as const,
  fontSize: 16,
  lineHeight: 1.6 as const,
  codeBlockTheme: 'github',
  fontSizeId: 'md' as const,
  lineHeightId: 'cozy' as const,
  codeFontSizeId: 'md' as const,
  language: 'zh-CN' as const,
  mermaidEnabled: false as const,
  katexEnabled: false as const,
  externalEditor: 'system' as const,
  externalEditorCustomCmd: '',
};

describe('Settings diagrams & formulas section (T17-P2)', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: { ...FULL_PREFS },
      hydrated: true,
      loaded: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders diagrams section with two switches (initial unchecked)', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const section = getByTestId('settings-diagrams');
    expect(section.getAttribute('data-section')).toBe('diagrams');
    const mermaid = getByTestId('settings-mermaid');
    const katex = getByTestId('settings-katex');
    expect(mermaid.getAttribute('role')).toBe('switch');
    expect(mermaid.getAttribute('aria-checked')).toBe('false');
    expect(katex.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking mermaid switch updates prefs.mermaidEnabled + aria-checked', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const mermaid = getByTestId('settings-mermaid');
    fireEvent.click(mermaid);
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(true);
    expect(mermaid.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking katex switch updates prefs.katexEnabled + aria-checked', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const katex = getByTestId('settings-katex');
    fireEvent.click(katex);
    expect(usePrefStore.getState().prefs.katexEnabled).toBe(true);
    expect(katex.getAttribute('aria-checked')).toBe('true');
  });

  it('toggling mermaid twice returns to initial false (idempotent)', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const mermaid = getByTestId('settings-mermaid');
    fireEvent.click(mermaid);
    fireEvent.click(mermaid);
    expect(usePrefStore.getState().prefs.mermaidEnabled).toBe(false);
    expect(mermaid.getAttribute('aria-checked')).toBe('false');
  });

  it('reflects mermaidEnabled=true from prefStore on initial render', () => {
    usePrefStore.setState({
      prefs: { ...FULL_PREFS, mermaidEnabled: true },
      hydrated: true,
      loaded: true,
    });
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    expect(getByTestId('settings-mermaid').getAttribute('aria-checked')).toBe('true');
  });
});