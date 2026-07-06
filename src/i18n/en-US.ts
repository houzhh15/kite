/**
 * en-US.ts — T15 (FR-03) English dictionary (US locale).
 *
 * 设计依据: docs/design/compiled.md §3.3 + 需求 FR-03.
 *
 * 字典结构与 src/i18n/zh-CN.ts 严格对齐; 命名空间:
 *   common / toolbar / reader / tree / settings / history / menu / message /
 *   export / fullscreen / toast / fallback / outline / status / statusBar /
 *   recent / codeBlock / search / shortcuts / theme / dialog / image / app /
 *   skipLink.
 *
 * 纪律:
 *   - 纯数据; 不依赖 React / 不依赖 store / 不调 IPC.
 *   - 缺失 key: dev 模式控制台 warn; UI 不崩.
 *   - 占位符统一用 i18next 默认 `{{var}}` 语法 (C-08).
 */

export const enUS = {
  common: {
    open: 'Open',
    close: 'Close',
    find: 'Find',
    cancel: 'Cancel',
    refresh: 'Refresh',
    confirm: 'OK',
    // T18 new (Phase 3)
    dropHint: 'Release to open Markdown',
    closeNotification: 'Close notification',
    externalOpened: 'Opened in system browser: {{url}}',
  },
  toolbar: {
    open: 'Open',
    find: 'Find',
    tree: 'Tree',
    back: 'Back',
    forward: 'Forward',
    backDisabledHint: 'No back history (open 2+ files first)',
    forwardDisabledHint: 'No forward history',
    settings: 'Settings',
    recent: 'Recent files',
    fontSizeLabel: 'Body font size',
    fontSizeAriaLabelSuffix: '. Click to choose size.',
  },
  reader: {
    empty: 'No document open',
    errorTitle: 'Failed to load',
    retry: 'Retry',
  },
  tree: {
    emptyHint: 'Choose a folder to start browsing',
    pickRoot: 'Choose folder',
    pickRootTitle: 'Choose Markdown root directory',
    picking: 'Opening dialog…',
    error: 'Failed to load this directory',
    invalidPath: 'Invalid path or not a directory',
    refresh: 'Refresh directory',
    close: 'Close tree',
    // T25 (F-27): "Return" entry + confirmation copy.
    // reselect is the header button label (shortened to one word for visual parity
    // with "Refresh" button next to it). Confirm dialog title / message keep
    // "Reselect folder" wording because the dialog needs to be explicit about
    // the action's consequence — no shortening.
    reselect: 'Return',
    reselectConfirmTitle: 'Reselect folder?',
    reselectConfirmMsg: 'Returns to the folder picker. The current document is not affected.',
    // T26+ (R-12 修复): 拖拽手柄 aria-label, 与 outline.resizeLabel 风格一致.
    resizeLabel: 'Drag to resize file tree width',
    historySection: 'Or pick from history',
    historyEmpty: 'No recent folders',
  },
  settings: {
    title: 'Settings',
    panelLabel: 'Settings',
    theme: 'Theme',
    language: 'Language',
    fontSize: 'Body font size',
    lineHeight: 'Line height',
    codeFontSize: 'Code block font size',
    reset: 'Reset reading preferences',
    close: 'Close',
    fontSizeHint: 'Current font size',
    // T18 (FR-02): font size / line height level labels.
    fontSizeSm: 'Small',
    fontSizeMd: 'Standard',
    fontSizeLg: 'Medium',
    fontSizeXl: 'Large',
    fontSize2xl: 'Extra Large',
    lineHeightCompact: 'Compact',
    lineHeightCozy: 'Cozy',
    lineHeightComfortable: 'Comfortable',
    // T18 (FR-02): nested keys.
    fontSizes: {
      sm: 'Small',
      md: 'Standard',
      lg: 'Medium',
      xl: 'Large',
      '2xl': 'Extra Large',
    },
    lineHeights: {
      compact: 'Compact',
      cozy: 'Cozy',
      comfortable: 'Comfortable',
    },
    languageOption: {
      zhCN: '简体中文',
      enUS: 'English',
    },
    // T17-P2 (F-21/F-22): Diagrams & Formulas section + two switch labels.
    section: {
      diagrams: 'Diagrams & Formulas',
    },
    mermaidEnable: 'Mermaid diagrams',
    mermaidDesc: 'Render mermaid code blocks as diagrams; loads ~600 KB on enable',
    katexEnable: 'KaTeX math',
    katexDesc: 'Render inline / block math formulas; loads ~250 KB on enable',
  },
  history: {
    indicator: '{{current}} / {{total}}',
    empty: 'No files opened yet',
  },
  menu: {
    open: 'Open Markdown file',
    recents: 'Recent files',
    clearRecents: 'Clear recent files',
    closeFolder: 'Close current folder',
  },
  message: {
    loadFailed: 'Failed to load file',
    fileNotFound: 'File not found',
    fileTooLarge: 'File too large',
    fileTooLargeVerbose: 'File too large (>50 MB)',
    encodingError: 'File encoding is not UTF-8',
    ioError: 'Read failed',
    invalidPath: 'Invalid path',
    notADirectory: 'Path is not a directory',
    permissionDenied: 'Permission denied',
    unknownError: 'Unknown error',
    nothingToOpen: 'Please choose a file first',
    // T18 (FR-02): new error code i18n keys (covers T16-P2 export / T02 file drop / lib/errorMessage).
    payloadTooLarge: 'Export content exceeds 5 MB limit',
    invalidTargetPath: 'Target path is invalid or not writable',
    dropNotFound: 'File not found: {{basename}}',
    dropTooLarge: 'File too large (>50 MB)',
    dropEncoding: 'Invalid file encoding (not UTF-8)',
    dropIo: 'Read failed: {{basename}}',
    dropInvalidPath: 'Unsupported file extension',
    dropUnknown: 'Failed to open file',
    dropEmptyPaths: 'Could not identify file path',
    dropUnsupportedExt: 'Unsupported file type: {{ext}} (only {{accepted}} supported)',
    dropPayload: 'Malformed drop event payload',
    prefsReset: 'Preferences have been reset',
  },
  // T16-P2 (FR-01 / FR-02 / FR-03 / FR-04) — Export and fullscreen.
  export: {
    menu: 'Export',
    html: 'Export as HTML',
    pdf: 'Export as PDF',
    successHtml: 'Exported to {{path}}',
    failGeneric: 'Export failed: {{message}}',
    failDevMode: 'Please run export in the desktop app',
    pdfHint: 'PDF sent to the print dialog. Save to {{path}} in the system dialog.',
  },
  fullscreen: {
    enter: 'Fullscreen',
    exit: 'Exit Fullscreen',
    toggle: 'Toggle Fullscreen',
    failed: {
      enter: 'Could not enter fullscreen, make sure the window is focused and retry',
      exit: 'Could not exit fullscreen, make sure the window is focused and retry',
    },
    ipcFailed: 'Fullscreen IPC call failed: {{msg}}',
    browserFailed: 'Browser fullscreen API rejected (may need a user gesture)',
  },
  // T17-P2 (F-21/F-22): toast + fallback copy.
  toast: {
    mermaidBundleHint: 'Mermaid assets loaded on demand',
    mermaidLoadFailed: 'Failed to load diagram assets, using fallback',
    // T19 (FR-01 / FR-06 / C-06): blocked unsafe link toast.
    link: {
      blocked: 'Blocked unsafe link',
    },
  },
  fallback: {
    mermaidError: 'Diagram render failed; showing source',
  },
  // ─────────────────────────────────────────────────────────────────
  // T18 new namespaces (parity with zh-CN.ts)
  // ─────────────────────────────────────────────────────────────────
  outline: {
    title: 'Outline',
    empty: 'No outline',
    toggleExpand: 'Expand outline',
    toggleCollapse: 'Collapse outline',
    resizeLabel: 'Drag to resize outline width',
  },
  status: {
    emptyTitle: 'No file opened yet',
    emptySubtitle: 'Open your first Markdown file to start reading and rendering',
    emptyOpen: 'Open Markdown file',
    loading: 'Loading…',
    errorTitle: 'Failed to load file',
    retry: 'Retry',
    errorUnknown: 'Unknown error',
  },
  statusBar: {
    progressFmt: 'Progress {{n}}%',
    wordsLinesFmt: '{{words}} words · {{lines}} lines',
    progressLabel: 'Reading progress',
  },
  recent: {
    empty: 'No recent files',
    openFile: 'Open file',
    clear: 'Clear recent files',
    clearConfirmTitle: 'Clear recent files',
    clearConfirmMessage: 'Clear all recent files? This action cannot be undone.',
    recordFailed: 'Failed to record recent file',
    clearedToast: 'Recent files cleared',
    clearFailed: 'Clear failed, please retry',
  },
  // T25 (F-27): recent directories list (independent namespace from F-03).
  recentDir: {
    title: 'Recent folders',
    open: 'Open',
    delete: 'Delete',
    clear: 'Clear',
    clearConfirm: 'Clear folder history?',
    deleteConfirm: 'Remove this folder from history?',
    clearedToast: 'Cleared',
    clearFailedToast: 'Failed to clear',
    deleteFailedToast: 'Failed to delete',
    recordFailedToast: 'Failed to record',
    relative: {
      justNow: 'just now',
      minutesAgo: '{{n}} min ago',
      hoursAgo: '{{n}} hours ago',
      daysAgo: '{{n}} days ago',
      weeksAgo: '{{n}} weeks ago',
    },
  },
  codeBlock: {
    copy: 'Copy code',
    copySuccess: 'Copied',
    copyFail: 'Copy failed, please select manually',
    fold: 'Fold code block',
    unfold: 'Unfold code block',
  },
  search: {
    containerLabel: 'Find in document',
    inputLabel: 'Find keyword',
    placeholder: 'Find keyword',
    prev: 'Previous',
    next: 'Next',
    close: 'Close',
    optionGroupLabel: 'Search options',
    caseSensitive: 'Case sensitive',
    wholeWord: 'Whole word',
    regex: 'Regex',
    regexInvalid: 'Invalid regex',
    countFmt: '{{current}} / {{total}}',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    intro: 'KITE supports the following shortcuts (modifiers auto-switch on macOS / Windows / Linux).',
    close: 'Close',
    dontShowAgain: "Don't show again",
    doneAck: 'Got it',
    rows: {
      open: 'Open Markdown file',
      find: 'Find in page',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      zoomReset: 'Reset font size (16px)',
      cycleTheme: 'Cycle theme (Light / Dark / System)',
      recentDrawer: 'Open recent files',
      scrollTop: 'Scroll to top',
      scrollBottom: 'Scroll to bottom',
      closeOverlay: 'Close top overlay',
      toggleTree: 'Toggle file tree drawer',
      historyBack: 'Back (history)',
      historyForward: 'Forward (history)',
      // T24 (F-26): open current document in external editor (Cmd/Ctrl+E).
      openExternalEditor: 'Open current document in external editor',
    },
  },
  // T24 (F-26): external editor (F-26 §P2) — button / menu / settings group / error copy.
  externalEditor: {
    buttonLabel: 'External editor',
    buttonLabelDisabled: 'Open a document first',
    menuLabel: 'Open in external editor',
    settings: {
      groupTitle: 'External editor',
      system: 'System default',
      code: 'VS Code',
      cursor: 'Cursor',
      subl: 'Sublime Text',
      mate: 'TextMate',
      notepadPlusPlus: 'Notepad++ (Windows only)',
      typora: 'Typora',
      custom: 'Custom command',
      customCmdPlaceholder: 'e.g. cursor --new-window {{path}}',
      customCmdLabel: 'Custom command template',
    },
    error: {
      notFound: 'File not found or moved: {{path}}',
      permissionDenied: 'Path out of bounds; only Markdown files in the document directory are allowed',
      invalidExtension: 'Only Markdown files are supported (.md / .markdown / .mdx)',
      invalidPath: 'Invalid path: {{message}}',
      spawnFailed: 'Cannot start editor: {{message}}. Check system PATH or change the editor in Settings',
      generic: 'Failed to open in external editor: {{message}}',
    },
  },
  theme: {
    light: 'Light',
    dark: 'Dark',
    system: 'Follow system',
    groupLabel: 'Theme',
  },
  dialog: {
    imageViewer: {
      label: 'Image viewer',
      close: 'Close image viewer',
    },
    treeDrawer: {
      label: 'File tree',
    },
  },
  image: {
    loadFail: 'Failed to load image: {{msg}}',
  },
  app: {
    fontSizeMax: 'Already at maximum font size',
    fontSizeMin: 'Already at minimum font size',
    historyStart: 'Already at history start',
    historyEnd: 'Already at history end',
    progressCorrupted: 'progress data parse failed',
    progressReset: 'Progress data has been reset',
  },
  skipLink: {
    label: 'Skip to main content',
  },
} as const;

export type EnUSMessages = typeof enUS;
export default enUS;