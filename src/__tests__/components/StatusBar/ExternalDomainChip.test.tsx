/**
 * ExternalDomainChip.test.tsx — 状态栏外链域反馈 (FR-16).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import ExternalDomainChip from '../../../components/StatusBar/ExternalDomainChip';
import { INLINE_TTL_MS, useInlineStore } from '../../../stores/inlineStore';

beforeEach(() => {
  vi.useFakeTimers();
  useInlineStore.setState({ lastExternal: null, tooltip: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExternalDomainChip', () => {
  it('lastExternal 为空 → 渲染 null (AC-16-3 / AC-16-4)', () => {
    const { container } = render(<ExternalDomainChip />);
    expect(container.firstChild).toBeNull();
  });

  it('写入 lastExternal → 显示 🔗 {host}', () => {
    useInlineStore.getState().setExternal('example.com', 'https://example.com/x');
    const { getByTestId, getByText } = render(<ExternalDomainChip />);
    expect(getByTestId('external-domain-chip')).toBeTruthy();
    expect(getByText('example.com')).toBeTruthy();
  });

  it('5s 后自动清理 (AC-16-1 衍生)', () => {
    useInlineStore.getState().setExternal('example.com', 'https://example.com');
    const { container, queryByTestId } = render(<ExternalDomainChip />);
    expect(queryByTestId('external-domain-chip')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(INLINE_TTL_MS + 1000);
    });
    expect(queryByTestId('external-domain-chip')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('host 为空时不显示', () => {
    useInlineStore.setState({
      lastExternal: { host: '', url: 'https://example.com', ts: Date.now() },
    });
    const { container } = render(<ExternalDomainChip />);
    expect(container.firstChild).toBeNull();
  });

  it('data-host 属性便于测试', () => {
    useInlineStore.getState().setExternal('a.com', 'https://a.com');
    const { getByTestId } = render(<ExternalDomainChip />);
    expect(getByTestId('external-domain-chip').getAttribute('data-host')).toBe('a.com');
  });
});