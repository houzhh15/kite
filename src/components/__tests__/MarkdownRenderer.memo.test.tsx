/**
 * T13 MarkdownRenderer.memo.test.tsx — T13 step-16e (FR-05 / AC-05-1)
 *
 * 验证:
 *   - MarkdownRenderer 在 props (content) 不变时不重渲.
 *   - 通过 console.count('MarkdownRenderer render') 探针判断.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useState } from 'react';

import MarkdownRenderer from '../MarkdownRenderer';

describe('MarkdownRenderer memo probe — T13 step-06a / FR-05', () => {
  beforeEach(() => {
    // 模拟 dev 模式环境 (供 import.meta.env.DEV 检测 + console.count).
    // vitest 默认 import.meta.env.DEV = true.
  });

  it('props.content 不变时父组件 state 变更不触发 MarkdownRenderer 重渲', () => {
    const consoleCount = vi.spyOn(console, 'count').mockImplementation(() => {});
    const sample = '# Hello\n\nworld';
    let setOther: (v: number) => void = () => {};

    const { rerender } = render(<Parent content={sample} setOtherRef={(fn) => (setOther = fn)} />);

    const markdownRendererCallsBefore = consoleCount.mock.calls.filter(
      ([label]) => label === 'MarkdownRenderer render',
    ).length;

    // 触发无关 state 变化.
    setOther(42);
    rerender(<Parent content={sample} setOtherRef={(fn) => (setOther = fn)} />);

    const markdownRendererCallsAfter = consoleCount.mock.calls.filter(
      ([label]) => label === 'MarkdownRenderer render',
    ).length;

    // MarkdownRenderer 此时应**不**被重渲.
    expect(markdownRendererCallsAfter).toBe(markdownRendererCallsBefore);

    consoleCount.mockRestore();
  });
});

function Parent(props: {
  content: string;
  setOtherRef: (setter: (v: number) => void) => void;
}): JSX.Element {
  const [other, setOther] = useState(0);
  props.setOtherRef(setOther);
  return (
    <div>
      <span data-testid="other">{other}</span>
      <MarkdownRenderer content={props.content} />
    </div>
  );
}
