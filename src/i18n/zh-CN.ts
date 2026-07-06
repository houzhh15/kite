/**
 * zh-CN.ts — T15 (FR-03) 简体中文字典.
 *
 * 设计依据: docs/design/compiled.md §3.3 + 需求 FR-03.
 *
 * 字典命名空间:
 *   - common      通用动词 (open/find/close/...)
 *   - toolbar     顶部按钮 (open/find/tree/back/forward/settings/...)
 *   - reader      阅读区文案 (empty/error/...)
 *   - tree        目录树抽屉 (emptyHint/error/invalidPath/refresh)
 *   - settings    设置面板 (title/language/...)
 *   - history     历史栈 (indicator)
 *   - menu        菜单项 (recents/...)
 *   - message     错误/提示 (loadFailed/...)
 *   - export      导出 (FR-01/FR-02)
 *   - fullscreen  全屏切换 (FR-03)
 *   - toast       全局 toast (FR-04)
 *   - fallback    渲染降级 (F-21/F-22)
 *   - outline     T18 Outline 侧边目录 (FR-02)
 *   - status      T18 StatusView 4 状态 (FR-02)
 *   - statusBar   T18 顶部细条 + 底部状态栏 (FR-04)
 *   - recent      T18 最近文件列表 (FR-02)
 *   - codeBlock   T18 围栏代码块工具栏 (FR-02)
 *   - search      T18 页内查找浮层 (FR-02)
 *   - shortcuts   T18 快捷键速查 (FR-12)
 *   - theme       T18 主题切换器 (FR-02)
 *   - dialog      T18 通用对话框 (ImageViewer 等)
 *   - image       T18 图片处理
 *   - app         T18 顶层 toast / 进度解析失败
 *   - skipLink    T18 跳过链接
 *   - externalEditor T24 外部编辑器
 *   - recentDir   T25 (F-27) 最近目录
 *
 * 纪律:
 *   - 纯数据; 不依赖 React / 不依赖 store / 不调 IPC.
 *   - 类型 I18nNamespace 由 i18n/index.ts 消费时与 en-US 对齐.
 *   - 缺失 key: dev 模式控制台 warn; UI 不崩 (回退显示 key 字符串).
 *   - 占位符统一用 i18next 默认 `{{var}}` 语法 (C-08).
 */

export const zhCN = {
  common: {
    open: '打开',
    close: '关闭',
    find: '查找',
    cancel: '取消',
    refresh: '刷新',
    confirm: '确认',
    // T18 新增 (Phase 3)
    dropHint: '释放以打开 Markdown',
    closeNotification: '关闭通知',
    externalOpened: '已在系统浏览器打开：{{url}}',
  },
  toolbar: {
    open: '打开',
    find: '查找',
    tree: '目录树',
    back: '后退',
    forward: '前进',
    backDisabledHint: '无可后退的历史 (先打开 2 个文件)',
    forwardDisabledHint: '无可前进的历史',
    settings: '设置',
    recent: '最近文件',
    fontSizeLabel: '正文字号',
    fontSizeAriaLabelSuffix: '. 点击选择字号.',
  },
  reader: {
    empty: '未打开文档',
    errorTitle: '加载失败',
    retry: '重试',
  },
  tree: {
    emptyHint: '请选择一个文件夹开始浏览',
    // T21 (R-05): 空态按钮文案, 让用户实际能选目录.
    pickRoot: '选择文件夹',
    pickRootTitle: '选择 Markdown 根目录',
    picking: '正在打开目录…',
    error: '此目录加载失败',
    invalidPath: '路径无效或不是目录',
    refresh: '刷新目录',
    close: '关闭目录树',
    // T25 (F-27): 「重新选择文件夹」入口 + 二次确认文案.
    reselect: '重新选择文件夹',
    reselectConfirmTitle: '重新选择文件夹？',
    reselectConfirmMsg: '将返回选择文件夹页面，当前打开的文档不受影响。',
    historySection: '或从历史选择',
    historyEmpty: '暂无历史文件夹',
  },
  settings: {
    title: '设置',
    panelLabel: '设置',
    theme: '主题',
    language: '语言',
    fontSize: '正文字号',
    lineHeight: '行高',
    codeFontSize: '代码块字号',
    reset: '重置阅读偏好',
    close: '关闭',
    fontSizeHint: '当前字号',
    // T18 (FR-02): 字号 / 行高离散档位 token 文案 (供 Settings.tsx 取值).
    fontSizeSm: '小',
    fontSizeMd: '标准',
    fontSizeLg: '中',
    fontSizeXl: '大',
    fontSize2xl: '特大',
    lineHeightCompact: '紧凑',
    lineHeightCozy: '舒适',
    lineHeightComfortable: '宽松',
    // T18 (FR-02): settings.fontSize.<id> / settings.lineHeight.<id> 路径形式.
    fontSizes: {
      sm: '小',
      md: '标准',
      lg: '中',
      xl: '大',
      '2xl': '特大',
    },
    lineHeights: {
      compact: '紧凑',
      cozy: '舒适',
      comfortable: '宽松',
    },
    languageOption: {
      zhCN: '简体中文',
      enUS: 'English',
    },
    // T17-P2 (F-21/F-22): 图表与公式设置分组 + 两个开关 label/描述.
    section: {
      diagrams: '图表与公式',
    },
    mermaidEnable: 'Mermaid 图表渲染',
    mermaidDesc: '渲染 mermaid 代码块为图表；启用后将按需加载约 600 KB 资源',
    katexEnable: 'KaTeX 数学公式',
    katexDesc: '渲染行内 / 块级数学公式；启用后将按需加载约 250 KB 资源',
  },
  history: {
    indicator: '{{current}} / {{total}}',
    empty: '未打开文件',
  },
  menu: {
    open: '打开 Markdown 文件',
    recents: '最近文件',
    clearRecents: '清空最近文件',
    closeFolder: '关闭当前文件夹',
  },
  message: {
    loadFailed: '文件加载失败',
    fileNotFound: '文件不存在',
    fileTooLarge: '文件过大',
    fileTooLargeVerbose: '文件过大(>50 MB)',
    encodingError: '文件编码非 UTF-8',
    ioError: '读取失败',
    invalidPath: '路径无效',
    notADirectory: '路径不是目录',
    permissionDenied: '权限被拒绝',
    unknownError: '未知错误',
    nothingToOpen: '请先选择文件',
    // T18 (FR-02): 新增错误码 i18n key (覆盖 T16-P2 导出 / T02 文件拖拽 / lib/errorMessage 等路径).
    payloadTooLarge: '导出内容超过 5 MB 上限',
    invalidTargetPath: '目标路径无效或不允许写入',
    dropNotFound: '文件不存在: {{basename}}',
    dropTooLarge: '文件过大(>50 MB)',
    dropEncoding: '文件编码无效(非 UTF-8)',
    dropIo: '读取文件失败: {{basename}}',
    dropInvalidPath: '文件扩展名不支持',
    dropUnknown: '打开文件失败',
    dropEmptyPaths: '无法识别文件路径',
    dropUnsupportedExt: '不支持的文件类型: {{ext}}（仅支持 {{accepted}}）',
    dropPayload: '拖拽事件格式异常',
    prefsReset: '偏好已重置',
  },
  // T16-P2 (FR-01 / FR-02 / FR-03 / FR-04) — 导出与全屏.
  export: {
    menu: '导出',
    html: '导出 HTML',
    pdf: '导出 PDF',
    successHtml: '已导出到 {{path}}',
    failGeneric: '导出失败：{{message}}',
    failDevMode: '请在桌面应用中执行导出',
    pdfHint: 'PDF 已发送到打印机对话框，请在系统对话框中保存到 {{path}}',
  },
  fullscreen: {
    enter: '全屏',
    exit: '退出全屏',
    toggle: '切换全屏',
    // T19 (修复): 全屏 / 退出失败时的 toast 文案.
    // macOS native fullscreen 在窗口失焦时静默 no-op, React state 误判为成功,
    // 必须显式告知用户.
    'failed': {
      enter: '进入全屏失败, 请确保窗口已获焦后重试',
      exit: '退出全屏失败, 请确保窗口已获焦后重试',
    },
    // IPC 抛错 (例如窗口未找到 / 命令未注册) 时.
    'ipcFailed': '全屏切换 IPC 调用失败: {{msg}}',
    // 浏览器 fallback (document.requestFullscreen) 抛错时.
    'browserFailed': '浏览器全屏 API 拒绝此次请求 (可能需要用户手势)',
  },
  // T17-P2 (F-21/F-22): toast 与 fallback 文案.
  toast: {
    mermaidBundleHint: '已按需加载 mermaid 资源',
    mermaidLoadFailed: '图表资源加载失败，已切换至 fallback',
    // T19 (FR-01 / FR-06 / C-06): 危险协议链接拦截 toast.
    link: {
      blocked: '已拦截不安全的链接',
    },
  },
  fallback: {
    mermaidError: '图表渲染失败，显示原始代码',
  },
  // ─────────────────────────────────────────────────────────────────
  // T18 新增命名空间
  // ─────────────────────────────────────────────────────────────────
  outline: {
    title: '目录',
    empty: '无目录',
    toggleExpand: '展开目录',
    toggleCollapse: '折叠目录',
    resizeLabel: '拖动以调整目录宽度',
  },
  status: {
    emptyTitle: '还没有打开任何文件',
    emptySubtitle: '打开你的第一个 Markdown 文件，开始阅读与渲染',
    emptyOpen: '打开 Markdown 文件',
    loading: '加载中…',
    errorTitle: '无法加载文件',
    retry: '重试',
    errorUnknown: '未知错误',
  },
  statusBar: {
    progressFmt: '进度 {{n}}%',
    wordsLinesFmt: '{{words}} 字 · {{lines}} 行',
    progressLabel: '阅读进度',
  },
  recent: {
    empty: '暂无最近文件',
    openFile: '打开文件',
    clear: '清空最近文件',
    clearConfirmTitle: '清空最近文件',
    clearConfirmMessage: '确定要清空最近文件列表吗？该操作不可撤销。',
    recordFailed: '记录最近文件失败',
    clearedToast: '已清空最近文件',
    clearFailed: '清空失败，请重试',
  },
  // T25 (F-27): 最近目录列表 (与 F-03 独立命名空间).
  recentDir: {
    title: '最近文件夹',
    open: '打开',
    delete: '删除',
    clear: '清空',
    clearConfirm: '清空文件夹历史？',
    deleteConfirm: '从历史移除此文件夹？',
    clearedToast: '已清空',
    clearFailedToast: '清空失败',
    deleteFailedToast: '删除失败',
    recordFailedToast: '记录失败',
    relative: {
      justNow: '刚刚',
      minutesAgo: '{{n}} 分钟前',
      hoursAgo: '{{n}} 小时前',
      daysAgo: '{{n}} 天前',
      weeksAgo: '{{n}} 周前',
    },
  },
  codeBlock: {
    copy: '复制代码',
    copySuccess: '已复制',
    copyFail: '复制失败，请手动选中',
    fold: '折叠代码块',
    unfold: '展开代码块',
  },
  search: {
    containerLabel: '在文档中查找',
    inputLabel: '查找关键字',
    placeholder: '查找关键字',
    prev: '上一个',
    next: '下一个',
    close: '关闭',
    optionGroupLabel: '搜索选项',
    caseSensitive: '区分大小写',
    wholeWord: '整词匹配',
    regex: '正则',
    regexInvalid: '正则非法',
    countFmt: '{{current}} / {{total}}',
  },
  shortcuts: {
    title: '快捷键速查',
    intro: 'KITE 当前支持的快捷键如下（macOS / Windows / Linux 自动切换修饰键）。',
    close: '关闭',
    dontShowAgain: '不再提示',
    doneAck: '知道了',
    rows: {
      open: '打开 Markdown 文件',
      find: '页内查找',
      zoomIn: '放大字号',
      zoomOut: '缩小字号',
      zoomReset: '恢复默认字号 (16px)',
      cycleTheme: '切换主题 (浅色 / 深色 / 跟随系统)',
      recentDrawer: '打开最近文件',
      scrollTop: '滚动到文档顶',
      scrollBottom: '滚动到文档底',
      closeOverlay: '关闭最上层浮层',
      toggleTree: '切换目录树抽屉',
      historyBack: '后退 (历史)',
      historyForward: '前进 (历史)',
      // T24 (F-26): 在外部编辑器中打开当前文档 (Cmd/Ctrl+E).
      openExternalEditor: '在外部编辑器中打开当前文档',
    },
  },
  // T24 (F-26): 外部编辑器 (F-26 §P2) — 按钮 / 菜单 / 设置分组 / 错误文案.
  externalEditor: {
    buttonLabel: '外部编辑器',
    buttonLabelDisabled: '请先打开文档',
    menuLabel: '在外部编辑器中打开',
    settings: {
      groupTitle: '外部编辑器',
      system: '系统默认',
      code: 'VS Code',
      cursor: 'Cursor',
      subl: 'Sublime Text',
      mate: 'TextMate',
      notepadPlusPlus: 'Notepad++ (仅 Windows)',
      typora: 'Typora',
      custom: '自定义命令',
      customCmdPlaceholder: '例如: cursor --new-window {{path}}',
      customCmdLabel: '自定义命令模板',
    },
    error: {
      notFound: '文件不存在或已被移动: {{path}}',
      permissionDenied: '路径越界，仅支持当前文档目录下的 Markdown 文件',
      invalidExtension: '仅支持 Markdown 文件 (.md / .markdown / .mdx)',
      invalidPath: '无效路径: {{message}}',
      spawnFailed: '无法启动编辑器: {{message}}。请检查系统 PATH 或在设置中切换编辑器',
      generic: '打开外部编辑器失败: {{message}}',
    },
  },
  theme: {
    light: '浅色',
    dark: '深色',
    system: '跟随系统',
    groupLabel: '主题',
  },
  dialog: {
    imageViewer: {
      label: '图片查看',
      close: '关闭图片查看',
    },
    treeDrawer: {
      label: '文件树',
    },
  },
  image: {
    loadFail: '图片读取失败：{{msg}}',
  },
  app: {
    fontSizeMax: '已达最大字号',
    fontSizeMin: '已达最小字号',
    historyStart: '已在历史起点',
    historyEnd: '已在历史终点',
    progressCorrupted: 'progress data parse failed',
    progressReset: '进度数据已重置',
  },
  skipLink: {
    label: '跳到主内容',
  },
} as const;

export type ZhCNMessages = typeof zhCN;

/**
 * T12 兼容形状 — Settings.tsx 通过 `import { settings } from '../i18n/zh-CN'`
 * 访问 panelLabel/title/... 字段. 此处用 namespace.settings 重新导出,
 * 既保留 T12 调用面, 也避免分裂字典 (T15 FR-03 复用).
 */
export interface SettingsMessages {
  title: string;
  fontSize: string;
  lineHeight: string;
  codeFontSize: string;
  reset: string;
  close: string;
  panelLabel: string;
  fontSizeHint: string;
  language?: string;
}
export const settings: SettingsMessages = {
  title: zhCN.settings.title,
  fontSize: zhCN.settings.fontSize,
  lineHeight: zhCN.settings.lineHeight,
  codeFontSize: zhCN.settings.codeFontSize,
  reset: zhCN.settings.reset,
  close: zhCN.settings.close,
  panelLabel: zhCN.settings.panelLabel,
  fontSizeHint: zhCN.settings.fontSizeHint,
  language: zhCN.settings.language,
};

/** T15 命名空间联合 — 供测试断言完整性 (NFR-A-06). */
export const i18nKeys = {
  common: zhCN.common,
  toolbar: zhCN.toolbar,
  reader: zhCN.reader,
  tree: zhCN.tree,
  settings: zhCN.settings,
  history: zhCN.history,
  menu: zhCN.menu,
  message: zhCN.message,
  export: zhCN.export,
  fullscreen: zhCN.fullscreen,
  toast: zhCN.toast,
  fallback: zhCN.fallback,
  outline: zhCN.outline,
  status: zhCN.status,
  statusBar: zhCN.statusBar,
  recent: zhCN.recent,
  recentDir: zhCN.recentDir,
  codeBlock: zhCN.codeBlock,
  search: zhCN.search,
  shortcuts: zhCN.shortcuts,
  theme: zhCN.theme,
  dialog: zhCN.dialog,
  image: zhCN.image,
  app: zhCN.app,
  skipLink: zhCN.skipLink,
  // T24 (F-26): 外部编辑器.
  externalEditor: zhCN.externalEditor,
} as const;

export type I18nKeys = typeof i18nKeys;

export default zhCN;