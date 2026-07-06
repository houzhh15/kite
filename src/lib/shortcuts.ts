/**
 * shortcuts — T11 集中维护的快捷键注册表 (设计 §3.3.1 / §3.3.2 + T18).
 *
 * 设计依据: docs/design/compiled.md §3.3 + 需求 FR-01 / FR-13.
 *
 * 责任:
 *   - 集中定义 14 条快捷键 (ShortcutId → 键位 + 动作);
 *   - 平台修饰键归一化 (isMac: Cmd vs Ctrl);
 *   - 平台符号 label (macOS ⌘ / Win/Linux Ctrl);
 *   - 表单 / IME 守卫由 useKeyboard 在消费 SHORTCUTS 时执行, 不在本文件.
 *
 * T18 (FR-02):
 *   - 删除 description 字段 (中文硬编码); 改为 i18nKey 引用 i18n 字典.
 *   - 消费方 (ShortcutsHint) 通过 t(i18nKey) 取得本地化文案.
 *
 * 纪律:
 *   - 纯常量 + 纯函数; 不依赖 React / 不依赖 store / 不调 IPC.
 *   - 新增/修改快捷键时, 仅需在此文件操作, useKeyboard 通过 SHORTCUTS 自动跟随.
 *   - 注册表不包含 Cmd+Space / Cmd+Tab / Cmd+Q 等系统保留组合 (设计 §4 R-07).
 */

/** 14 条快捷键 id (与 SHORTCUTS 一一对应). */
export type ShortcutId =
  | 'open'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'cycleTheme'
  | 'recentDrawer'
  | 'scrollTop'
  | 'scrollBottom'
  | 'closeOverlay'
  | 'toggleTree'
  | 'historyBack'
  | 'historyForward'
  // T16-P2 (FR-03) — 全屏切换快捷键.
  | 'toggleFullscreen'
  // T24 (F-26) — 在外部编辑器中打开当前文档.
  | 'openExternalEditor'
  // T26 (R-12 修复) — 重新加载当前文档.
  | 'reload';

/** 修饰键归一化: macOS ⌘ / Win & Linux Ctrl. */
export type ShortcutModifier = 'mod';

/** 单条快捷键定义 (设计 §3.2.1). */
export interface ShortcutDef {
  id: ShortcutId;
  /** 'o' / 'f' / '=' / '-' / '0' / 'l' / 'p' / 'home' / 'end' / 'escape' (统一 .toLowerCase() 匹配). */
  key: string;
  /** 是否需要按 Shift (Shift+L, Shift+P). */
  shift?: boolean;
  /**
   * Cmd on macOS, Ctrl on Win/Linux.
   * - 'mod': 需要 ⌘/Ctrl 键
   * - 'none': 不需要修饰键 (Esc, Home, End)
   */
  modifier: ShortcutModifier | 'none';
  /**
   * 触发时执行. 不在注册表内直接绑定, 由 useKeyboard 在 SHORTCUTS 遍历时
   * 通过 id → action 映射; 本字段保留便于未来扩展.
   */
  action?: () => void;
  /** true → e.preventDefault() (默认 true). */
  preventDefault?: boolean;
  /** 当 target ∈ INPUT/TEXTAREA/contentEditable 时是否仍触发. 默认 false. */
  allowInForm?: boolean;
  /** 当 IME 组合中 (e.isComposing) 是否仍触发. 默认 false. */
  allowWhileComposing?: boolean;
  /** 显示用, e.g. ⌘O / Ctrl+O. */
  label: { mac: string; other: string };
  /** T18 (FR-02): 本地化文案键路径 (i18n 字典), 由消费方 t(i18nKey) 取值. */
  i18nKey: string;
}

/**
 * isMac — 平台检测 (设计 §3.2.1).
 *
 * 同时支持 `navigator.userAgent` (字符串匹配) 与 `navigator.platform` (Mac 系列).
 * SSR / node 环境无 navigator 时默认 false (非 macOS).
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const plat = (navigator as { platform?: string }).platform || '';
  return /Mac|iPhone|iPad/.test(ua) || /Mac/.test(plat);
}

/** 平台修饰键符号 (速查展示用). */
export const PLATFORM_MOD_KEY: { mac: string; other: string } = {
  mac: '⌘',
  other: 'Ctrl',
};

/** 完整快捷键注册表 (设计 §3.3.1 表格). */
export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'open',
    key: 'o',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘O', other: 'Ctrl+O' },
    i18nKey: 'shortcuts.rows.open',
  },
  {
    id: 'find',
    key: 'f',
    modifier: 'mod',
    preventDefault: true,
    /** find 例外: 允许在 input/textarea 内触发 (AC-02-2 幂等). */
    allowInForm: true,
    label: { mac: '⌘F', other: 'Ctrl+F' },
    i18nKey: 'shortcuts.rows.find',
  },
  {
    id: 'zoomIn',
    key: '=',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘=', other: 'Ctrl+=' },
    i18nKey: 'shortcuts.rows.zoomIn',
  },
  {
    id: 'zoomOut',
    key: '-',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘-', other: 'Ctrl+-' },
    i18nKey: 'shortcuts.rows.zoomOut',
  },
  {
    id: 'zoomReset',
    key: '0',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘0', other: 'Ctrl+0' },
    i18nKey: 'shortcuts.rows.zoomReset',
  },
  {
    id: 'cycleTheme',
    key: 'l',
    shift: true,
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘⇧L', other: 'Ctrl+Shift+L' },
    i18nKey: 'shortcuts.rows.cycleTheme',
  },
  {
    id: 'recentDrawer',
    key: 'p',
    shift: true,
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘⇧P', other: 'Ctrl+Shift+P' },
    i18nKey: 'shortcuts.rows.recentDrawer',
  },
  {
    id: 'scrollTop',
    key: 'home',
    modifier: 'none',
    /** Home 不阻止浏览器默认行为 (NFR-13-2). */
    preventDefault: false,
    label: { mac: 'Home', other: 'Home' },
    i18nKey: 'shortcuts.rows.scrollTop',
  },
  {
    id: 'scrollBottom',
    key: 'end',
    modifier: 'none',
    preventDefault: false,
    label: { mac: 'End', other: 'End' },
    i18nKey: 'shortcuts.rows.scrollBottom',
  },
  {
    id: 'closeOverlay',
    key: 'escape',
    /** Esc 不需要 modifier 键. */
    modifier: 'none',
    preventDefault: false,
    /** 浮层关闭: 允许在 input 内触发 (SearchBar 输入框 Esc 关闭). */
    allowInForm: true,
    label: { mac: 'Esc', other: 'Esc' },
    i18nKey: 'shortcuts.rows.closeOverlay',
  },
  // ---- T15 (FR-01 / FR-04) 新增快捷键 ----
  {
    id: 'toggleTree',
    key: 't',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘T', other: 'Ctrl+T' },
    i18nKey: 'shortcuts.rows.toggleTree',
  },
  {
    id: 'historyBack',
    key: '[',
    modifier: 'mod',
    preventDefault: true,
    /** 历史回退: 即便焦点在 input 也允许 (例如 TextEditor 角). */
    allowInForm: true,
    label: { mac: '⌘[', other: 'Ctrl+[' },
    i18nKey: 'shortcuts.rows.historyBack',
  },
  {
    id: 'historyForward',
    key: ']',
    modifier: 'mod',
    preventDefault: true,
    allowInForm: true,
    label: { mac: '⌘]', other: 'Ctrl+]' },
    i18nKey: 'shortcuts.rows.historyForward',
  },
  // ---- T24 (F-26) 在外部编辑器中打开当前文档 ----
  {
    id: 'openExternalEditor',
    key: 'e',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘E', other: 'Ctrl+E' },
    i18nKey: 'shortcuts.rows.openExternalEditor',
  },
  // ---- T26 (R-12 修复) 重新加载当前文档 ----
  // 必须 preventDefault: 否则 Tauri Webview 默认 Cmd+R 会触发整页 reload,
  // 把 webview 状态全部丢弃 (滚动位置 / search 输入 / 抽屉 open 状态全丢).
  // AC-01: 用户保存外部编辑后, 切回 Kite 用 Cmd+R 强制刷一次.
  {
    id: 'reload',
    key: 'r',
    modifier: 'mod',
    preventDefault: true,
    label: { mac: '⌘R', other: 'Ctrl+R' },
    i18nKey: 'shortcuts.rows.reload',
  },
];

/**
 * getShortcutLabel — 按平台返回快捷键展示串.
 *
 * @param id  快捷键 id
 * @param mac 是否 macOS (默认读 isMac())
 */
export function getShortcutLabel(id: ShortcutId, mac: boolean = isMac()): string {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) return '';
  return mac ? def.label.mac : def.label.other;
}

/** 测试用: 重置模块级缓存 (当前无缓存, 占位). */
export function __resetShortcutsForTest(): void {
  // 当前没有模块级缓存; 保留接口便于未来扩展.
}