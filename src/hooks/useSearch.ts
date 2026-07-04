/**
 * useSearch — T10 页内查找状态机 (设计 §3.1 / §4.1 / §5).
 *
 * 设计依据: docs/design/compiled.md §3.1 + §4.1 + §5 + §6.
 *
 * 责任:
 *   - 关键字匹配 + 选项 (caseSensitive / wholeWord / regex) 状态机.
 *   - 命中数组 + 当前下标 + 上下跳转 + 平滑滚动.
 *   - 性能: 50ms debounce + useMemo, 10万字符 ≤200ms 呈现.
 *   - 单例: 多个调用者共享同一份搜索状态 (与 useImageViewer 同模式).
 *
 * 关键约定:
 *   - `useSearch(content)`: 接收当前文档 content, 用于命中计算 + 文档切换检测.
 *     调用者应是持有 content 的组件 (Reader); 调用多次 (SearchBar 也调) 不会
 *     重复写 store: 仅当传入的 content 与 store 当前 contentKey 不一致时, 才
 *     把 content 写入 store 并触发 auto-close. SearchBar 调 useSearch() 不传
 *     content 时, 是纯消费者, 不写 store.
 *
 *   - 切换 content 时自动 close (NFR-04-1).
 *
 * 纪律:
 *   - 不持有持久化, 不调 IPC.
 *   - 跨节点匹配按节点边界裁剪, 在 searchHighlight wrapper 中处理.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';

/* -------------------------------------------------------------------------- */
/* Public types                                                              */
/* -------------------------------------------------------------------------- */

export interface SearchOptions {
  /** 默认 false. */
  caseSensitive?: boolean;
  /** 默认 false. */
  wholeWord?: boolean;
  /** 默认 false. */
  regex?: boolean;
}

export interface SearchHit {
  /** 命中下标, 从 0 开始 (按 computeHits 返回顺序). */
  index: number;
  /** 在 content 中的起始偏移 (字符). */
  start: number;
  /** 命中长度 (字符). */
  length: number;
}

export interface UseSearchReturn {
  /** 当前输入框关键字 (同步, UI 立即反映). */
  query: string;
  /** 更新 query (同步, 命中通过 debouncedQuery 计算). */
  setQuery: (q: string) => void;
  /** 当前选项. */
  options: SearchOptions;
  /** 设置单个选项. */
  setOption: <K extends keyof SearchOptions>(k: K, v: boolean) => void;
  /** 命中数组 (按 start 升序). */
  hits: SearchHit[];
  /** 命中总数 (clamp 在 [0, MAX_HITS]). */
  count: number;
  /** 当前下标 (0..count-1). */
  currentIndex: number;
  /** SearchBar 是否打开. */
  isOpen: boolean;
  /** 实时读 isOpen 的 getter (供 useKeyboard 等模块订阅, 避免闭包陈旧). */
  isOpenNow: () => boolean;
  /** 打开 SearchBar, focus + select 输入框. */
  open: () => void;
  /** 关闭 SearchBar, 清空关键字与命中. */
  close: () => void;
  /** 下一个匹配 (循环). */
  next: () => void;
  /** 上一个匹配 (循环). */
  prev: () => void;
  /** 触发 scrollIntoView(center) 当前下标对应节点. */
  scrollCurrentIntoView: () => void;
  /** 输入框 ref (供 SearchBar + 快捷键 focus). */
  inputRef: RefObject<HTMLInputElement>;
  /** 正则非法时为 true (UI 提示). */
  invalidRegex: boolean;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers — 暴露以便单测                                                */
/* -------------------------------------------------------------------------- */

const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_ESCAPE_RE, '\\$&');
}

/** 命中数上限, 防止极长文档下视觉/性能崩溃 (设计 §8 / 风险表). */
export const MAX_HITS = 1000;

export interface PatternResult {
  pattern: RegExp | null;
  invalidRegex: boolean;
}

/**
 * 根据 query + options 构造匹配正则.
 *
 *  - empty query → pattern=null, invalidRegex=false
 *  - regex=true 时: query 当作 JS 正则字符串, 编译失败 → invalidRegex=true
 *  - wholeWord=true 时: 在外层包 \\b...\\b (regex 模式下包 (?:...))
 *  - caseSensitive=true 时: flags='g'; 否则 flags='gi'
 */
export function buildPattern(query: string, opts: SearchOptions): PatternResult {
  if (query === '') {
    return { pattern: null, invalidRegex: false };
  }
  const caseSensitive = opts.caseSensitive ?? false;
  const wholeWord = opts.wholeWord ?? false;
  const regex = opts.regex ?? false;
  const flags = caseSensitive ? 'g' : 'gi';

  let body: string;
  if (regex) {
    body = wholeWord ? `\\b(?:${query})\\b` : query;
    try {
      return { pattern: new RegExp(body, flags), invalidRegex: false };
    } catch {
      return { pattern: null, invalidRegex: true };
    }
  }
  const escaped = escapeRegex(query);
  body = wholeWord ? `\\b${escaped}\\b` : escaped;
  return { pattern: new RegExp(body, flags), invalidRegex: false };
}

export interface ComputeHitsResult {
  hits: SearchHit[];
  invalidRegex: boolean;
}

/**
 * 在 content 上按 query+opts 计算命中, 返回 { index, start, length } 数组.
 * - 命中超过 MAX_HITS 截断并 warn (设计 §8).
 * - invalidRegex=true 时直接返回 [].
 */
export function computeHits(
  content: string,
  query: string,
  opts: SearchOptions,
): ComputeHitsResult {
  const { pattern, invalidRegex } = buildPattern(query, opts);
  if (pattern === null) {
    return { hits: [], invalidRegex };
  }
  if (content === '') {
    return { hits: [], invalidRegex: false };
  }

  const hits: SearchHit[] = [];
  let truncated = false;
  // matchAll 必须 pattern.flags 包含 'g'; buildPattern 已保证.
  for (const match of content.matchAll(pattern)) {
    if (hits.length >= MAX_HITS) {
      truncated = true;
      break;
    }
    const idx = match.index ?? 0;
    const len = match[0]?.length ?? 0;
    if (len === 0) {
      // 0-width match: 防死循环, 直接终止 (极少见, 例如 query='^' 等).
      break;
    }
    hits.push({ index: hits.length, start: idx, length: len });
  }
  if (truncated) {
    console.warn(`too many hits, truncated to ${MAX_HITS}`);
  }
  return { hits, invalidRegex: false };
}

/* -------------------------------------------------------------------------- */
/* Module-scoped store — 多调用方共享一份搜索状态                             */
/* -------------------------------------------------------------------------- */

interface InternalState {
  content: string;
  query: string;
  debouncedQuery: string;
  options: SearchOptions;
  isOpen: boolean;
  currentIndex: number;
}

const DEFAULT_STATE: InternalState = {
  content: '',
  query: '',
  debouncedQuery: '',
  options: { caseSensitive: false, wholeWord: false, regex: false },
  isOpen: false,
  currentIndex: 0,
};

let _state: InternalState = DEFAULT_STATE;
const _listeners = new Set<() => void>();

function setState(patch: Partial<InternalState>): void {
  _state = { ..._state, ...patch };
  for (const l of _listeners) l();
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

function getSnapshot(): InternalState {
  return _state;
}

function getServerSnapshot(): InternalState {
  return DEFAULT_STATE;
}

/** 仅测试使用: 重置模块级状态. */
export function __resetSearchForTest(): void {
  _state = DEFAULT_STATE;
  _listeners.clear();
  _inputRef.current = null;
}

/* -------------------------------------------------------------------------- */
/* Input ref — 模块作用域, 跨调用方共享                                       */
/* -------------------------------------------------------------------------- */

const _inputRef: { current: HTMLInputElement | null } = { current: null };

/** 暴露给 useKeyboard 等其它模块复用同一个 ref. */
export function getSearchInputRef(): { current: HTMLInputElement | null } {
  return _inputRef;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 订阅搜索状态.
 *
 * - 传 content (如 Reader): 用作命中计算 + 文档切换检测 (NFR-04-1: content 变即 auto-close).
 * - 不传 content (如 SearchBar): 纯消费, 不写 store; 状态完全由前者驱动.
 */
export function useSearch(content?: string): UseSearchReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // ---- 1. content 同步 (仅当 content 提供且与 store 不同) ----
  // 严格避免 SearchBar 等纯消费者误覆盖 store.
  const prevContentRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (content === undefined) return; // SearchBar 模式: 不写 store.
    if (prevContentRef.current === undefined) {
      // 首次挂载: 接管 store content.
      prevContentRef.current = content;
      setState({ content });
      return;
    }
    if (prevContentRef.current !== content) {
      // 文档切换: auto-close + 同步.
      prevContentRef.current = content;
      setState({
        content,
        query: '',
        debouncedQuery: '',
        isOpen: false,
        currentIndex: 0,
      });
    }
  }, [content]);

  // ---- 2. debouncedQuery (50ms) ----
  // 仅在 query 由 content 提供者驱动时计算.
  useEffect(() => {
    // 清空 query 走同步, 立即反映在 wrapper (AC-02-3).
    if (state.query === '') {
      setState({ debouncedQuery: '' });
      return undefined;
    }
    const t = setTimeout(() => {
      setState({ debouncedQuery: state.query });
    }, 50);
    return () => clearTimeout(t);
  }, [state.query]);

  // ---- 3. 命中计算 (useMemo 替代 useSyncExternalStore 状态, 因与 content 耦合) ----
  const { hits, invalidRegex } = useMemo(() => {
    const r = computeHits(state.content, state.debouncedQuery, state.options);
    return { hits: r.hits, invalidRegex: r.invalidRegex };
  }, [state.content, state.debouncedQuery, state.options.caseSensitive, state.options.wholeWord, state.options.regex]);

  // ---- 4. count + currentIndex 边界调整 ----
  const count = hits.length;
  const clampedCurrent = useMemo(() => {
    if (count === 0) return 0;
    if (state.currentIndex >= count) return 0;
    return state.currentIndex;
  }, [count, state.currentIndex]);

  useEffect(() => {
    if (clampedCurrent !== state.currentIndex) {
      setState({ currentIndex: clampedCurrent });
    }
  }, [clampedCurrent, state.currentIndex]);

  // ---- 5. actions ----
  const setQuery = useCallback((q: string): void => {
    setState({ query: q });
  }, []);

  const setOption = useCallback(
    <K extends keyof SearchOptions>(k: K, v: boolean): void => {
      // 选项变更不走 debounce (设计 §4.2): 立即重算.
      // 直接把 query 同步到 debouncedQuery (若 query 非空), 让 useMemo 立即看到新组合.
      setState({
        options: { ..._state.options, [k]: v },
        debouncedQuery: _state.query,
        currentIndex: 0,
      });
    },
    [],
  );

  const open = useCallback((): void => {
    setState({ isOpen: true });
    // 焦点注入由 SearchBar 自己负责 (SearchBar 知道 input 何时挂载).
    // 这里只负责开关 isOpen. SearchBar 会在 isOpen=true 且 input 挂载时自动 focus.
  }, []);

  const close = useCallback((): void => {
    setState({
      isOpen: false,
      query: '',
      debouncedQuery: '',
      currentIndex: 0,
    });
    if (typeof document !== 'undefined') {
      const el = _inputRef.current;
      if (el && document.activeElement === el) {
        el.blur();
      }
    }
  }, []);

  const next = useCallback((): void => {
    if (count === 0) return;
    const ni = (state.currentIndex + 1) % count;
    setState({ currentIndex: ni });
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        const el = document.querySelector(`[data-search-hit="${ni}"]`);
        if (!el) {
          console.warn('search target missing, retrying');
          return;
        }
        const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
        (el as HTMLElement).scrollIntoView({ behavior, block: 'center' });
      });
    }
  }, [count, state.currentIndex]);

  const prev = useCallback((): void => {
    if (count === 0) return;
    const pi = (state.currentIndex - 1 + count) % count;
    setState({ currentIndex: pi });
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        const el = document.querySelector(`[data-search-hit="${pi}"]`);
        if (!el) {
          console.warn('search target missing, retrying');
          return;
        }
        const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
        (el as HTMLElement).scrollIntoView({ behavior, block: 'center' });
      });
    }
  }, [count, state.currentIndex]);

  const scrollCurrentIntoView = useCallback((): void => {
    const idx = state.currentIndex;
    if (typeof document === 'undefined') return;
    const el = document.querySelector(`[data-search-hit="${idx}"]`);
    if (!el) {
      console.warn('search target missing, retrying');
      return;
    }
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    (el as HTMLElement).scrollIntoView({ behavior, block: 'center' });
  }, [state.currentIndex]);

  // ---- 6. inputRef ----
  const inputRef = useRef<HTMLInputElement | null>(null);
  // useLayoutEffect 同步 (DOM mutation 之后立即执行), 保证 rAF / open() 读取时 _inputRef 已更新.
  useLayoutEffect(() => {
    _inputRef.current = inputRef.current;
    return () => {
      if (_inputRef.current === inputRef.current) {
        _inputRef.current = null;
      }
    };
  });

  return {
    query: state.query,
    setQuery,
    options: state.options,
    setOption,
    hits,
    count,
    currentIndex: clampedCurrent,
    isOpen: state.isOpen,
    isOpenNow: () => _state.isOpen,
    open,
    close,
    next,
    prev,
    scrollCurrentIntoView,
    inputRef,
    invalidRegex,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default useSearch;