/**
 * FileTree — T15 (FR-01) 目录树侧栏组件.
 *
 * 责任:
 *   - 列出 rootPath 下的 Markdown 条目 (经 `list_dir` IPC).
 *   - 文件夹支持展开/折叠 (本地 state, Set<string>).
 *   - 文件夹懒加载子项: 仅在点开时拉.
 *   - 叶子点击 → onOpenFile(path) (父组件转发到 docStore.loadFile).
 *   - 单节点错误 → 仅该节点显示错误占位, 不冒泡.
 *   - 空态 → 显示 `tree.emptyHint` i18n 文案.
 *   - 不持久化展开 state (会话内有效).
 *
 * 设计依据: docs/design/compiled.md §3.1 / 需求 FR-01.
 *
 * 纪律:
 *   - 通过 `React.lazy` 接入. 调用方应在 `<Layout>` 左侧用 `React.lazy`
 *     包装, 并通过 props 注入 rootPath + onOpenFile.
 *   - 不在内部调 setContent; 由 onOpenFile 转发 docStore.loadFile.
 *   - 大目录 (>1000 项) 暂不引入 react-window (P2 范围外); 由后端 list_dir
 *     返回天然截断, 必要时再优化.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { listDir, isAppError, type DirEntry } from '../lib/tauri';

export interface FileTreeProps {
  /** 用户授权的根目录绝对路径. null 表示尚未选择, 显示空态. */
  rootPath: string | null;
  /** 叶子点击回调 (传 Path). */
  onOpenFile: (path: string) => void;
}

interface ChildState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  entries: DirEntry[];
  errorKey?: 'NOT_FOUND' | 'IO' | 'INVALID_PATH' | 'PERMISSION_DENIED' | 'NOT_A_DIRECTORY' | 'UNKNOWN';
  errorMessage?: string;
}

const initialChildState: ChildState = {
  status: 'idle',
  entries: [],
};

export function FileTree({ rootPath, onOpenFile }: FileTreeProps): JSX.Element {
  const { t } = useTranslation();
  /** 已展开目录 Set<path>. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 节点子项状态表 Map<path, ChildState>. */
  const [childMap, setChildMap] = useState<Map<string, ChildState>>(new Map());

  // 当 rootPath 变化, 重置展开状态 (在新根目录里之前的展开无意义).
  useEffect(() => {
    setExpanded(new Set());
    setChildMap(new Map());
  }, [rootPath]);

  const toggleExpand = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        // 触发懒加载; 即便已加载, 复用.
        void fetchChildren(dirPath, setChildMap);
      }
      return next;
    });
  }, []);

  if (!rootPath) {
    return (
      <div
        data-testid="file-tree-empty"
        className="flex h-full items-center justify-center px-4 text-sm text-muted"
      >
        {t('tree.emptyHint')}
      </div>
    );
  }

  return (
    <div data-testid="file-tree" className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="truncate font-medium" title={rootPath}>{baseName(rootPath)}</span>
        <span className="ml-2 text-muted">{t('tree.refresh')}</span>
      </div>
      <ul role="tree" className="flex-1 overflow-auto px-1 py-1 text-sm">
        <TreeNode
          path={rootPath}
          name={baseName(rootPath)}
          isDir={true}
          depth={0}
          expanded={expanded}
          childMap={childMap}
          onToggle={toggleExpand}
          onFileClick={onOpenFile}
        />
      </ul>
    </div>
  );
}

interface TreeNodeProps {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  expanded: Set<string>;
  childMap: Map<string, ChildState>;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
}

function TreeNode({
  path,
  name,
  isDir,
  depth,
  expanded,
  childMap,
  onToggle,
  onFileClick,
}: TreeNodeProps): JSX.Element {
  const { t } = useTranslation();
  const isOpen = expanded.has(path);
  const indent = depth * 12 + 4;

  if (!isDir) {
    return (
      <li
        role="treeitem"
        aria-selected={false}
        data-testid="file-tree-leaf"
        className="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-fg/10"
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => onFileClick(path)}
      >
        <span className="mr-1 text-muted">📄</span>
        <span className="truncate">{name}</span>
      </li>
    );
  }

  // 目录节点.
  return (
    <li role="treeitem" aria-expanded={isOpen} data-testid="file-tree-dir">
      <button
        type="button"
        className="flex w-full items-center rounded px-2 py-1 hover:bg-fg/10"
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => onToggle(path)}
        aria-expanded={isOpen}
      >
        <span className="mr-1 text-muted">{isOpen ? '▼' : '▶'}</span>
        <span className="mr-1 text-muted">📁</span>
        <span className="truncate">{name}</span>
      </button>
      {isOpen && (
        <ChildNodes
          path={path}
          depth={depth + 1}
          expanded={expanded}
          childMap={childMap}
          onToggle={onToggle}
          onFileClick={onFileClick}
          errorLabel={t('tree.error')}
        />
      )}
    </li>
  );
}

function ChildNodes({
  path,
  depth,
  expanded,
  childMap,
  onToggle,
  onFileClick,
  errorLabel,
}: {
  path: string;
  depth: number;
  expanded: Set<string>;
  childMap: Map<string, ChildState>;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  errorLabel: string;
}): JSX.Element {
  const state = childMap.get(path) ?? initialChildState;
  // 单一阶段展示空态时, 用 status; 加载中 / 错误 / 有内容 三态分别渲染.
  if (state.status === 'loading') {
    return <li className="px-2 py-1 text-xs text-muted" style={{ paddingLeft: `${depth * 12 + 4}px` }}>…</li>;
  }
  if (state.status === 'error') {
    return (
      <li
        data-testid="file-tree-error"
        role="alert"
        className="px-2 py-1 text-xs text-red-600"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        ⚠ {errorLabel}
        {state.errorMessage ? `: ${state.errorMessage}` : ''}
      </li>
    );
  }
  if (state.status === 'idle' || state.entries.length === 0) {
    return <li className="px-2 py-1 text-xs text-muted" style={{ paddingLeft: `${depth * 12 + 4}px` }}>(空)</li>;
  }
  return (
    <ul role="group" className="m-0 list-none p-0">
      {state.entries.map((entry) => (
        <TreeNode
          key={entry.path}
          path={entry.path}
          name={entry.name}
          isDir={entry.isDir}
          depth={depth}
          expanded={expanded}
          childMap={childMap}
          onToggle={onToggle}
          onFileClick={onFileClick}
        />
      ))}
    </ul>
  );
}

async function fetchChildren(
  path: string,
  setChildMap: React.Dispatch<React.SetStateAction<Map<string, ChildState>>>,
): Promise<void> {
  setChildMap((prev) => {
    const next = new Map(prev);
    next.set(path, { status: 'loading', entries: [] });
    return next;
  });
  try {
    const entries = await listDir(path);
    setChildMap((prev) => {
      const next = new Map(prev);
      next.set(path, { status: 'ok', entries });
      return next;
    });
  } catch (err) {
    const code = isAppError(err) ? err.code : 'UNKNOWN';
    const message =
      err instanceof Error
        ? err.message
        : isAppError(err)
          ? err.message
          : '';
    setChildMap((prev) => {
      const next = new Map(prev);
      next.set(path, {
        status: 'error',
        entries: [],
        errorKey:
          code === 'NOT_FOUND' ||
          code === 'IO' ||
          code === 'INVALID_PATH' ||
          code === 'PERMISSION_DENIED' ||
          code === 'NOT_A_DIRECTORY' ||
          code === 'UNKNOWN'
            ? code
            : 'UNKNOWN',
        errorMessage: message,
      });
      return next;
    });
  }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export default FileTree;
