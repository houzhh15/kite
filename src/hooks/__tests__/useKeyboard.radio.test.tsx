/**
 * useKeyboard.radio.test.tsx — T12 AC-05-3 验证: 焦点在 radio 时 Cmd+/-/0 不劫持.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { usePrefStore } from '../../stores/prefStore';
import {
  __resetKeyboardForTest,
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from '../useKeyboard';

function makeApi() {
  return {
    isSearchOpen: () => false,
    openSearch: () => {},
    closeSearch: () => false,
    closeTopOverlay: () => false,
    openFile: () => {},
    bumpFontSize: (delta: 1 | -1 | 0) => {
      usePrefStore.getState().cycleFontSize(delta);
    },
    cycleTheme: () => {},
    openRecentDrawer: () => {},
    scrollReaderTo: () => {},
    getReaderScrollEl: () => null,
    // T15 (FR-01/FR-04): placeholders.
    toggleTree: () => {},
    historyBack: () => {},
    historyForward: () => {},
    // T16-P2 (FR-03): 全屏切换 placeholder.
    toggleFullscreen: () => {},
    // T24 (F-26): 在外部编辑器中打开 placeholder.
    openExternalEditor: () => {},
    // T26 (R-12 修复): 重新加载 placeholder.
    reload: () => {},
  };
}

describe('useKeyboard — T12 radio 焦点守卫', () => {
  afterEach(() => {
    unregisterGlobalShortcuts();
    __resetKeyboardForTest();
    vi.restoreAllMocks();
  });

  it('Cmd+= 在 input 内不触发 zoomIn', () => {
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
    const { container } = render(
      <div>
        <input data-testid="ti" type="text" />
      </div>,
    );
    registerGlobalShortcuts(makeApi());
    const input = container.querySelector('input')!;
    input.focus();
    // isMac=false in jsdom → modifier is ctrlKey.
    fireEvent.keyDown(input, { key: '=', ctrlKey: true });
    expect(usePrefStore.getState().prefs.fontSizeId).toBe('md'); // unchanged
  });

  it('Cmd+= 在 radio 内不触发 zoomIn (AC-05-3)', () => {
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
    const { container } = render(
      <div role="radiogroup">
        <button role="radio" data-testid="r1" aria-checked="true">A</button>
        <button role="radio" data-testid="r2" aria-checked="false">B</button>
      </div>,
    );
    registerGlobalShortcuts(makeApi());
    const r1 = container.querySelector<HTMLElement>('[data-testid="r1"]')!;
    r1.focus();
    fireEvent.keyDown(r1, { key: '=', ctrlKey: true });
    expect(usePrefStore.getState().prefs.fontSizeId).toBe('md'); // unchanged
  });

  it('Cmd+= 在 div 上触发 zoomIn → cycleFontSize(1)', () => {
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
    const { container } = render(<div data-testid="scope" />);
    registerGlobalShortcuts(makeApi());
    const scope = container.querySelector('[data-testid="scope"]')!;
    (scope as HTMLElement).focus();
    fireEvent.keyDown(scope, { key: '=', ctrlKey: true });
    expect(usePrefStore.getState().prefs.fontSizeId).toBe('lg'); // md → lg
  });
});