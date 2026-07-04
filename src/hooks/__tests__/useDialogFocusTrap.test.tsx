/**
 * useDialogFocusTrap.test.tsx — T12 焦点陷阱行为验证.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';

import { useDialogFocusTrap } from '../useDialogFocusTrap';

function TrapDialog({ onEscape }: { onEscape?: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(true);
  useDialogFocusTrap({ containerRef: ref, active, onEscape });
  return (
    <div ref={ref}>
      <button type="button" data-testid="first">First</button>
      <button type="button" data-testid="middle">Middle</button>
      <button type="button" data-testid="last">Last</button>
      <button type="button" data-testid="close" onClick={() => setActive(false)}>Close</button>
    </div>
  );
}

describe('useDialogFocusTrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('挂载时把焦点送到第一可聚焦元素', async () => {
    const { getByTestId } = render(<TrapDialog />);
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('first'));
    });
  });

  it('Esc 触发 onEscape', () => {
    const onEscape = vi.fn();
    render(<TrapDialog onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});