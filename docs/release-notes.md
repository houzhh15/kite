<!-- 本文件由 CI 自动 append，请勿手改 H1 -->

# KITE Release Notes

> 由 `scripts/append-release-notes.mjs` 在 `release.yml` Step 17 自动追加每个 release 的章节。
> 不放 `.gitignore`（NFR-AU-03）— 历史 release 信息必须随仓库提交。

<!-- append-release-notes 在此处下方新增 `## vX.Y.Z (YYYY-MM-DD)` 章节，请勿手写 -->

### T18 — i18n 双语齐备化

- **新增 12 个命名空间**：`outline` / `status` / `statusBar` / `recent` / `codeBlock` / `search` / `shortcuts` / `theme` / `dialog` / `image` / `app` / `skipLink`，覆盖 Reader 状态、Outline、Recent、Search、Shortcuts、ProgressBar、SkipLink、ImageViewer、ImageHandler 等高频 UI。
- **扫描范围扩展至全量 UI 文件**：`scripts/check-i18n-hardcode.mjs` 删除 `T15_AFFECTED_FILES` 白名单，递归扫描 `src/components/` + `src/stores/` + `src/App.tsx` + `src/main.tsx`，新增 JSX 文本节点扫描；`REQUIRED_KEYS` 扩展至 60+ 项（覆盖 24 个命名空间）。CI release / PR 流水线均接入 `npm run check-i18n-hardcode` 步骤，与 lint / typecheck 并列。
- **E2E 测试新增 9 个用例**（`e2e/i18n.spec.ts`）：T18-E01 ~ E09 覆盖 `empty-state` / `outline-title` / `progress-status-bar` / `search-input` / `recent-list-empty` / `codeblock-copy` / `skip-link` / `theme-switcher` 等关键 `data-testid` 在 zh-CN ↔ en-US 切换下的文案同步。
- **字典 parity 测试新增 4 个用例**（`src/i18n/__tests__/i18n.test.ts`）：i18n-2 / i18n-3 / i18n-4 / i18n-5 覆盖全命名空间键集合双向差集为空、模板插值（`progressFmt` / `wordsLinesFmt` / `image.loadFail` / `search.countFmt` / `common.externalOpened`）、非空值校验。
- **占位符统一**：所有 `{{var}}` 模板（`export.successHtml` / `pdfHint` / `failGeneric` 等）已迁移至 i18next 默认 `{{var}}` 语法（C-08）。
- **CONTRIBUTING.md 新增 i18n 翻译键命名规范章节**：点路径 / 动名词 / `*Fmt` 后缀 / `{{var}}` 占位符 / 嵌套子模块的纪律。

## v0.0.1 (2026-07-03)

### Commit range (v0.0.0..HEAD)

```
(git log failed: Command failed: git log v0.0.0..HEAD --oneline)
```

### Artifacts

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `../../../../tmp/test-trayhost/test.exe` | 3703202 | `a11b1f65d88c895eb29945bf6a02582aa64f1363265e38068c43ab0b41d610de` |
| `../../../../tmp/trayhost-test.exe` | 179382 | `f83569c28a28e2d0f395f625ea3e6d13e0854f6d4340345ef3ad3fe1f8c955f4` |

### Audit

_No active audit exceptions recorded. cargo audit + npm audit both gate the release._


## v0.0.1 (2026-07-03)

### Commit range (v0.0.0..HEAD)

```
(git log failed: Command failed: git log v0.0.0..HEAD --oneline)
```

### Artifacts

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `../../../../tmp/test-trayhost/test.exe` | 3703202 | `a11b1f65d88c895eb29945bf6a02582aa64f1363265e38068c43ab0b41d610de` |
| `../../../../tmp/trayhost-test.exe` | 179382 | `f83569c28a28e2d0f395f625ea3e6d13e0854f6d4340345ef3ad3fe1f8c955f4` |

### Audit

_No active audit exceptions recorded. cargo audit + npm audit both gate the release._

