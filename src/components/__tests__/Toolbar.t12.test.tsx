/**
 * Toolbar.t12.test.tsx — T12 字号指示器 + aria-live announcer 测试.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { Toolbar } from '../Toolbar';
import { usePrefStore } from '../../stores/prefStore';

describe('Toolbar — T12 字号指示器', () => {
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
      hydrated: true,
      loaded: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('字号指示器默认显示 "A 16px"', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const indicator = getByTestId('font-size-indicator');
    expect(indicator.textContent).toContain('A');
    expect(indicator.textContent).toContain('16px');
  });

  it('字号指示器随 setFontSizeId("2xl") 更新为 "A+++ 24px"', () => {
    usePrefStore.getState().setFontSizeId('2xl');
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const indicator = getByTestId('font-size-indicator');
    expect(indicator.textContent).toContain('A+++');
    expect(indicator.textContent).toContain('24px');
  });

  it('aria-live announcer 写入屏读器文本', () => {
    usePrefStore.getState().setFontSizeId('lg');
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const announcer = getByTestId('font-size-announcer');
    expect(announcer.getAttribute('aria-live')).toBe('polite');
    expect(announcer.textContent).toContain('18');
    expect(announcer.textContent).toContain('像素');
  });
});

describe('Toolbar — T19 Logo 与按钮同行', () => {
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
      hydrated: true,
      loaded: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Logo 与 打开/最近 按钮在视觉上同一水平行 (top 一致)', () => {
    // jsdom 不实现真实 layout, 这里改测约束类名 + DOM 结构:
    //   1) header 必须 flex-row flex-nowrap items-center (无 wrap).
    //   2) Logo 必须 flex-shrink-0 (不被按钮挤掉).
    //   3) header 必须只有 2 个直接子节点: [logo, buttonGroup], 按钮与 logo 同层.
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const header = getByTestId('toolbar');
    const logo = getByTestId('toolbar-logo');
    const open = getByTestId('toolbar-open');
    const recent = getByTestId('toolbar-recent');

    // T19 约束 1: 父容器为单行水平 flex, 不允许 wrap.
    expect(header.className).toContain('flex');
    expect(header.className).toContain('flex-row');
    expect(header.className).toContain('flex-nowrap');
    expect(header.className).toContain('items-center');
    expect(header.className).not.toMatch(/\bflex-wrap\b/);
    expect(header.className).toContain('whitespace-nowrap');

    // T19 约束 2: Logo 不能被按钮组压缩 (否则会换行).
    expect(logo.className).toContain('flex-shrink-0');

    // T19 约束 3: header 的直接子节点数 == 2 (logo + 按钮组), 按钮与 logo 同层.
    expect(header.children.length).toBe(2);
    expect(header.children[0]).toBe(logo);
    const buttonGroup = header.children[1];
    expect(buttonGroup.contains(open)).toBe(true);
    expect(buttonGroup.contains(recent)).toBe(true);
    // 按钮组自身也不允许换行, 保证所有按钮与 logo 同行.
    expect(buttonGroup.className).toContain('whitespace-nowrap');
    expect(buttonGroup.className).toContain('flex-nowrap');
  });
});

describe('Toolbar — T20+ Logo 主题切换 (R-06 修复)', () => {
  beforeEach(() => {
    // 重置为 light 主题, 测试中可切换.
    usePrefStore.setState({
      prefs: {
        theme: 'light',
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
  });
  afterEach(() => vi.restoreAllMocks());

  it('theme=light → logo src 指向 kite_logo.png (亮色变体)', () => {
    usePrefStore.setState((s) => ({ prefs: { ...s.prefs, theme: 'light' } }));
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const logo = getByTestId('toolbar-logo');
    expect(logo.getAttribute('src')).toMatch(/kite_logo\.png/);
    expect(logo.getAttribute('src')).not.toMatch(/dark/);
  });

  it('theme=dark → logo src 指向 kite_logo_dark.png (深色变体)', () => {
    usePrefStore.setState((s) => ({ prefs: { ...s.prefs, theme: 'dark' } }));
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const logo = getByTestId('toolbar-logo');
    expect(logo.getAttribute('src')).toMatch(/kite_logo_dark\.png/);
  });

  it('theme=system + matchMedia=light → 亮色 logo', () => {
    // 默认 jsdom matchMedia 返回 false (no match).
    usePrefStore.setState((s) => ({ prefs: { ...s.prefs, theme: 'system' } }));
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const logo = getByTestId('toolbar-logo');
    expect(logo.getAttribute('src')).toMatch(/kite_logo\.png/);
    expect(logo.getAttribute('src')).not.toMatch(/dark/);
  });
});

describe('Toolbar — T19 字号选择器 (替代单纯 cycle)', () => {
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
      hydrated: true,
      loaded: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认收起: indicator 显示当前字号 + ▾, 不显示 popover', () => {
    const { getByTestId, queryByTestId } = render(
      <Toolbar disabled={false} onOpen={() => {}} />,
    );
    const trigger = getByTestId('font-size-indicator');
    expect(trigger.textContent).toContain('16px');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryByTestId('font-picker')).toBeNull();
  });

  it('点击 indicator 打开 popover, 含 5 档选项, 当前档 aria-checked=true', () => {
    const { getByTestId, queryAllByTestId } = render(
      <Toolbar disabled={false} onOpen={() => {}} />,
    );
    const trigger = getByTestId('font-size-indicator');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const picker = getByTestId('font-picker');
    expect(picker.getAttribute('role')).toBe('menu');

    const options = queryAllByTestId('font-picker-option');
    expect(options.length).toBe(5);
    expect(options.map((o) => o.getAttribute('data-font-size-id'))).toEqual([
      'sm', 'md', 'lg', 'xl', '2xl',
    ]);
    const checked = options.filter((o) => o.getAttribute('aria-checked') === 'true');
    expect(checked.length).toBe(1);
    expect(checked[0]?.getAttribute('data-font-size-id')).toBe('md');
  });

  it('选中其它档 → 写 store + 关闭 popover', () => {
    const { getByTestId, queryByTestId, queryAllByTestId } = render(
      <Toolbar disabled={false} onOpen={() => {}} />,
    );
    fireEvent.click(getByTestId('font-size-indicator'));
    const options = queryAllByTestId('font-picker-option');
    const xl = options.find((o) => o.getAttribute('data-font-size-id') === 'xl');
    expect(xl).toBeDefined();
    if (!xl) return;
    fireEvent.click(xl);
    expect(usePrefStore.getState().prefs.fontSizeId).toBe('xl');
    expect(usePrefStore.getState().prefs.fontSize).toBe(20);
    expect(queryByTestId('font-picker')).toBeNull();
  });

  it('再次点击 indicator / Esc 都能关闭 popover', () => {
    const { getByTestId, queryByTestId } = render(
      <Toolbar disabled={false} onOpen={() => {}} />,
    );
    const trigger = getByTestId('font-size-indicator');
    fireEvent.click(trigger);
    expect(getByTestId('font-picker')).toBeTruthy();
    // 1) 再次点击 toggle 关闭
    fireEvent.click(trigger);
    expect(queryByTestId('font-picker')).toBeNull();
    // 2) Esc 关闭
    fireEvent.click(trigger);
    expect(getByTestId('font-picker')).toBeTruthy();
    // useFullscreen 上 useKeyboard 挂全局 keydown; 这里模拟 Escape 按键 (同事件).
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(queryByTestId('font-picker')).toBeNull();
  });
});