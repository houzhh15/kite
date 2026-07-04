/**
 * layoutStore.test.ts — T15 (FR-01) layoutStore.treeOpen 测试.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useLayoutStore, toggleTree, isTreeOpen } from '../layoutStore';

describe('layoutStore — T15 (FR-01)', () => {
  beforeEach(() => {
    useLayoutStore.setState({ treeOpen: false });
  });

  it('starts hidden (treeOpen=false)', () => {
    expect(useLayoutStore.getState().treeOpen).toBe(false);
    expect(isTreeOpen()).toBe(false);
  });

  it('toggleTree flips state', () => {
    expect(useLayoutStore.getState().treeOpen).toBe(false);
    useLayoutStore.getState().toggleTree();
    expect(useLayoutStore.getState().treeOpen).toBe(true);
    useLayoutStore.getState().toggleTree();
    expect(useLayoutStore.getState().treeOpen).toBe(false);
  });

  it('module-level toggleTree function works', () => {
    toggleTree();
    expect(useLayoutStore.getState().treeOpen).toBe(true);
  });

  it('setTreeOpen explicit', () => {
    useLayoutStore.getState().setTreeOpen(true);
    expect(useLayoutStore.getState().treeOpen).toBe(true);
  });
});
