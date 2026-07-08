/**
 * vaultRoot 单测 — F-29 / FR-03 / AC-03-1~4.
 *
 * 设计依据: docs/design/compiled.md §3.3.
 *
 * 覆盖:
 *   - deriveVaultRoot: 4 种契约 (custom + 合法 / custom + null / follow-current + current / 都无)
 *   - useVaultRoot hook 集成: 订阅 currentPath 变化即时生效; 持久化字段读写
 *   - isValidVaultPath: 边界 (空 / 相对 / .. / 盘符 / 反斜杠 / 超长)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePrefStore, isValidVaultPath } from '../../../stores/prefStore';
import { useDocStore } from '../../../stores/docStore';
import { useVaultRoot, deriveVaultRoot } from '../vaultRoot';

describe('deriveVaultRoot (pure helper)', () => {
  it('AC-03-2: custom 模式 + 合法 customPath → customPath', () => {
    expect(deriveVaultRoot('custom', '/Users/me/vault', '/whatever')).toBe('/Users/me/vault');
  });

  it('AC-03-2: custom 模式 + 合法 customPath + currentPath=null → customPath', () => {
    expect(deriveVaultRoot('custom', '/Users/me/vault', null)).toBe('/Users/me/vault');
  });

  it('custom 模式 + null customPath → 降级为 follow-current', () => {
    expect(deriveVaultRoot('custom', null, '/a/b/c.md')).toBe('/a/b');
  });

  it('custom 模式 + 非法 customPath → 降级为 follow-current', () => {
    expect(deriveVaultRoot('custom', '../../etc', '/a/b/c.md')).toBe('/a/b');
  });

  it('AC-03-1: follow-current + currentPath → dirname', () => {
    expect(deriveVaultRoot('follow-current', null, '/vault/daily/2025-01-01.md')).toBe('/vault/daily');
  });

  it('AC-03-3: follow-current + currentPath=null → null', () => {
    expect(deriveVaultRoot('follow-current', null, null)).toBeNull();
  });

  it('follow-current + currentPath 在 vault 根 → 返回 /', () => {
    expect(deriveVaultRoot('follow-current', null, '/foo.md')).toBe('/');
  });
});

describe('isValidVaultPath', () => {
  it('接受绝对路径', () => {
    expect(isValidVaultPath('/Users/me/vault')).toBe(true);
  });
  it('接受 / 单字符根', () => {
    expect(isValidVaultPath('/')).toBe(true);
  });
  it('拒绝空串', () => {
    expect(isValidVaultPath('')).toBe(false);
  });
  it('拒绝 null', () => {
    expect(isValidVaultPath(null)).toBe(false);
  });
  it('拒绝 undefined', () => {
    expect(isValidVaultPath(undefined)).toBe(false);
  });
  it('拒绝非字符串 (数字)', () => {
    expect(isValidVaultPath(123)).toBe(false);
  });
  it('拒绝相对路径', () => {
    expect(isValidVaultPath('relative/path')).toBe(false);
  });
  it('拒绝含 .. 段', () => {
    expect(isValidVaultPath('/Users/me/../etc')).toBe(false);
  });
  it('拒绝反斜杠', () => {
    expect(isValidVaultPath('C:\\Users\\me')).toBe(false);
  });
  it('拒绝 Windows 盘符', () => {
    expect(isValidVaultPath('C:/Users/me')).toBe(false);
  });
  it('拒绝超长 1025 字符', () => {
    expect(isValidVaultPath('/' + 'a'.repeat(1024))).toBe(false);
  });
  it('接受临界 1024 字符', () => {
    expect(isValidVaultPath('/' + 'a'.repeat(1023))).toBe(true);
  });
});

describe('useVaultRoot hook', () => {
  beforeEach(() => {
    // 重置 store 到初始态, 避免 hydrate 脏数据
    usePrefStore.setState({
      prefs: { ...usePrefStore.getState().prefs, vaultRootMode: 'follow-current', vaultRootCustom: null },
      hydrated: true,
    });
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
    });
  });

  it('AC-03-1: default follow-current + 打开 /vault/daily/2025-01-01.md → root=/vault/daily', () => {
    act(() => {
      useDocStore.setState({ state: { ...useDocStore.getState().state, currentPath: '/vault/daily/2025-01-01.md' } });
    });
    const { result } = renderHook(() => useVaultRoot());
    expect(result.current.root).toBe('/vault/daily');
    expect(result.current.mode).toBe('follow-current');
  });

  it('AC-03-3: 无 currentPath + follow-current → null', () => {
    const { result } = renderHook(() => useVaultRoot());
    expect(result.current.root).toBeNull();
  });

  it('AC-03-2: custom 模式 + 写入 customPath → root 立即为新值', () => {
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/Users/me/obsidian-vault');
    });
    expect(result.current.root).toBe('/Users/me/obsidian-vault');
  });

  it('AC-03-4: setCustomPath 非法路径 (相对) → 拒绝, root 保持前值', () => {
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/valid/path');
    });
    const before = result.current.root;
    act(() => {
      result.current.setCustomPath('../../etc');
    });
    expect(result.current.root).toBe(before);
  });

  it('AC-03-4: setCustomPath 空串 → 拒绝, root 保持前值', () => {
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/valid/path');
    });
    const before = result.current.root;
    act(() => {
      result.current.setCustomPath('');
    });
    expect(result.current.root).toBe(before);
  });

  it('AC-03-4: setCustomPath 非字符串 (数字) → 拒绝, root 保持前值', () => {
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/valid/path');
    });
    const before = result.current.root;
    act(() => {
      result.current.setCustomPath(123 as unknown as string);
    });
    expect(result.current.root).toBe(before);
  });

  it('setCustomPath(null) → 清空 customPath', () => {
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/valid/path');
    });
    expect(result.current.root).toBe('/valid/path');
    act(() => {
      result.current.setCustomPath(null);
    });
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBeNull();
  });

  it('currentPath 变化即时生效 (订阅机制)', () => {
    const { result } = renderHook(() => useVaultRoot());
    expect(result.current.root).toBeNull();
    act(() => {
      useDocStore.setState({ state: { ...useDocStore.getState().state, currentPath: '/foo/bar.md' } });
    });
    expect(result.current.root).toBe('/foo');
  });

  it('custom 模式 + customPath 指向不存在目录 → 仍以 customPath 为 root (运行时检查交给 Settings 一次性提示)', () => {
    // 设计: deriveVaultRoot 仅做路径字符串校验; 目录存在性由 Settings 在 hydrate 时检查.
    const { result } = renderHook(() => useVaultRoot());
    act(() => {
      result.current.setMode('custom');
      result.current.setCustomPath('/this/path/may/not/exist');
    });
    expect(result.current.root).toBe('/this/path/may/not/exist');
  });
});

describe('prefStore 持久化字段 (F-29)', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: { ...usePrefStore.getState().prefs, vaultRootMode: 'follow-current', vaultRootCustom: null },
    });
  });

  it('setVaultRootMode 合法值写入', () => {
    usePrefStore.getState().setVaultRootMode('custom');
    expect(usePrefStore.getState().prefs.vaultRootMode).toBe('custom');
  });

  it('setVaultRootMode 非法值拒绝', () => {
    usePrefStore.getState().setVaultRootMode('invalid' as never);
    expect(usePrefStore.getState().prefs.vaultRootMode).toBe('follow-current');
  });

  it('setVaultRootCustom 合法绝对路径写入', () => {
    usePrefStore.getState().setVaultRootCustom('/Users/me/vault');
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBe('/Users/me/vault');
  });

  it('setVaultRootCustom 相对路径拒绝', () => {
    usePrefStore.getState().setVaultRootCustom('relative/path');
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBeNull();
  });

  it('hydrate 注入 vaultRootMode + vaultRootCustom', () => {
    usePrefStore.getState().hydrate({
      vaultRootMode: 'custom',
      vaultRootCustom: '/Users/me/vault',
    } as never);
    expect(usePrefStore.getState().prefs.vaultRootMode).toBe('custom');
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBe('/Users/me/vault');
  });

  it('hydrate 非法 vaultRootCustom 降级为 null', () => {
    usePrefStore.getState().hydrate({
      vaultRootCustom: '../../etc',
    } as never);
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBeNull();
  });

  it('hydrate 缺字段保留当前值', () => {
    usePrefStore.getState().setVaultRootMode('custom');
    usePrefStore.getState().setVaultRootCustom('/Users/me/vault');
    usePrefStore.getState().hydrate({} as never);
    expect(usePrefStore.getState().prefs.vaultRootMode).toBe('custom');
    expect(usePrefStore.getState().prefs.vaultRootCustom).toBe('/Users/me/vault');
  });
});
