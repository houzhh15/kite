import { afterEach, describe, expect, it } from 'vitest';

import { getFlags, resetFlags, setFlags } from '../featureFlags';

describe('featureFlags', () => {
  afterEach(resetFlags);

  it('only exposes lightweight optional Markdown features', () => {
    expect(getFlags()).toEqual({ highlight: true, subSup: true, wiki: false });
    expect('mermaid' in getFlags()).toBe(false);
    expect('katex' in getFlags()).toBe(false);
  });

  it('merges supported flags without losing defaults', () => {
    setFlags({ wiki: true });
    expect(getFlags()).toEqual({ highlight: true, subSup: true, wiki: true });
  });
});
