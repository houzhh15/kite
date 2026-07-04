/**
 * useKeyboard — T11 全局键盘快捷键统一注册表 (设计 §3.3).
 *
 * 设计依据: docs/design/compiled.md §3.3 + §3.5 + 需求 FR-01..FR-13.
 *
 * 责任 (T11 升级):
 *   - 注册 10 条全局快捷键: Cmd/Ctrl+O/F/=/-/0/Shift+L/Shift+P/Home/End/Esc.
 *   - 平台修饰键归一化: macOS metaKey, Win/Linux ctrlKey.
 *   - 表单守卫 (input/textarea/contentEditable): 默认跳过; `find` 与 `closeOverlay` 例外.
 *   - IME 守卫: e.isComposing → 跳过.
 *   - 重复注册: 先 removeEventListener 旧 listener.
 *
 * T10 兼容:
 *   - 保留 registerSearchShortcuts / unregisterSearchShortcuts / useKeyboard 现有导出.
 *   - registerSearchShortcuts 内部现在也通过新 SHORTCUTS 注册 (id=find/closeOverlay),
 *     T10 的 useSearch.close() 通过 closeTopOverlay 委托; 行为与 T10 一致 (F/Esc).
 *
 * 模式: 模块级 register/unregister, 在 App mount 调用一次.
 */

import { useEffect } from 'react';

import { useSearch, getSearchInputRef } from './useSearch';
import { SHORTCUTS, isMac, type ShortcutId } from '../lib/shortcuts';
import { useRecentStore } from '../stores/recentStore';

interface SearchShortcutsApi {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
}

/**
 * 全局快捷键 api (T11 扩展, 设计 §3.3.3).
 */
export interface KeyboardShortcutApi {
  /** SearchBar 是否打开 (委托 useSearch 单例). */
  isSearchOpen: () => boolean;
  /** 打开 SearchBar. */
  openSearch: () => void;
  /** 关闭 SearchBar; 返回是否实际关闭. */
  closeSearch: () => boolean;
  /**
   * 关闭最上层浮层 (ImageViewer > SearchBar > RecentDrawer).
   * 返回 true 表示关闭了某个浮层, false 表示无浮层可关 (Esc no-op).
   */
  closeTopOverlay: () => boolean;
  /** 触发 open file dialog (T10 useMarkdownDoc.open). */
  openFile: () => Promise<void> | void;
  /** 调字号: delta=1 → +1, delta=-1 → -1, delta=0 → reset to 16. */
  bumpFontSize: (delta: 1 | -1 | 0) => void;
  /** 主题三档循环. */
  cycleTheme: () => void;
  /** 打开最近文件抽屉 (CustomEvent kite:open-recent-drawer). */
  openRecentDrawer: () => void;
  /** 滚动 Reader 到顶 / 底. */
  scrollReaderTo: (pos: 'top' | 'bottom') => void;
  /** 取 Reader 滚动容器 (供 scrollReaderTo). */
  getReaderScrollEl: () => HTMLElement | null;
  /** T15 (FR-01): 切换目录树抽屉 (Ctrl/Cmd+T). */
  toggleTree: () => void;
  /** T15 (FR-04): 后退一步 (Ctrl/Cmd+[). */
  historyBack: () => void;
  /** T15 (FR-04): 前进一步 (Ctrl/Cmd+]). */
  historyForward: () => void;
  /** T16-P2 (FR-03): 切换全屏 (macOS Cmd+Ctrl+F / Win/Linux F11). */
  toggleFullscreen: () => void;
}

/**
 * 当前注册的 API. api 通过 *函数* (而非 boolean) 暴露 isOpen,
 * 这样 listener 总能读到最新 store state, 避免快照陈旧问题.
 */
let _globalApi: KeyboardShortcutApi | null = null;
let _globalListener: ((e: KeyboardEvent) => void) | null = null;
let _searchApi: SearchShortcutsApi | null = null;
let _searchListener: ((e: KeyboardEvent) => void) | null = null;

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * 判断 target 是否是 radio / radiogroup 内元素.
 * T12: 设置面板里的 radiogroup 焦点态不应被 Cmd+/-/0 劫持 (AC-05-3).
 */
function isRadioTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.getAttribute('role') === 'radio') return true;
  // 也排除 radiogroup 容器本身 (焦点在 radiogroup 容器时).
  if (target.getAttribute('role') === 'radiogroup') return true;
  return false;
}

function isModifierPressed(e: KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

function matchShortcut(e: KeyboardEvent, def: (typeof SHORTCUTS)[number]): boolean {
  // IME 守卫.
  if (e.isComposing) return false;
  // 表单守卫.
  if (isFormField(e.target) && !def.allowInForm) return false;
  // T12 AC-05-3: 焦点在 radio / radiogroup 上时, Cmd± 也不劫持 (让用户用 Arrow 调).
  if (isRadioTarget(e.target) && (def.id === 'zoomIn' || def.id === 'zoomOut' || def.id === 'zoomReset')) {
    return false;
  }

  const key = e.key.toLowerCase();
  if (key !== def.key) return false;

  // modifier 守卫.
  if (def.modifier === 'mod') {
    if (!isModifierPressed(e)) return false;
  } else {
    if (isModifierPressed(e)) return false;
  }

  // shift 守卫 (default: false).
  const wantShift = def.shift === true;
  if (e.shiftKey !== wantShift) return false;

  // alt / ctrl+meta 双按 仅 Shift+L / Shift+P 接受其它组合, 这里 Alt 一律拒绝 (避免 ⌘⌥ 误触).
  if (e.altKey) return false;

  return true;
}

function invokeGlobalAction(id: ShortcutId, api: KeyboardShortcutApi): void {
  switch (id) {
    case 'open':
      void api.openFile();
      return;
    case 'find':
      api.openSearch();
      return;
    case 'zoomIn':
      api.bumpFontSize(1);
      return;
    case 'zoomOut':
      api.bumpFontSize(-1);
      return;
    case 'zoomReset':
      api.bumpFontSize(0);
      return;
    case 'cycleTheme':
      api.cycleTheme();
      return;
    case 'recentDrawer':
      api.openRecentDrawer();
      return;
    case 'scrollTop':
      api.scrollReaderTo('top');
      return;
    case 'scrollBottom':
      api.scrollReaderTo('bottom');
      return;
    case 'closeOverlay':
      api.closeTopOverlay();
      return;
    case 'toggleTree':
      api.toggleTree();
      return;
    case 'historyBack':
      api.historyBack();
      return;
    case 'historyForward':
      api.historyForward();
      return;
    case 'toggleFullscreen':
      api.toggleFullscreen();
      return;
    default: {
      // exhaustiveness: never.
      const _x: never = id;
      void _x;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Global listener                                                            */
/* -------------------------------------------------------------------------- */

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (!_globalApi) return;
  for (const def of SHORTCUTS) {
    if (!matchShortcut(e, def)) continue;
    if (def.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      invokeGlobalAction(def.id, _globalApi);
    } catch (err) {
      console.warn(`[useKeyboard] action ${def.id} threw:`, err);
    }
    return;
  }
}

/**
 * 注册全局快捷键 (T11 统一注册表).
 *
 * 重复调用: 先 removeEventListener 旧 listener, 再 addEventListener 新引用
 * (NFR-Robust-1 防泄漏).
 */
export function registerGlobalShortcuts(api: KeyboardShortcutApi): void {
  if (typeof window === 'undefined') return;
  if (_globalListener) {
    window.removeEventListener('keydown', _globalListener, true);
    _globalListener = null;
  }
  _globalApi = api;
  _globalListener = onGlobalKeyDown;
  window.addEventListener('keydown', _globalListener, true);
}

export function unregisterGlobalShortcuts(): void {
  if (typeof window === 'undefined') return;
  if (_globalListener) {
    window.removeEventListener('keydown', _globalListener, true);
    _globalListener = null;
  }
  _globalApi = null;
}

/* -------------------------------------------------------------------------- */
/* T10 兼容导出: SearchBar 浮层快捷键 (F / Esc)                                */
/* -------------------------------------------------------------------------- */

function onSearchKeyDown(e: KeyboardEvent): void {
  if (!_searchApi) return;
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  // Cmd+F / Ctrl+F: 唤起, 阻止浏览器面板.
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    e.stopPropagation();
    _searchApi.open();
    return;
  }
  // Esc: 仅当 SearchBar 打开时关闭. 即便焦点在 input 中, SearchBar 仍可关闭.
  if (e.key === 'Escape' && _searchApi.isOpen()) {
    e.preventDefault();
    _searchApi.close();
  }
}

/**
 * 注册页内查找快捷键 (T10 兼容面, 设计 §3.5.1).
 *
 * 内部仅处理 F 与 Esc 两条; 其余快捷键由 registerGlobalShortcuts 接管.
 * 调用方应在 Layout mount 时调用一次, unmount 时调 unregisterSearchShortcuts().
 */
export function registerSearchShortcuts(api: SearchShortcutsApi): void {
  if (typeof window === 'undefined') return;
  if (_searchListener) {
    window.removeEventListener('keydown', _searchListener, true);
    _searchListener = null;
  }
  _searchApi = api;
  _searchListener = onSearchKeyDown;
  window.addEventListener('keydown', _searchListener, true);
}

export function unregisterSearchShortcuts(): void {
  if (typeof window === 'undefined') return;
  if (_searchListener) {
    window.removeEventListener('keydown', _searchListener, true);
    _searchListener = null;
  }
  _searchApi = null;
}

/* -------------------------------------------------------------------------- */
/* Hook 默认导出                                                              */
/* -------------------------------------------------------------------------- */

/**
 * useKeyboard hook — 顶层挂载入口, 在 App 调一次.
 *
 * 内部行为:
 *   - 调 useSearch() 订阅 + 注册 search-specific 快捷键 (F/Esc).
 *   - **不** 调用 registerGlobalShortcuts (该 API 由 App 在 useEffect 内手动调用,
 *     因为需要把 openFile/cycleTheme/... 这些依赖具体 hook 调用的 callback 注入).
 */
export function useKeyboard(): void {
  const search = useSearch();

  useEffect(() => {
    registerSearchShortcuts({
      isOpen: search.isOpenNow,
      open: search.open,
      close: search.close,
    });
    return () => {
      unregisterSearchShortcuts();
    };
  }, [search.open, search.close, search.isOpenNow]);
}

/* -------------------------------------------------------------------------- */
/* 额外暴露: ref 转发检查 (供 SearchBar focus 时复用)                        */
/* -------------------------------------------------------------------------- */

export { getSearchInputRef };

export default useKeyboard;

/* -------------------------------------------------------------------------- */
/* 测试用: 重置模块级状态                                                    */
/* -------------------------------------------------------------------------- */

export function __resetKeyboardForTest(): void {
  unregisterSearchShortcuts();
  unregisterGlobalShortcuts();
}

/* -------------------------------------------------------------------------- */
/* 便捷 helper: 从 useRecentStore 暴露 openDrawer (供 App 注入 api).          */
/* -------------------------------------------------------------------------- */

/**
 * 把 useRecentStore.openDrawer() 暴露给全局快捷键. 当前 useRecentStore 没有
 * openDrawer action; 通过 CustomEvent `kite:open-recent-drawer` 让 Toolbar
 * (或 App) 接收并切换 recentOpen 状态.
 */
export function openRecentDrawerViaEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('kite:open-recent-drawer'));
}

/** 兼容 useRecentStore re-export, 避免循环依赖时 toolbar 已 import 它. */
export { useRecentStore };