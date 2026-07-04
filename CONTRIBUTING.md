# Contributing to KITE

> 提交规范、CI 行为契约、release 流程指引。

## Pull Requests

- **PR 不触发 release job**：`release.yml` 仅在 `push tag v*.*.*` 与 `workflow_dispatch` 时触发，pull_request 触发的是 `.github/workflows/ci.yml`（前端 build + 体积门禁 + perf 占位）。
- **Fork PR 无法读 secrets**：Apple Developer ID / DigiCert 等证书 secrets 仅在仓库内 PR 可用，fork PR 走默认 `ci.yml` 路径，不会触发签名步骤。
- **lockfile**：请勿手改 `package-lock.json` 或 `src-tauri/Cargo.lock`；如需更新依赖，请在 PR 描述里说明原因。
- **类型 / Lint**：`npm run typecheck` 与 `npm run lint` 必须本地通过；CI 会再跑一次。
- **测试**：`npm test`（vitest）。

## Commits

- 单一职责，每 commit 一个逻辑变更。
- 提交信息格式：`<scope>: <imperative summary>`，scope 例：`ci` / `feat` / `fix` / `refactor` / `docs` / `test` / `perf`。
- T14 引入的 release commit 自动 append 到 `docs/release-notes.md` + `docs/perf.md`，由 CI bot 推送（`ci@kite.local`）。

## 发布（Maintainer only）

1. 确认 `package.json` `version` 已 bump 且与下游 docs 一致。
2. `git tag v<semver>` 后 `git push --tags` 触发 `.github/workflows/release.yml`。
3. workflow 完成两个 job（macos-latest + windows-latest）后，artifacts 自动上传到 GitHub Actions；`docs/release-notes.md` 与 `docs/perf.md` 自动 commit 到 master。
4. 如需手动 dry-run：Actions → release → Run workflow（可填 `version` override）。

### 所需 secrets（可选）

| Secret                         | 用途                |
| ------------------------------ | ------------------- |
| `WINDOWS_CERT_PFX_BASE64`      | Windows EV/OV 签名  |
| `WINDOWS_CERT_PFX_PASSWORD`    | PFX 解锁密码        |
| `MACOS_CERT_P12_BASE64`        | Apple Developer ID 证书 |
| `MACOS_CERT_P12_PASSWORD`      | P12 解锁密码        |
| `MACOS_SIGN_IDENTITY`          | 签名身份字符串      |

无上述 secrets 时 release job 走 `skip-sign-*` 分支；artifacts 仍会上传（未签名），下游维护者可人工分发。

## 安全审计

- `cargo audit --deny warnings` 与 `npm audit --audit-level=high` 任一 High/Critical 漏洞即阻断 release。
- 仅 Medium 及以下漏洞可登记到 `docs/security-audit-exceptions.md` 的 Active Exceptions 表（需含 Expires / Owner / PR 字段）。
- High/Critical 必修，禁止登记豁免。

## i18n 翻译键命名规范

T18 起，前端所有可见 UI 文案必须通过 `useTranslation()` 消费的 `t('namespace.key')` 形式声明，
禁止在 `src/components/**`、`src/stores/**`、`src/App.tsx` 中出现硬编码 CJK 字符串。
静态校验由 `node scripts/check-i18n-hardcode.mjs` 强制门禁；缺失键 / 硬编码命中任一存在则 `exit 1` 阻断 CI。

### 1. 路径形式

所有键以点路径 (`ns.key`) 形式声明，命名空间作为一级前缀：

```
<namespace>.<action>.<context?>
```

示例：

- `outline.title` — 命名空间 + 名词。
- `status.emptyTitle` — 命名空间 + 状态名。
- `statusBar.progressFmt` — 命名空间 + 模板名（`Fmt` 后缀）。
- `dialog.imageViewer.label` — 命名空间 + 子模块 + 名词。

### 2. 命名纪律

| 规则 | 示例 | 反例 |
| --- | --- | --- |
| 动词用动名词 | `open` / `close` / `clear` / `retry` | `opening` / `opened` |
| 模板用 `*Fmt` 后缀 | `progressFmt` / `wordsLinesFmt` / `countFmt` | `progressTemplate` |
| 占位符用 i18next 默认 `{{var}}` 语法 | `{{n}}` / `{{words}}` / `{{url}}` | `{n}` / `%s` |
| 嵌套子模块用点路径 | `dialog.imageViewer.label` | `imageViewerLabel` |
| 同一概念复用既有键 | `common.open`（如存在） | 新建 `toolbar.openFile` |

### 3. 占位符统一（C-08）

所有占位符使用 i18next 默认 `{{var}}` 双花括号语法；与 React 自身的 JSX 单花括号语法（`{var}`）隔离。
T18 已迁移 `export.successHtml` / `export.pdfHint` / `export.failGeneric` 三处。

```ts
// 正确 — 调用点
t('export.successHtml', { path: targetPath });

// 正确 — 字典值
successHtml: '已导出 HTML 到 {{path}}',

// 错误 — 旧语法
successHtml: '已导出 HTML 到 {path}',
```

### 4. 添加新键的工作流

1. 在 `src/i18n/zh-CN.ts` 与 `src/i18n/en-US.ts` **同步**新增键（双语必须对齐）。
2. 组件中通过 `useTranslation()` 消费，禁止在渲染期 `import i18n`（绕过 react-i18next 订阅）。
3. 若新键属于关键 UI 模块（高频可见），同步追加到 `scripts/check-i18n-hardcode.mjs` 的 `REQUIRED_KEYS` 列表。
4. 在 `src/i18n/__tests__/i18n.test.ts` 增加 parity / interpolation 断言。
5. 运行 `node scripts/check-i18n-hardcode.mjs` + `npm test -- src/i18n/__tests__/i18n.test.ts` 全绿后提交。

### 5. 命名空间清单

`common` / `toolbar` / `reader` / `tree` / `settings` / `history` / `menu` / `message` / `export` / `fullscreen` / `toast` / `fallback`（T15 既有 12 个） + `outline` / `status` / `statusBar` / `recent` / `codeBlock` / `search` / `shortcuts` / `theme` / `dialog` / `image` / `app` / `skipLink`（T18 新增 12 个）。新增命名空间前请先评审，避免 `misc` / `other` 类聚合桶。

## 本地复现 release 构建

```bash
npm ci
npm run build
(cd src-tauri && cargo tauri build --release)
```

本地产物位于 `src-tauri/target/release/bundle/{macos,msi,nsis,dmg}/`，默认未签名。

## 沟通

- 维护 PR 评论即可；非紧急 bug 不需要邮件列表。
- 安全相关披露：仓库维护者 GitHub handle（不公开邮箱）。