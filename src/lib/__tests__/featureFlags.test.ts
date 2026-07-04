/**
 * featureFlags.test.ts — T17-P2 (F-21/F-22) featureFlags 行为契约.
 *
 * 设计依据: docs/design/compiled.md §3.2.2 / §3.2.4.
 *
 * 覆盖:
 *   - setFlags({ mermaid: true }) → flags.mermaid === true, 其它保留.
 *   - resetFlags() → mermaid/katex 回默认 false.
 *   - hydrateFlags({ mermaid: undefined }) → 保留当前值, 不变.
 *   - hydrateFlags({ mermaid: 'yes' }) → 非法值兜底默认 false, console.warn.
 *   - hydrateFlags(undefined) → 全部保留当前值.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFlags,
  hydrateFlags,
  resetFlags,
  setFlags,
} from '../featureFlags';

describe('featureFlags (T17-P2)', () => {
  afterEach(() => {
    resetFlags();
    vi.restoreAllMocks();
  });

  it('default flags expose mermaid/katex === false', () => {
    resetFlags();
    expect(getFlags().mermaid).toBe(false);
    expect(getFlags().katex).toBe(false);
    expect(getFlags().highlight).toBe(true);
    expect(getFlags().subSup).toBe(true);
  });

  it('setFlags({ mermaid: true }) updates mermaid without losing other fields', () => {
    setFlags({ mermaid: true });
    expect(getFlags().mermaid).toBe(true);
    expect(getFlags().katex).toBe(false);
    expect(getFlags().highlight).toBe(true);
  });

  it('setFlags({ katex: true }) updates katex without losing other fields', () => {
    setFlags({ katex: true });
    expect(getFlags().katex).toBe(true);
    expect(getFlags().mermaid).toBe(false);
  });

  it('resetFlags() restores all defaults including mermaid/katex', () => {
    setFlags({ mermaid: true, katex: true });
    expect(getFlags().mermaid).toBe(true);
    expect(getFlags().katex).toBe(true);
    resetFlags();
    expect(getFlags().mermaid).toBe(false);
    expect(getFlags().katex).toBe(false);
  });

  it('hydrateFlags({ mermaid: undefined }) keeps current value (no-op)', () => {
    setFlags({ mermaid: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hydrateFlags({ mermaid: undefined });
    expect(getFlags().mermaid).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('hydrateFlags({ mermaid: "yes" }) falls back to current + warns', () => {
    setFlags({ mermaid: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hydrateFlags({ mermaid: 'yes' as unknown as boolean });
    // 非法值兜底: 保持当前值 (true), 一次 console.warn.
    expect(getFlags().mermaid).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('hydrateFlags({ katex: false }) merges cleanly', () => {
    setFlags({ katex: true });
    hydrateFlags({ katex: false });
    expect(getFlags().katex).toBe(false);
    expect(getFlags().mermaid).toBe(false);
  });

  it('hydrateFlags(undefined) does nothing (no warn, no change)', () => {
    setFlags({ mermaid: true, katex: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hydrateFlags(undefined);
    expect(getFlags().mermaid).toBe(true);
    expect(getFlags().katex).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});