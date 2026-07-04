# KITE — Markdown 阅读器

KITE 是一个基于 Tauri 2 的本地 Markdown 阅读器，强调严格 CSP、单一 IPC 出口、清晰的三层架构。

## 范围声明

T01 骨架 + T02 Reader 渲染 + T03 主题切换（内存态）已落地；后续 F-01~F-17 多数仍待实现。

- 需求文档：`/Users/tshinjeii/.mote/aidglite/projects/KITE/tasks/task_f34a36aa-6726-45d2-b2a1-52fa8a7ead50/docs/requirements/compiled.md`
- 设计文档：`/Users/tshinjeii/.mote/aidglite/projects/KITE/tasks/task_f34a36aa-6726-45d2-b2a1-52fa8a7ead50/docs/design/compiled.md`
- 执行计划：`/Users/tshinjeii/.mote/aidglite/projects/KITE/tasks/task_f34a36aa-6726-45d2-b2a1-52fa8a7ead50/docs/plan/compiled.md`

## T03 — 主题切换三档（已落地）

三档主题（浅色 / 深色 / 跟随系统）已实现：

- 入参校验：仅 `light | dark | system` 三档字面量；非法值 `console.warn` 忽略；
- 启动防白闪：`src/main.tsx` 在 `createRoot` 前同步调用 `applyInitialTheme()`，避免夜间用户在 light 默认下看到首屏白闪；
- 系统跟随：`theme === 'system'` 时挂 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 监听器，`unmount` 时严格配对 `removeEventListener`（无泄漏）；
- a11y：`<ThemeSwitcher>` 用 `role="radiogroup"` + `role="radio"` + `aria-checked`；键盘左右键循环切换；
- CSS 变量：`--color-bg/fg/accent/border/muted` 全部走语义 token；Tailwind `darkMode: 'class'`；sepia 接口预留（CSS 注释占位），UI 不暴露；
- **持久化由 T04 接管**；本任务仅内存态。F-09（字号/行高）后续任务在 `<SettingsPanel />` 容器内追加控件即可，不需修改 ThemeSwitcher。

完成报告：`T03-COMPLETION.md`（含 WCAG AA 自检结果、需求 4 条 AC、Verify F-08 清单）。

## T15 — P2：目录树 / 双语 / 历史记录（已落地）

- **目录树（F-18 / FR-01）**：`src/components/FileTree.tsx` 经 `React.lazy` 接入，左侧 280px 抽屉按 Ctrl/Cmd+T 切换，文件夹懒加载子项，叶子点击触发 `docStore.loadFile`；Rust 端新增 `list_dir` 命令 + `fs_reader::list_dir` 服务，过滤 `.md/.markdown/.mdx`、保留「含 md 子项」的目录。
- **双语界面（F-23 / FR-03）**：`react-i18next` 接入；`src/i18n/{index,zh-CN,en-US}.ts` 提供完整字典；设置面板新增语言 `<select>`，即切即用，缺键 dev 模式控制台 warn。
- **历史栈（F-24 / FR-04）**：`docStore.history` 子模块 — `pushHistory / moveCursor / loadFile / canGoBack / canGoForward`，容量 50，Ctrl/Cmd+[/] 翻页，状态栏显示 `cursor+1 / total`。
- **语言持久化（FR-05）**：通过 `tauri-plugin-store` 的 `preferences.language`，启动 hydrate，非法值回退 `zh-CN`。

### 快捷键速查（README 登记）

| 快捷键 | 动作 |
|---|---|
| `Ctrl/Cmd + T` | 切换目录树抽屉（FR-01） |
| `Ctrl/Cmd + [` | 后退（历史 / FR-04） |
| `Ctrl/Cmd + ]` | 前进（历史 / FR-04） |
| `Ctrl/Cmd + O` | 打开 Markdown 文件 |
| `Ctrl/Cmd + F` | 页内查找 |
| `Ctrl/Cmd + =/-/0` | 字号 / 重置 |
| `Ctrl/Cmd + Shift + L` | 切换主题 |
| `Ctrl/Cmd + Shift + P` | 最近文件抽屉 |
| `Esc` | 关闭最上层浮层 |

语言切换入口：`设置面板 → 语言 → 简体中文 / English`。

## T07 — 行内格式与链接处理（已落地）

- **工具层**：`src/lib/inline/urlSafe.ts` 协议白名单 + 锚点 + data 图片 + 长度上限；`src/lib/inline/slugify.ts` 中文 NFKD 保留；`src/lib/inline/wikiResolve.ts` LRU + flag short-circuit。
- **解析层**：`src/lib/inline/remarkInlineMarks.ts` 自研 remark 插件支持 `==…==` / `~…~` / `^…^`，由 `lib/featureFlags.ts` 控制开关。
- **组件层**：`LinkHandler`（外链/锚点/危险/相对路径四分支 + 强制 `rel="noopener noreferrer"`）；`ImageHandler`（危险协议改写 + IPC 缓存 + `data-broken` 占位）；5 个 inline 组件 `MarkHighlight` / `SubMark` / `SupMark` / `DelStrike` / `InlineCode`。
- **状态层**：`src/stores/inlineStore.ts`（lastExternal 5s TTL + tooltip 自增 key）。
- **反馈层**：`StatusBar.ExternalDomainChip`（状态栏右侧域名反馈）+ `LinkTooltip`（Portal 浮层，1.5s 自动消失 + 200ms fade + 视口右溢出修正）。
- **样式**：`src/styles/inline.css` 行内 anchor / mark / sub / sup / del / code / wiki-missing / tooltip / chip。
- **安全**：`samples/with-script.md` 渲染后 DOM 中 `<script>` 元素数 = 0（`src/__tests__/samples/with-script.spec.tsx` 自动化）。

详细设计 / 需求 / 计划：本任务 `tasks/task_e441c2f5-7bc8-42e0-add8-2642d0c2a0b2/docs/{requirements,design,plan}/compiled.md`。

## 必备工具

- Node.js ≥ 18
- Rust toolchain (`rustup` + `cargo`) ≥ 1.78
- Tauri CLI（由项目 devDep `@tauri-apps/cli` 提供）

## 安装与运行

```bash
# 安装前端依赖
npm install

# 仅前端 dev server（不启窗口）
npm run dev

# Tauri 开发窗口（前端 + Rust 一起跑）
npm run tauri dev

# 构建前端（不构建 Rust 安装包）
npm run build

# 构建 Tauri 安装包
npm run tauri build
```

## 验证脚本

| 命令 | 作用 | 覆盖 |
| --- | --- | --- |
| `npm run typecheck` | TS 类型检查 | AC-04-1 / AC-07-1 |
| `npm run lint` | ESLint 守卫 | R-04 三重防护 |
| `npm run check-deps` | 扫描禁用包 | R-03 / NFR-SEC-01/03 |
| `npm run check-csp` | 校验严格 CSP | AC-06-2 / NFR-SEC-02 |
| `npm run check-contract` | 校验 IPC 契约单一来源 | R-04 |

> T01 当前仅落地占位窗口（"Hello KITE"），命令体为 `unimplemented!()`，**不要**在 dev 窗口里尝试触发 IO。

## 安全护栏

- 严格 CSP 来自 `src-tauri/tauri.conf.json`，不引入内联脚本。
- `src-tauri/src-tauri/src/services/` 占位空模块，等待后续任务填充。
- `src/lib/tauri.ts` 是唯一 IPC 出口；其他文件禁止 `import { invoke } from '@tauri-apps/api/core'`。
- 前端禁止直接 `import 'fs' / 'node:fs' / 'path' / 'node:path'`。

## 本地 release 构建（T14 / F-30 / F-45）

```bash
# 1) 安装前端依赖（锁读 lockfile）
npm ci

# 2) 前端 build（含 check-console-drop / terser）
npm run build

# 3) Tauri 双平台 bundle（macOS 跑出 .app + .dmg，Windows 跑出 .msi + .exe）
cd src-tauri && cargo tauri build --release
```

产物位于 `src-tauri/target/release/bundle/{macos,msi,nsis,dmg}/`；本地构建默认
**不签名**（`tauri.conf.json` 的 `bundle.macOS` 不含 `signingIdentity`）。

CI 完整流水线：`.github/workflows/release.yml`，触发条件：

- `push` tag `v*.*.*` — 完整 audit + size-check + （若有 secrets）签名 + 上传 artifact
- `workflow_dispatch` — 手动 dry-run（无需 secrets 全绿）

所需 secrets（可选，缺失则走 `skip-sign-*` 分支并仍然上传未签名 artifact）：

| Secret                         | 用于     | 平台          |
| ------------------------------ | -------- | ------------- |
| `WINDOWS_CERT_PFX_BASE64`      | 签名     | windows-latest |
| `WINDOWS_CERT_PFX_PASSWORD`    | 签名     | windows-latest |
| `MACOS_CERT_P12_BASE64`        | 签名     | macos-latest   |
| `MACOS_CERT_P12_PASSWORD`      | 签名     | macos-latest   |
| `MACOS_SIGN_IDENTITY`          | 签名身份 | macos-latest   |

校验脚本：

| 命令                            | 作用                                              |
| ------------------------------- | ------------------------------------------------- |
| `npm run check-bundle-config`   | 校验 `tauri.conf.json` 的 bundle 字段齐备 + GUID 正则 |
| `npm run check-perf-budget`     | bundle 体积 < 30 MB + Cargo release profile 五项参数 |
| `npm run append-release-notes`  | 手动 append `docs/release-notes.md` 章节（CI 也会调）  |
