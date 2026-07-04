/**
 * MermaidBlock.test.tsx — T17-P2 (F-21) + T20 (FR-05 / FR-06 / AC-05-1 ~ AC-05-4).
 *
 * 覆盖:
 *   - mock mermaid.render 成功 → 输出 svg 节点 + role="img" + aria-label.
 *   - mock mermaid.render 抛错 → 输出 fallback DOM (data-fallback="mermaid" + error 节点).
 *   - 模块级 guard: 第二次 mount 不再弹 mermaidBundleHint.
 *   - AC-05-1: mermaid.render 返回含 <script> 的 SVG → 渲染后 DOM 不含 <script> 节点,
 *     data-testid="mermaid-rendered" 子树无 onload= 属性.
 *   - AC-05-2: mermaid.render 返回合法 SVG → 渲染后 <svg> 节点仍可见.
 *   - AC-05-4: 完整 mount→unmount 全过程 console 无 "XSS" / "dangerously" 警告.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

const mockMermaidRender = vi.fn();
const mockPushToast = vi.fn();

vi.mock('../../lib/toast', () => ({
  pushToast: (input: { kind: string; message: string }) => mockPushToast(input),
}));

vi.mock('mermaid', () => {
  return {
    default: {
      initialize: vi.fn(),
      render: (...args: unknown[]) => mockMermaidRender(...args),
      parse: vi.fn(),
    },
  };
});

import MermaidBlock, { __resetMermaidForTest } from '../MermaidBlock';
import i18n, { DEFAULT_LNG } from '../../i18n';

beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LNG);
});

describe('MermaidBlock (T17-P2)', () => {
  beforeEach(() => {
    mockMermaidRender.mockReset();
    mockPushToast.mockReset();
    mockMermaidRender.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"><g><text>A</text></g></svg>',
    });
    __resetMermaidForTest();
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetMermaidForTest();
  });

  it('renders <svg> when mermaid.render resolves', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="graph TD;A-->B" />
      </I18nextProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeTruthy();
    });
    const rendered = container.querySelector('[data-testid="mermaid-rendered"]');
    expect(rendered?.getAttribute('role')).toBe('img');
    expect(rendered?.getAttribute('aria-label')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders fallback DOM when mermaid.render rejects (no toast)', async () => {
    mockMermaidRender.mockRejectedValueOnce(new Error('Syntax error'));
    // mock render 失败场景前先静默掉 bundle hint toast (模块级 guard 由 __reset 重置).
    mockPushToast.mockImplementation(() => undefined);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="invalid mermaid syntax @#$" />
      </I18nextProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-fallback="mermaid"]')).toBeTruthy();
      expect(container.querySelector('[data-fallback="mermaid-error"]')).toBeTruthy();
    });
    // 过滤掉 mermaidBundleHint (info), 断言 error toast / 单块语法错误 toast 未触发.
    const errorToasts = mockPushToast.mock.calls.filter(
      ([t]) => (t as { kind: string }).kind === 'error',
    );
    expect(errorToasts.length).toBe(0);
    // fallback 节点内容等于原始 code.
    const fallback = container.querySelector('[data-fallback="mermaid"]');
    expect(fallback?.textContent).toContain('invalid mermaid syntax');
  });

  it('module-level bundle hint toast only fires once', async () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="graph TD;A-->B" />
      </I18nextProvider>,
    );
    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info' }),
      );
    });
    // 卸载后第二次 mount: bundle hint 已记入模块级 guard, 不再触发.
    mockPushToast.mockClear();
    unmount();
    render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="graph TD;X-->Y" />
      </I18nextProvider>,
    );
    // 等待 effect 完成.
    await new Promise((r) => setTimeout(r, 20));
    const infoToasts = mockPushToast.mock.calls.filter(
      ([t]) => (t as { kind: string }).kind === 'info',
    );
    expect(infoToasts.length).toBe(0);
  });
});

describe('MermaidBlock (T20 / FR-05)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    __resetMermaidForTest();
  });

  it('AC-05-1: 含 <script> 的恶意 mermaid 输出经 sanitizeSvg 后不进入 DOM', async () => {
    mockMermaidRender.mockReset();
    mockPushToast.mockReset();
    // mock mermaid 返回恶意 SVG: 含 <script> + <g onload=...> + <foreignObject>.
    mockMermaidRender.mockResolvedValue({
      svg:
        '<svg><script>alert("xss")</script>' +
        '<g onload="alert(\'xss\')"><rect width="10" height="10"/></g>' +
        '<foreignObject><iframe srcdoc="<script>alert(\'nested\')</script>"></iframe></foreignObject>' +
        '</svg>',
    });
    __resetMermaidForTest();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="evil mermaid code" />
      </I18nextProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeTruthy();
    });
    const rendered = container.querySelector('[data-testid="mermaid-rendered"]') as HTMLElement;
    expect(rendered).toBeTruthy();
    // AC-05-1: DOM 内不含 <script> 节点, 不含 onload= 属性.
    expect(rendered.querySelector('script')).toBeNull();
    expect(rendered.innerHTML).not.toContain('<script');
    expect(rendered.innerHTML).not.toContain('onload=');
    expect(rendered.innerHTML).not.toContain('<foreignobject');
    expect(rendered.innerHTML).not.toContain('<iframe');
    expect(rendered.innerHTML).not.toContain('alert');
  });

  it('AC-05-2: 合法 SVG 经净化后 <svg> 节点仍可见 (删除式而非整段替换)', async () => {
    mockMermaidRender.mockReset();
    mockPushToast.mockReset();
    mockMermaidRender.mockResolvedValue({
      svg: '<svg><g><path d="M0 0"></path><text>A</text></g></svg>',
    });
    __resetMermaidForTest();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MermaidBlock code="graph LR;A-->B" />
      </I18nextProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeTruthy();
    });
    // AC-05-2: <svg> 节点仍可见.
    expect(container.querySelector('svg')).toBeTruthy();
    // <path> 与 <text> 也保留 (USE_PROFILES.svg 白名单).
    const rendered = container.querySelector('[data-testid="mermaid-rendered"]') as HTMLElement;
    expect(rendered.querySelector('path')).not.toBeNull();
    expect(rendered.querySelector('text')).not.toBeNull();
  });

  it('AC-05-4: mount → unmount 全过程浏览器控制台无 XSS / dangerouslySetInnerHTML warning', async () => {
    mockMermaidRender.mockReset();
    mockPushToast.mockReset();
    mockMermaidRender.mockResolvedValue({
      svg: '<svg><g><path d="M0 0"/></g></svg>',
    });
    __resetMermaidForTest();
    // 静默 Mermaid 库的"i18n missing key" 警告 (这些是预期的 — 测试要验的是 XSS warning).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { unmount } = render(
        <I18nextProvider i18n={i18n}>
          <MermaidBlock code="graph LR;A-->B" />
        </I18nextProvider>,
      );
      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'info' }),
        );
      });
      unmount();
      // 收集所有 warn + error 调用.
      const allLogs: string[] = [];
      for (const call of warnSpy.mock.calls) allLogs.push(...call.map((c) => String(c)));
      for (const call of errorSpy.mock.calls) allLogs.push(...call.map((c) => String(c)));
      const hasXssWarn = allLogs.some((line) =>
        /\b(XSS|dangerouslySetInnerHTML|Cross[- ]Site|Script Injection)\b/i.test(line),
      );
      expect(hasXssWarn).toBe(false);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
