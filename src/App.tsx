/**
 * App — 顶层装配 (T02 / T06 / T08 / T09 / T10 / T11).
 *
 * 设计依据: docs/design/compiled.md §3.4 + docs/plan/compiled.md Step 7 / Step 8 / Step 13.
 *
 * 三层结构:
 *   <Toaster />            — 全局 toast 列表.
 *   <Toolbar />            — 顶栏 (受控 onOpen + disabled=loading + 最近文件下拉).
 *   <Reader />             — 状态分发 (idle/loading/ok/error). T09: 嵌入 Outline/ProgressBar.
 *   <StatusBar />          — T09: 接收 progress + content 渲染顶部百分比 / 字数 / 行数.
 *   <ImageViewer />        — T08 step-4: 单例全屏模态 (随 useImageViewer 状态挂载).
 *   <SearchBar />          — T10: 页内查找浮层 (useSearch 单例 store 消费者).
 *   <ShortcutsHint />      — T11: 首启快捷键速查浮层 (基于 seenShortcutsHint).
 *
 * T10 增量:
 *   - useKeyboard() 在顶层挂载, 注册 Ctrl/Cmd+F 与 Esc 全局快捷键.
 *   - SearchBar 浮层挂在 App 顶层 (z-index 高于 Reader), 不破坏阅读布局.
 *   - Reader 内部通过 useSearch(content) 写入 content, 并用 <SearchHighlight>
 *     包裹 MarkdownRenderer 实现命中高亮注入 (post-render DOM 注入).
 *
 * T11 增量:
 *   - useProgress() 订阅 useScrollSpy.progress → progressStore (300ms debounce 落盘).
 *   - registerGlobalShortcuts(api) 注入 10 条快捷键 (open/find/zoom/theme/recent/scroll/esc).
 *   - tryRestoreLastPath() 在 progressStore.hydrated=true 后调一次 (FR-10).
 *   - restoreScrollAfterOpen() 在 Reader onMounted 后调一次 (FR-10).
 *   - ShortcutsHint 挂在顶层, hydrated 后判断是否首启.
 */

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Toaster } from './components/Toaster';
import { Toolbar } from './components/Toolbar';
import { SkipLink } from './components/SkipLink';
import { Reader } from './components/Reader';
import { DragOverlay } from './components/DragOverlay';
import { StatusBar } from './components/StatusBar';
import { LinkTooltip } from './components/inline/LinkTooltip';
import { ImageViewer } from './components/ImageViewer';
import { SearchBar } from './components/SearchBar';
import { ShortcutsHint } from './components/ShortcutsHint';
// T15 (FR-01): React.lazy 接入 FileTree, 不阻塞首屏.
const FileTreeLazy = lazy(() => import('./components/FileTree').then((m) => ({ default: m.FileTree })));
import { useMarkdownDoc } from './hooks/useMarkdownDoc';
import { usePreferences } from './hooks/usePreferences';
import { useTheme } from './hooks/useTheme';
import { useFileDrop, createFileDropSource } from './hooks/useFileDrop';
import { useImageViewer } from './hooks/useImageViewer';
import { useProgress } from './hooks/useProgress';
import { useReaderFontSize } from './hooks/useReaderFontSize';
import { useReaderLineHeight } from './hooks/useReaderLineHeight';
import { useReaderCodeFontSize } from './hooks/useReaderCodeFontSize';
import { useFullscreen } from './hooks/useFullscreen';
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
  type KeyboardShortcutApi,
} from './hooks/useKeyboard';
import { useDocStore } from './stores/docStore';
import { cycleTheme, usePrefStore } from './stores/prefStore';
import { useProgressStore } from './stores/progressStore';
import { useRecentStore } from './stores/recentStore';
import { useLayoutStore } from './stores/layoutStore';
import { useImageViewer as useImageViewerHook } from './hooks/useImageViewer';
import { useSearch } from './hooks/useSearch';
import { loadProgress, tauri as tauriApi, getPendingOpenFile } from './lib/tauri';
import { imageCache } from './lib/imageCache';
import { setWindowTitle } from './lib/window';
import { pushToast } from './lib/toast';
import { listen as tauriListen } from '@tauri-apps/api/event';

export default function App(): JSX.Element {
  const { t } = useTranslation(); // T18 (FR-02): 4 个 toast 文案通过 t('app.*') 取值.
  usePreferences(); // T04: 顶层挂载, 启动 hydrate + 订阅 store debounced save.
  useTheme(); // T03 step-10: 单行订阅, 不修改 JSX.
  // T21 (R-05 修复): 目录树根目录 — 不再是硬编码 null 占位.
  // 文件夹按钮 → treeOpen=true 触发 FileTree 渲染空态; 空态里点 "选择文件夹" 触发
  // Tauri directory dialog, 选完后 setTreeRootPath → FileTree 重渲染为目录树.
  const [treeRootPath, setTreeRootPath] = useState<string | null>(null);
  const treeOpen = useLayoutStore((s) => s.treeOpen);
  // T02: useMarkdownDoc 是文档加载的单一状态机入口. 必须先解构 loadFile,
  // 才能给 useFileDrop 注入 onFilePicked (R-07 修复, 否则 TDZ ReferenceError).
  const { state, open, retry, loadFile, tryRestoreLastPath, restoreScrollAfterOpen } = useMarkdownDoc();
  // R-07 修复: 拖拽必须走 useMarkdownDoc.loadFile, 让 reducer state 与 useDocStore 同步刷新.
  // Reader 渲染来源是 useMarkdownDoc reducer (state.doc.content), 不是 useDocStore —
  // 之前 useFileDrop 内部直接 setContent, 会导致「docStore 已切换, Reader 还显示旧文件」.
  useFileDrop(createFileDropSource, { onFilePicked: loadFile });
  // T12: 三个订阅型 hook 把档位写入 CSS 变量/根字号 (设计 §3.6.4-6).
  useReaderFontSize();
  useReaderLineHeight();
  useReaderCodeFontSize();
  const viewer = useImageViewer(); // T08: 订阅 image viewer 单例 store.
  const search = useSearch();
  // T16-P2 (FR-03): 全屏状态机在顶层挂载, 供快捷键 API 调用.
  const fullscreen = useFullscreen();
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // T06: F-16 窗口标题联动.
  const docTitle = useDocStore((s) => s.state.title);
  useEffect(() => {
    void setWindowTitle(docTitle).catch((e) =>
      console.warn('[App] setWindowTitle failed:', e),
    );
  }, [docTitle]);

  // T08 step-5 (R-4 缓解): 文档切换 (currentPath 变化) 时清空 imageCache.
  const currentPath = useDocStore((s) => s.state.currentPath);
  useEffect(() => {
    imageCache.clear();
  }, [currentPath]);

  // T11: 启动 hydrate progressStore (FR-09 / FR-10 / FR-12).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadProgress();
        if (cancelled) return;
        useProgressStore.getState().hydrate(raw);
      } catch (err) {
        if (cancelled) return;
        const msg =
          typeof err === 'object' && err && 'code' in err && (err as { code: unknown }).code === 'ENCODING'
            ? t('app.progressCorrupted')
            : t('app.progressCorrupted');
        useProgressStore.getState().resetCorrupted(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // T11: progressStore.hydrated=true 后, 一次性调 tryRestoreLastPath (FR-10).
  const progressHydrated = useProgressStore((s) => s.hydrated);
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (!progressHydrated) return;
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    void tryRestoreLastPath();
  }, [progressHydrated, tryRestoreLastPath]);
  // macOS "open-file" 集成 — 从 Finder 双击 .md 时由 Rust 侧把路径送到前端.
  //   - 冷启动 (cold start): argv 已经被 Rust 侧 cache 进 PendingOpen.
  //     这里 mount 时主动 pull 一次, Rust 内部 take() 保证读后即清.
  //   - 热启动 (warm): app 已在跑, Rust 派发 RunEvent::Opened 后
  //     emit("kite://open-file"). 这里 listen 这个事件持续生效.
  // 两条路径汇合到 loadFile(path), 与 FileTree / RecentList 走同一份代码
  // (runOpen / 写最近文件 / 写历史栈 全自动).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const onOpened = (path: string): void => {
      if (typeof path === 'string' && path.length > 0) {
        void loadFile(path);
      }
    };

    void (async () => {
      // 1) 冷启动 pull; 失败 (非 Tauri / 无挂起文件) 一律静默 —
      //    dev / web 场景下这是预期行为, 不应该弹 toast.
      try {
        const path = await getPendingOpenFile();
        if (typeof path === 'string' && path.length > 0) {
          onOpened(path);
        }
      } catch (err) {
        console.debug('[open-file] getPendingOpenFile:', err);
      }

      // 2) 热启动 listen; 持续生效直到组件卸载.
      try {
        unlisten = await tauriListen<string>('kite://open-file', (e) => {
          onOpened(e.payload);
        });
      } catch (err) {
        console.debug('[open-file] listen:', err);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
    // loadFile 是 useMarkdownDoc 返回的稳定 useCallback, 这里只装一次.
  }, [loadFile]);

  // T11: Reader 挂载完成后, 一次性调 restoreScrollAfterOpen.
  const restoreScrollOnceRef = useRef(false);
  const handleReaderMounted = (): void => {
    if (restoreScrollOnceRef.current) return;
    if (state.status !== 'ok') return;
    restoreScrollOnceRef.current = true;
    restoreScrollAfterOpen();
  };
  // 切换文档时重置一次性 flag.
  useEffect(() => {
    restoreScrollOnceRef.current = false;
  }, [currentPath]);

  // T09: Reader 把 progress / currentId 透传回顶层 (供 StatusBar + T11 占位).
  const [progress, setProgress] = useState(0);
  const docContent = useDocStore((s) => s.state.content);

  const handleCurrentChange = (id: string | null, p: number): void => {
    if (typeof window !== 'undefined') {
      console.debug('[outline] current:', id, 'progress:', p.toFixed(3));
    }
  };

  // T11: useProgress 订阅 useScrollSpy → progressStore (300ms debounce 落盘).
  useProgress({
    scrollContainer: typeof document !== 'undefined'
      ? document.querySelector<HTMLElement>('[data-testid="reader-scroll-container"]')
      : null,
  });

  // T11: 注入 10 条全局快捷键 api (设计 §3.3.3).
  // T15 (FR-01/FR-04): 增加 toggleTree / historyBack / historyForward.
  // 注意: deps 只取 search 的稳定方法 (open/close/isOpenNow) + open + viewer 的稳定引用,
  // 避免 useSearch 返回新对象导致 effect 反复注册/卸载.
  const openSearchFn = search.open;
  const closeSearchFn = search.close;
  const isOpenFn = search.isOpenNow;
  const viewerCurrent = viewer.current;
  const viewerClose = viewer.close;
  useEffect(() => {
    const api: KeyboardShortcutApi = {
      isSearchOpen: isOpenFn,
      openSearch: openSearchFn,
      closeSearch: () => {
        if (!isOpenFn()) return false;
        closeSearchFn();
        return true;
      },
      closeTopOverlay: () => {
        // ImageViewer > SearchBar > RecentDrawer
        if (viewerCurrent) {
          viewerClose();
          return true;
        }
        if (isOpenFn()) {
          closeSearchFn();
          return true;
        }
        if (typeof window !== 'undefined') {
          // RecentDrawer 通过 CustomEvent 让 Toolbar 关闭.
          window.dispatchEvent(new CustomEvent('kite:close-recent-drawer'));
          return false;
        }
        return false;
      },
      openFile: () => {
        void open();
      },
      bumpFontSize: (delta) => {
        if (delta === 0) {
          // T12: Cmd/Ctrl+0 触发 resetReadingPrefs (字号 + 行高 + 代码块字号回默认).
          usePrefStore.getState().resetReadingPrefs();
          return;
        }
        const before = usePrefStore.getState().prefs.fontSizeId;
        usePrefStore.getState().cycleFontSize(delta);
        const after = usePrefStore.getState().prefs.fontSizeId;
        // 上限/下限钳制提示
        if (before === after) {
          pushToast({
            kind: 'info',
            message: delta > 0 ? t('app.fontSizeMax') : t('app.fontSizeMin'),
          });
        }
      },
      cycleTheme: () => {
        cycleTheme();
      },
      openRecentDrawer: () => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('kite:open-recent-drawer'));
      },
      scrollReaderTo: (pos) => {
        const container = scrollContainerRef.current
          ?? (typeof document !== 'undefined'
            ? document.querySelector<HTMLElement>('[data-testid="reader-scroll-container"]')
            : null);
        if (!container) return;
        if (pos === 'top') {
          container.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
      },
      getReaderScrollEl: () => scrollContainerRef.current,
      // T15 (FR-01): Ctrl/Cmd+T 切换目录树.
      toggleTree: () => {
        useLayoutStore.getState().toggleTree();
      },
      // T15 (FR-04): 历史后退. 先检查 useDocStore 的 canGoBack (history 是单一来源),
      // 拿到目标路径 → 走 useMarkdownDoc.loadFile 让 Reader 渲染也跟着切换 (R-04).
      historyBack: () => {
        const docState = useDocStore.getState();
        if (!docState.canGoBack()) {
          pushToast({ kind: 'info', message: t('app.historyStart') });
          return;
        }
        // 同步把 cursor 移到目标位置, 再异步 load (与 useDocStore.moveCursor 行为一致).
        const nextCursor = docState.cursor - 1;
        useDocStore.setState(() => ({ cursor: nextCursor }));
        const target = useDocStore.getState().history[nextCursor];
        if (target) void loadFile(target);
      },
      // T15 (FR-04): 历史前进. 同上, 但 delta=+1.
      historyForward: () => {
        const docState = useDocStore.getState();
        if (!docState.canGoForward()) {
          pushToast({ kind: 'info', message: t('app.historyEnd') });
          return;
        }
        const nextCursor = docState.cursor + 1;
        useDocStore.setState(() => ({ cursor: nextCursor }));
        const target = useDocStore.getState().history[nextCursor];
        if (target) void loadFile(target);
      },
      // T16-P2 (FR-03): 切换全屏 (Cmd+Ctrl+F / F11).
      toggleFullscreen: () => {
        void fullscreen.toggle();
      },
    };
    registerGlobalShortcuts(api);
    return () => {
      unregisterGlobalShortcuts();
    };
    // openSearchFn / closeSearchFn / isOpenFn / viewerCurrent / viewerClose 已展开为稳定引用.
    // open / loadFile 在 deps 中保证最新 (用户可能在后续重新创建).
  }, [open, loadFile, openSearchFn, closeSearchFn, isOpenFn, viewerCurrent, viewerClose, fullscreen]);

  // T11: Toolbar 监听 CustomEvent 切换最近抽屉 (与 Cmd/Ctrl+Shift+P 联动).
  // 这里仅占位 — 真实逻辑在 Toolbar.tsx 内.

  // SSR / build 时 tauriApi 会被 tree-shake; 这里显式引用以保留类型.
  void tauriApi;
  void useImageViewerHook;
  void useRecentStore;

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-fg">
      <SkipLink />
      <Toaster />
      <LinkTooltip />
      <DragOverlay />
      <Toolbar
        disabled={state.status === 'loading'}
        onOpen={open}
        // T20 (R-04 关键修复): RecentList 列表项点击 → 必须走 App.tsx 内
        // 同一份 useMarkdownDoc() 的 loadFile, 这样 OPEN_OK dispatch 才
        // 会进入 App.tsx 绑定的 Reader 渲染路径. 之前版本 RecentList 内部
        // 自己 useMarkdownDoc() 拿到一个独立的 hook 实例, 调 loadFile
        // 只更新 RecentList 自己的 reducer, Reader 完全看不到, content/outline
        // 永远保持上一份文件. 这次改为 prop 注入, 共享 App.tsx 实例.
        onLoadFile={(p) => {
          void loadFile(p);
        }}
        // T19 (FR-04): 将后/前回调显式注入, 让 Toolbar 走 useMarkdownDoc.loadFile
        // (而非 useDocStore.moveCursor) 以保证 Reader 跟着切换文档.
        onBack={() => {
          const ds = useDocStore.getState();
          if (!ds.canGoBack()) {
            pushToast({ kind: 'info', message: t('app.historyStart') });
            return;
          }
          const nextCursor = ds.cursor - 1;
          useDocStore.setState(() => ({ cursor: nextCursor }));
          const target = useDocStore.getState().history[nextCursor];
          if (target) void loadFile(target);
        }}
        onForward={() => {
          const ds = useDocStore.getState();
          if (!ds.canGoForward()) {
            pushToast({ kind: 'info', message: t('app.historyEnd') });
            return;
          }
          const nextCursor = ds.cursor + 1;
          useDocStore.setState(() => ({ cursor: nextCursor }));
          const target = useDocStore.getState().history[nextCursor];
          if (target) void loadFile(target);
        }}
      />
      {/* T21 (R-05 修复): 主内容区 — 目录树 + Reader 三栏 flex.
          - 目录树仅 treeOpen 时渲染, 280px 固定宽, 与 Reader 同一层面并列 (不再是 fixed 浮层).
          - treeOpen=false → 仅 Reader, 占满整行.
          - 旧实现用 position:fixed top-50px left-0 覆盖在 Reader 上方, 用户体验: 打开目录树时文档被遮挡 280px.
            现在改为 inline flex, 挤压 Reader 空间, 不会遮挡. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {treeOpen && (
          <aside
            data-testid="file-tree-drawer"
            aria-label="File tree"
            className="w-[280px] shrink-0 overflow-y-auto border-r border-fg/20 bg-bg"
          >
            <Suspense fallback={<div className="p-4 text-sm text-muted">…</div>}>
              <FileTreeLazy
                rootPath={treeRootPath}
                onRootPathChange={setTreeRootPath}
                onOpenFile={(p) => void loadFile(p)}
              />
            </Suspense>
          </aside>
        )}
        <Reader
          state={state}
          onRetry={retry}
          onOpen={open}
          onRenderError={() => {
            // Reader 内部 ErrorBoundary 捕获渲染异常 (例如插件 panic).
          }}
          docTitle={docTitle}
          onCurrentChange={handleCurrentChange}
          onProgressChange={setProgress}
          onMounted={handleReaderMounted}
        />
      </div>
      <StatusBar progress={progress} content={docContent} />
      {viewer.current ? (
        <ImageViewer src={viewer.current.src} alt={viewer.current.alt} onClose={viewer.close} />
      ) : null}
      <SearchBar />
      <ShortcutsHint />
    </div>
  );
}
