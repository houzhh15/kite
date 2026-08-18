/**
 * FavoritesTree.tsx — 左侧栏「收藏」虚拟文件夹树.
 *
 * 功能:
 *   - 显示被收藏的 Markdown 文件, 点击打开 (走 App 层统一 onOpenFile → loadFile).
 *   - 多级虚拟子目录: 新建 / 重命名 / 移动 / 删除 (只删收藏引用, 不碰磁盘文件).
 *   - 当前打开文档在列表中高亮.
 *
 * 状态来源: useFavoritesStore (数据唯一来源为 Rust favorites.json).
 * 本地 UI 状态: 展开集合 / 草稿输入(新建·重命名) / 节点菜单, 均不持久化.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocStore } from '../stores/docStore';
import {
  allFoldersFlat,
  childrenFiles,
  childrenFolders,
  countDescendants,
  descendantIds,
  matchPath,
} from '../stores/favoritesStore';
import useFavoritesStore from '../stores/favoritesStore';

export interface FavoritesTreeProps {
  /** 打开收藏文档 — 由 App 注入统一 loadFile. */
  onOpenFile: (path: string) => void;
}

type Draft =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename'; folderId: string; initial: string };

type MenuTarget = { kind: 'folder' | 'file'; id: string };

export function FavoritesTree({ onOpenFile }: FavoritesTreeProps): JSX.Element {
  const { t } = useTranslation();
  const snapshot = useFavoritesStore((s) => s.snapshot);
  const pendingKeys = useFavoritesStore((s) => s.pendingKeys);
  const createFolder = useFavoritesStore((s) => s.createFolder);
  const renameFolder = useFavoritesStore((s) => s.renameFolder);
  const moveNode = useFavoritesStore((s) => s.moveNode);
  const deleteFolder = useFavoritesStore((s) => s.deleteFolder);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);

  const currentPath = useDocStore((s) => s.state.currentPath);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState('');
  const [menuFor, setMenuFor] = useState<MenuTarget | null>(null);
  const [moveFor, setMoveFor] = useState<MenuTarget | null>(null);

  // 展开集合: null = 默认全部展开; 一旦用户交互过即固化为显式集合.
  const allFolderIds = useMemo(
    () => snapshot.folders.map((f) => f.id),
    [snapshot],
  );
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const expandedSet = useMemo(
    () => expanded ?? new Set(allFolderIds),
    [expanded, allFolderIds],
  );

  const busy = pendingKeys.length > 0;

  // 菜单打开时: Esc 关闭 + 背景点击关闭.
  const menuOpen = menuFor !== null || moveFor !== null;
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuFor(null);
        setMoveFor(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenus = (): void => {
    setMenuFor(null);
    setMoveFor(null);
  };

  const toggleExpand = (id: string): void => {
    const next = new Set(expandedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const openDraft = (d: Draft): void => {
    setMenuFor(null);
    setMoveFor(null);
    setDraftText(d.kind === 'rename' ? d.initial : '');
    setDraft(d);
  };

  const commitDraft = async (): Promise<void> => {
    if (!draft || busy) return;
    const text = draftText.trim();
    let ok = false;
    if (draft.kind === 'create') {
      ok = await createFolder(draft.parentId, text);
    } else {
      ok = await renameFolder(draft.folderId, text);
    }
    if (ok) setDraft(null); // 失败时保留输入内容, 用户可修改重试.
  };

  const handleDeleteFolder = async (folderId: string): Promise<void> => {
    closeMenus();
    const { folders, files } = countDescendants(snapshot, folderId);
    const msg =
      folders === 0 && files === 0
        ? t('favorites.deleteConfirm')
        : t('favorites.deleteNonEmptyConfirm', { folders, files });
    if (!window.confirm(msg)) return;
    await deleteFolder(folderId, true);
  };

  const handleMove = async (nodeId: string, destParentId: string | null): Promise<void> => {
    closeMenus();
    await moveNode(nodeId, destParentId);
  };

  // ── 行渲染 ────────────────────────────────────────────────────

  const folderMenu = (f: { id: string; name: string }): JSX.Element | null => {
    if (!menuFor || menuFor.id !== f.id) return null;
    if (moveFor && moveFor.id === f.id) {
      // 「移动到…」目标列表.
      const excluded = descendantIds(snapshot, f.id);
      const options = allFoldersFlat(snapshot).filter(
        (o) => o.id !== f.id && !excluded.has(o.id),
      );
      return (
        <div
          data-testid="fav-move-menu"
          className="absolute right-1 top-7 z-30 max-h-56 w-48 overflow-y-auto rounded border border-fg/20 bg-bg py-1 shadow-lg"
        >
          <button
            type="button"
            data-testid="fav-move-root"
            disabled={busy}
            onClick={() => void handleMove(f.id, null)}
            className="block w-full truncate px-3 py-1 text-left text-xs hover:bg-muted/60"
          >
            {t('favorites.rootLevel')}
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`fav-move-${o.id}`}
              disabled={busy}
              onClick={() => void handleMove(f.id, o.id)}
              className="block w-full truncate px-3 py-1 text-left text-xs hover:bg-muted/60"
            >
              {o.name}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div
        data-testid="fav-menu-folder"
        className="absolute right-1 top-7 z-30 w-40 rounded border border-fg/20 bg-bg py-1 shadow-lg"
      >
        <MenuItem
          testid="fav-menu-create-child"
          disabled={busy}
          label={t('favorites.createChild')}
          onClick={() => openDraft({ kind: 'create', parentId: f.id })}
        />
        <MenuItem
          testid="fav-menu-rename"
          disabled={busy}
          label={t('favorites.rename')}
          onClick={() =>
            openDraft({ kind: 'rename', folderId: f.id, initial: f.name })
          }
        />
        <MenuItem
          testid="fav-menu-move-to"
          disabled={busy}
          label={t('favorites.moveTo')}
          onClick={() => setMoveFor({ kind: 'folder', id: f.id })}
        />
        <MenuItem
          testid="fav-menu-delete"
          disabled={busy}
          label={t('favorites.deleteFolder')}
          onClick={() => void handleDeleteFolder(f.id)}
        />
      </div>
    );
  };

  const fileMenu = (fileId: string): JSX.Element | null => {
    if (!menuFor || menuFor.id !== fileId) return null;
    if (moveFor && moveFor.id === fileId) {
      const options = allFoldersFlat(snapshot);
      return (
        <div
          data-testid="fav-move-menu"
          className="absolute right-1 top-7 z-30 max-h-56 w-48 overflow-y-auto rounded border border-fg/20 bg-bg py-1 shadow-lg"
        >
          <button
            type="button"
            data-testid="fav-move-root"
            disabled={busy}
            onClick={() => void handleMove(fileId, null)}
            className="block w-full truncate px-3 py-1 text-left text-xs hover:bg-muted/60"
          >
            {t('favorites.rootLevel')}
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`fav-move-${o.id}`}
              disabled={busy}
              onClick={() => void handleMove(fileId, o.id)}
              className="block w-full truncate px-3 py-1 text-left text-xs hover:bg-muted/60"
            >
              {o.name}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div
        data-testid="fav-menu-file"
        className="absolute right-1 top-7 z-30 w-40 rounded border border-fg/20 bg-bg py-1 shadow-lg"
      >
        <MenuItem
          testid="fav-menu-move-to"
          disabled={busy}
          label={t('favorites.moveTo')}
          onClick={() => setMoveFor({ kind: 'file', id: fileId })}
        />
        <MenuItem
          testid="fav-menu-unfavorite"
          disabled={busy}
          label={t('favorites.unfavorite')}
          onClick={() => {
            closeMenus();
            void removeFavorite(fileId);
          }}
        />
      </div>
    );
  };

  const renderLevel = (parentId: string | null, depth: number): JSX.Element[] => {
    const out: JSX.Element[] = [];
    const padBase = 6 + depth * 12;

    for (const f of childrenFolders(snapshot, parentId)) {
      const isExpanded = expandedSet.has(f.id);
      out.push(
        <div key={f.id} className="relative" data-testid={`fav-folder-${f.id}`}>
          <div
            className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/40"
            style={{ paddingLeft: `${padBase}px` }}
          >
            <button
              type="button"
              data-testid={`fav-folder-toggle-${f.id}`}
              aria-expanded={isExpanded}
              aria-label={t(
                isExpanded ? 'favorites.collapse' : 'favorites.expand',
              )}
              className="w-4 shrink-0 text-xs text-muted hover:text-fg"
              onClick={() => toggleExpand(f.id)}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
            <span aria-hidden="true" className="shrink-0 text-xs">
              📁
            </span>
            <button
              type="button"
              title={f.name}
              onClick={() => setMenuFor({ kind: 'folder', id: f.id })}
              className="min-w-0 flex-1 truncate px-0.5 py-0 text-left text-xs hover:text-fg"
            >
              {f.name}
            </button>
            <button
              type="button"
              data-testid={`fav-folder-menu-${f.id}`}
              aria-label={t('favorites.rename')}
              disabled={busy}
              onClick={() => setMenuFor({ kind: 'folder', id: f.id })}
              className="shrink-0 rounded px-1 text-xs text-muted opacity-0 hover:text-fg group-hover:opacity-100"
            >
              ⋯
            </button>
          </div>
          {folderMenu(f)}
          {isExpanded && <>{renderLevel(f.id, depth + 1)}</>}
        </div>,
      );
    }

    for (const file of childrenFiles(snapshot, parentId)) {
      const active = currentPath !== null && matchPath(file.path, currentPath);
      out.push(
        <div
          key={file.id}
          className="relative"
          data-testid={`fav-file-${file.id}`}
        >
          <div
            className={`group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/40 ${active ? 'bg-accent/20' : ''}`}
            style={{ paddingLeft: `${padBase + 12}px` }}
          >
            <button
              type="button"
              title={file.path}
              aria-label={`${t('favorites.openFile')}: ${file.displayName}`}
              onClick={() => onOpenFile(file.path)}
              className="flex min-w-0 flex-1 items-center gap-1 truncate px-0.5 text-left text-xs hover:text-fg"
            >
              <span aria-hidden="true" className="shrink-0">
                📄
              </span>
              <span className="truncate">{file.displayName}</span>
            </button>
            <button
              type="button"
              data-testid={`fav-file-menu-${file.id}`}
              aria-label={t('favorites.unfavorite')}
              disabled={busy}
              onClick={() => setMenuFor({ kind: 'file', id: file.id })}
              className="shrink-0 rounded px-1 text-xs text-muted opacity-0 hover:text-fg group-hover:opacity-100"
            >
              ⋯
            </button>
          </div>
          {fileMenu(file.id)}
        </div>,
      );
    }

    return out;
  };

  const rootFolders = childrenFolders(snapshot, null);
  const rootFiles = childrenFiles(snapshot, null);
  const empty = rootFolders.length === 0 && rootFiles.length === 0;
  const draftLabel =
    draft?.kind === 'rename'
      ? t('favorites.rename')
      : t('favorites.newFolder');

  return (
    <section
      aria-label={t('favorites.sectionTitle')}
      data-testid="favorites-section"
      className="flex h-[38%] min-h-[150px] max-h-[320px] shrink-0 flex-col border-t border-fg/20"
    >
      <header className="flex shrink-0 items-center gap-1 px-3 py-1.5">
        <span aria-hidden="true" className="text-xs">
          ★
        </span>
        <h2 className="truncate text-xs font-semibold tracking-wide">
          {t('favorites.sectionTitle')}
        </h2>
        {draftLabel && draft ? (
          <span className="ml-1 truncate text-[10px] text-muted">{draftLabel}</span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="favorites-new-root-folder"
            aria-label={t('favorites.newFolder')}
            title={t('favorites.newFolder')}
            disabled={busy}
            onClick={() => openDraft({ kind: 'create', parentId: null })}
            className="rounded px-1.5 py-0.5 text-sm leading-none text-muted hover:bg-muted/60 hover:text-fg"
          >
            ＋
          </button>
        </div>
      </header>

      {draft ? (
        <div className="shrink-0 px-3 pb-1">
          <input
            data-testid="favorites-name-input"
            autoFocus
            value={draftText}
            placeholder={t('favorites.folderNamePlaceholder')}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitDraft();
              if (e.key === 'Escape') setDraft(null);
            }}
            onBlur={() => setDraft(null)}
            className="w-full rounded border border-fg/30 bg-bg px-2 py-1 text-xs"
          />
        </div>
      ) : null}

      <div
        data-testid="favorites-body"
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-1"
      >
        {menuOpen ? (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-20 cursor-default"
            onClick={closeMenus}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeMenus();
            }}
          />
        ) : null}

        {empty ? (
          <p className="px-3 py-3 text-xs leading-relaxed text-muted">
            {t('favorites.emptyHint')}
          </p>
        ) : (
          renderLevel(null, 0)
        )}
      </div>
    </section>
  );
}

/** 菜单项小按钮. */
function MenuItem(props: {
  testid: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  const { testid, label, onClick, disabled } = props;
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className="block w-full truncate px-3 py-1 text-left text-xs hover:bg-muted/60"
    >
      {label}
    </button>
  );
}

export default FavoritesTree;
