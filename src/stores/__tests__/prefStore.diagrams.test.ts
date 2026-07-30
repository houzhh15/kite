/** 图表与公式始终启用，旧持久化开关应被安全忽略。 */
import { beforeEach, describe, expect, it } from 'vitest';

import { usePrefStore } from '../prefStore';

describe('prefStore legacy diagram preferences', () => {
  beforeEach(() => {
    usePrefStore.getState().hydrate();
  });

  it('ignores legacy mermaidEnabled/katexEnabled fields', () => {
    usePrefStore.getState().hydrate({
      mermaidEnabled: false,
      katexEnabled: false,
    } as never);
    const prefs = usePrefStore.getState().prefs as unknown as Record<string, unknown>;
    expect(prefs.mermaidEnabled).toBeUndefined();
    expect(prefs.katexEnabled).toBeUndefined();
  });
});
