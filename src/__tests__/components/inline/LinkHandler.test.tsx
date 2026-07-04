/**
 * LinkHandler.test.tsx — 链接点击路由分发 (契约 4 / AC-13 + AC-14).
 *
 * 设计依据: docs/design/compiled.md §3.5.1 + §3.8 契约 4 + FR-06/13/14/16/17.
 * 覆盖:
 *   - 外链 → preventDefault + open_external_url + lastExternal 更新 (AC-13-1, AC-16-1)
 *   - 锚点 → 滚动 + hash 更新, 不调 open_external_url (AC-13-2)
 *   - 修饰键 → 仍走系统浏览器, 不内嵌 (AC-13-3)
 *   - 空 href → 仅 hash 变更, 无报错 (AC-13-4)
 *   - javascript: → href 改写 # + 不调 open_external_url (AC-13-5, AC-14-3)
 *   - data:text/html → href 改写 # (AC-14-4)
 *   - rel="noopener noreferrer" 强制 (AC-14-5)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import LinkHandler from '../../../components/LinkHandler';
import { useInlineStore } from '../../../stores/inlineStore';

vi.mock('../../../lib/tauri', () => ({
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
}));

import { openExternalUrl } from '../../../lib/tauri';
const mockedOpenExternalUrl = vi.mocked(openExternalUrl);

beforeEach(() => {
  useInlineStore.setState({ lastExternal: null, tooltip: null });
  mockedOpenExternalUrl.mockReset();
  mockedOpenExternalUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeClickEvent(init: Partial<MouseEvent> = {}): Partial<MouseEvent> {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    clientX: 100,
    clientY: 100,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  };
}

describe('LinkHandler — 契约 4', () => {
  it('外链: preventDefault + open_external_url + status (AC-13-1, AC-16-1)', () => {
    const { container, getByText } = render(
      <LinkHandler href="https://example.com/x">Kite</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');

    const preventDefaultSpy = vi.fn();
    const origDispatch = a.dispatchEvent.bind(a);
    vi.spyOn(a, 'dispatchEvent').mockImplementation((ev) => {
      // 在 Event 实例上注入 preventDefault 监听
      try {
        Object.defineProperty(ev, 'preventDefault', { value: preventDefaultSpy, configurable: true });
      } catch {
        /* already defined */
      }
      return origDispatch(ev);
    });
    fireEvent.click(a, { clientX: 100, clientY: 100 });
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(mockedOpenExternalUrl).toHaveBeenCalledWith('https://example.com/x');
    expect(useInlineStore.getState().lastExternal?.host).toBe('example.com');
    expect(getByText('Kite')).toBeTruthy();
  });

  it('锚点 #section: 滚动 + hash, 不调 open_external_url (AC-13-2)', () => {
    const target = document.createElement('div');
    target.id = 'section';
    document.body.appendChild(target);
    target.scrollIntoView = vi.fn();
    const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);

    const { container } = render(<LinkHandler href="#section">jump</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a, makeClickEvent());

    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    expect(useInlineStore.getState().lastExternal).toBeNull();

    document.body.removeChild(target);
    replaceSpy.mockRestore();
  });

  it('锚点 #nope (id 不存在): 仅 hash 静默 + warn (AC-13-2 衍生)', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { container } = render(<LinkHandler href="#nope">jump</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(() => fireEvent.click(a, makeClickEvent())).not.toThrow();
    expect(replaceSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();

    replaceSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('Cmd + 点击外链: 走 window.open 而非 IPC (T19 FR-05 / AC-05-1)', () => {
    // T19 升级契约 (取代原 AC-13-3 "修饰键仍走系统浏览器" 的模糊描述):
    //   修饰键命中时, 显式调 window.open(url, '_blank', 'noopener,noreferrer'),
    //   不进入 IPC 路径. 旧测试期望调 openExternalUrl 是 T07 行为.
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = render(
      <LinkHandler href="https://example.com">Kite</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a, makeClickEvent({ metaKey: true }));
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });

  it('Ctrl + 点击外链: 走 window.open 而非 IPC (T19 FR-05)', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = render(
      <LinkHandler href="https://example.com">Kite</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a, makeClickEvent({ ctrlKey: true }));
    expect(windowOpenSpy).toHaveBeenCalled();
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });

  it('空 href (空字符串): 渲染 <a href="#"> (AC-06-5)', () => {
    const { container } = render(<LinkHandler href="">empty</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#');
  });

  it('javascript: 危险协议 → href 改写 # + 不调 open (AC-06-4, AC-14-3)', () => {
    const { container } = render(
      <LinkHandler href="javascript:alert(1)">bad</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    // 渲染时即改写 href 为 #
    expect(a.getAttribute('href')).toBe('#');
    fireEvent.click(a, makeClickEvent());
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('data:text/html 危险 → href 改写 # (AC-06-6, AC-14-4)', () => {
    const { container } = render(
      <LinkHandler href="data:text/html,<script>alert(1)</script>">x</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#');
  });

  it('mailto: → 走外部 URL + host=b.com (AC-07-3)', () => {
    const { container } = render(
      <LinkHandler href="mailto:user@b.com">mail</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a, makeClickEvent());
    expect(mockedOpenExternalUrl).toHaveBeenCalledWith('mailto:user@b.com');
    expect(useInlineStore.getState().lastExternal?.host).toBe('b.com');
  });

  it('相对路径 .md → text 链接: host 空, lastExternal 不更新 (AC-16-3)', () => {
    const { container } = render(
      <LinkHandler href="./other.md">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a, makeClickEvent());
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    expect(useInlineStore.getState().lastExternal).toBeNull();
  });

  it('强制 rel="noopener noreferrer" (AC-14-5)', () => {
    const { container } = render(<LinkHandler href="#x">jump</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
  });

  it('title 透传', () => {
    const { container } = render(<LinkHandler href="#x" title="my-title">x</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('title')).toBe('my-title');
  });
});