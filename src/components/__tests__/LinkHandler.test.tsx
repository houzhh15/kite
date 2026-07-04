/**
 * T19 (FR-01 / FR-05 / FR-06): LinkHandler 强化后的单测.
 *
 * 覆盖:
 *   - external_click_invokes_ipc        左键外链 → IPC + setExternal + pushTooltip
 *   - modifier_click_opens_window_not_ipc  metaKey → window.open, 无 IPC
 *   - modifier_three_keys               ctrl + shift → 同上
 *   - right_click_passthrough           button=2 → 无 IPC / 无 window.open
 *   - danger_toast_and_warn             javascript: → toast + warn reason=protocol:javascript
 *   - danger_5s_debounce                2s 内连续 2 次 → 仅 1 次 toast
 *   - danger_data_html_blocked          data:text/html → reason=protocol:data-html
 *   - anchor_scroll_no_ipc              #section → scrollIntoView, 无 IPC
 *   - anchor_missing_id_warns           #missing → history.replaceState + warn
 *   - relative_passthrough              ./other.md → 无 IPC, 无 toast
 *   - rel_noopener_noreferrer_attached  rel 属性含 noopener noreferrer
 *   - href_capitalization               JaVaScRiPt: → reason=protocol:javascript
 *   - buildBlockWarn_truncates_200      截断 + 标准化字段
 *   - shouldEmitToast_5s_window         5s 合并去重门控单元测试
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// mock react-i18next 以提供 t() 函数; 单测中只关心 key → message 的映射 (直接传 key).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import LinkHandler, {
  __resetBlockedCache,
  buildBlockWarn,
  shouldEmitToast,
} from '../LinkHandler';
import { useInlineStore } from '../../stores/inlineStore';
import { useToastStore } from '../../lib/toast';

import type * as tauriModule from '../../lib/tauri';

// mock tauri.ts (IPC 出口), 暴露 openExternalUrl 给 vi.fn() 控制.
vi.mock('../../lib/tauri', async () => {
  const actual = await vi.importActual<typeof tauriModule>('../../lib/tauri');
  return {
    ...actual,
    openExternalUrl: vi.fn(),
  };
});

import { openExternalUrl } from '../../lib/tauri';

function clearStores(): void {
  useInlineStore.setState({ lastExternal: null, tooltip: null });
  useToastStore.setState({ items: [] });
  __resetBlockedCache();
}

function makeClickEvent(overrides: Partial<{
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  clientX: number;
  clientY: number;
}> = {}): Partial<MouseEvent> {
  return {
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    button: overrides.button ?? 0,
    clientX: overrides.clientX ?? 10,
    clientY: overrides.clientY ?? 20,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('LinkHandler T19 (FR-01/05/06)', () => {
  beforeEach(() => {
    clearStores();
    (openExternalUrl as unknown as ReturnType<typeof vi.fn>).mockReset();
    (openExternalUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // mock window.open for modifier-key tests.
    window.open = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('external_click_invokes_ipc (AC-01-1)', () => {
    const md = '[ex](https://example.com)';
    const { container } = render(
      <LinkHandler href="https://example.com">{md}</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a).not.toBeNull();

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com');
    // setExternal (host, url) + pushTooltip (x, y, url) 各 1 次
    const inline = useInlineStore.getState();
    expect(inline.lastExternal?.host).toBe('example.com');
    expect(inline.lastExternal?.url).toBe('https://example.com');
    expect(inline.tooltip?.url).toBe('https://example.com');
    expect(inline.tooltip?.x).toBe(10);
    expect(inline.tooltip?.y).toBe(20);
    expect(useToastStore.getState().items.length).toBe(0);
  });

  it('modifier_click_opens_window_not_ipc (AC-05-1)', () => {
    const { container } = render(
      <LinkHandler href="https://example.com">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent({ metaKey: true }) as unknown as MouseEvent);
    });

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('modifier_three_keys (ctrl + shift)', () => {
    const { container } = render(
      <LinkHandler href="https://example.com">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent({ ctrlKey: true, shiftKey: true }) as unknown as MouseEvent);
    });

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('right_click_passthrough (button=2)', () => {
    const { container } = render(
      <LinkHandler href="https://example.com">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent({ button: 2 }) as unknown as MouseEvent);
    });

    expect(window.open).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.length).toBe(0);
  });

  it('danger_toast_and_warn (AC-06-1 / AC-06-3)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkHandler href="javascript:alert(1)">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#'); // 渲染已改写

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(useToastStore.getState().items.length).toBe(1);
    // i18n mock: t(key) === key; 真实运行 / E2E 中由 i18next 解析为 '已拦截不安全的链接'.
    expect(useToastStore.getState().items[0].message).toBe('toast.link.blocked');
    expect(useToastStore.getState().items[0].kind).toBe('error');
    // 标准化 warn (AC-06-3): 含 reason=protocol:javascript + source=LinkHandler + href 截断
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=protocol:javascript'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('source=LinkHandler'),
    );
    warnSpy.mockRestore();
  });

  it('danger_5s_debounce (AC-06-2)', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <LinkHandler href="javascript:alert(1)">link</LinkHandler>,
      );
      const a = container.querySelector('a') as HTMLAnchorElement;
      // 第一次点击: T=1000
      act(() => {
        vi.setSystemTime(new Date(1000));
        fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
      });
      expect(useToastStore.getState().items.length).toBe(1);
      // 2s 后再点: 应被去重跳过
      act(() => {
        vi.setSystemTime(new Date(3000));
        fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
      });
      expect(useToastStore.getState().items.length).toBe(1);
      // 6s 后再点: 已过 5s 窗口, 应再 push 1 次
      act(() => {
        vi.setSystemTime(new Date(7000));
        fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
      });
      expect(useToastStore.getState().items.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('danger_data_html_blocked (reason=protocol:data-html)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkHandler href="data:text/html,<script>">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(useToastStore.getState().items.length).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=protocol:data-html'),
    );
    warnSpy.mockRestore();
  });

  it('anchor_scroll_no_ipc', () => {
    const section = document.createElement('div');
    section.id = 'section';
    section.scrollIntoView = vi.fn();
    document.body.appendChild(section);

    const { container } = render(
      <LinkHandler href="#section">jump</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(section.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#section');
    expect(openExternalUrl).not.toHaveBeenCalled();

    document.body.removeChild(section);
    replaceStateSpy.mockRestore();
  });

  it('anchor_missing_id_warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkHandler href="#missing">jump</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(replaceStateSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('anchor not found'),
    );
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.length).toBe(0);
    warnSpy.mockRestore();
    replaceStateSpy.mockRestore();
  });

  it('relative_passthrough', () => {
    const { container } = render(
      <LinkHandler href="./other.md">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.length).toBe(0);
  });

  it('rel_noopener_noreferrer_attached', () => {
    const { container } = render(
      <LinkHandler href="https://example.com">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    const rel = a.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('rel preserves existing noopener noreferrer when provided', () => {
    const { container } = render(
      <LinkHandler href="https://example.com" rel="noopener noreferrer foo">
        link
      </LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    const rel = a.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    expect(rel).toContain('foo');
  });

  it('empty anchor href="#" silent replaceState', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const { container } = render(<LinkHandler href="#">empty</LinkHandler>);
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#');
    expect(openExternalUrl).not.toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });

  it('IPC failure logs warn but does not throw', async () => {
    (openExternalUrl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('IPC failed'),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkHandler href="https://example.com">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });
    // 异步 reject 后 warn 应触发
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[LinkHandler] open_external_url failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('href_capitalization (JaVaScRiPt → reason=protocol:javascript)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkHandler href="JaVaScRiPt:alert(1)">link</LinkHandler>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;

    act(() => {
      fireEvent.click(a, makeClickEvent() as unknown as MouseEvent);
    });

    expect(useToastStore.getState().items.length).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=protocol:javascript'),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// buildBlockWarn + shouldEmitToast 单元测试 (T19 step-2b / step-2c)
// ---------------------------------------------------------------------------

describe('buildBlockWarn (T19 step-2b)', () => {
  it('includes standardized fields (AC-06-3)', () => {
    const s = buildBlockWarn('LinkHandler', 'javascript:alert(1)', 'protocol:javascript');
    expect(s).toContain('reason=protocol:javascript');
    expect(s).toContain('href=javascript:alert(1)');
    expect(s).toContain('source=LinkHandler');
    expect(s.startsWith('[LinkHandler] blocked unsafe href:')).toBe(true);
  });

  it('truncates href to 200 chars', () => {
    const long = 'x'.repeat(400);
    const s = buildBlockWarn('MarkdownRenderer', long, 'protocol:javascript');
    // 截断后 href 部分应 ≤ 200 + …
    const hrefPart = s.split('href=')[1].split(' source=')[0];
    // href 部分 = 原 200 + '…'
    expect(hrefPart.length).toBeLessThanOrEqual(201);
    expect(hrefPart.endsWith('…')).toBe(true);
  });

  it('accepts MarkdownRenderer source', () => {
    const s = buildBlockWarn('MarkdownRenderer', 'javascript:x', 'protocol:javascript');
    expect(s.startsWith('[MarkdownRenderer]')).toBe(true);
  });
});

describe('shouldEmitToast (T19 step-2c)', () => {
  beforeEach(() => {
    __resetBlockedCache();
  });

  it('returns true on first call and writes Map', () => {
    expect(shouldEmitToast('protocol:javascript', 1000)).toBe(true);
  });

  it('returns false within 5s window', () => {
    expect(shouldEmitToast('protocol:javascript', 1000)).toBe(true);
    expect(shouldEmitToast('protocol:javascript', 2000)).toBe(false);
    expect(shouldEmitToast('protocol:javascript', 4999)).toBe(false);
  });

  it('returns true after 5s window for same reason', () => {
    expect(shouldEmitToast('protocol:javascript', 1000)).toBe(true);
    expect(shouldEmitToast('protocol:javascript', 6001)).toBe(true);
  });

  it('treats different reasons independently', () => {
    expect(shouldEmitToast('protocol:javascript', 1000)).toBe(true);
    expect(shouldEmitToast('protocol:file', 2000)).toBe(true);
  });
});