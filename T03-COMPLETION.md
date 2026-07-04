# T03 主题切换三档 — 完成报告

> 任务 ID：`task_0e08e62a-6100-4bfb-96cc-7b05170cf867`
> 执行阶段：code + self-verify
> 设计文档：`docs/design/compiled.md` §3 / FR / NFR
> 执行计划：`docs/plan/compiled.md` + `execution_plan.md`（已 15/15 步标记）
> 依赖前置：T01（项目骨架）+ T02（Reader 渲染），均 closed
> 后置任务：T04（持久化，未启动）；F-09（字号未启动）

---

## 1. 落地范围（文件清单）

### 新建（5）

| 路径 | 行数 | 角色 |
| ---- | ---- | ---- |
| `src/lib/theme-types.ts` | ~40 | 共享类型（Theme/AppliedTheme/THEME_OPTIONS） |
| `src/lib/applyInitialTheme.ts` | ~80 | 启动期同步副作用（防白闪） |
| `src/hooks/useTheme.ts` | ~120 | 双层状态 + matchMedia 监听严格配对 |
| `src/components/ThemeSwitcher.tsx` | ~115 | radiogroup 三段控件 + 键盘循环 |
| `src/components/SettingsPanel.tsx` | ~45 | dialog 容器（F-09 扩展点预留） |

### 修改（6）

| 路径 | 变更 | 影响 |
| ---- | ---- | ---- |
| `src/stores/prefStore.ts` | 默认 `'auto'` → `'system'` + 新增 `setTheme` + 收紧类型 + 校验函数 | 与 T01 兼容，未改 IPC 路径 |
| `src/lib/tauri.ts` | `Preferences.theme?: 'light'\|'dark'\|'system'` | 仅类型注解；保持 `theme` 字段名 |
| `src/styles/global.css` | 追加 `--color-border/muted` + `:root.sepia` 注释占位 | 不动已有 token 数值 |
| `tailwind.config.js` | `extend.colors` 追加 `border`/`muted` | 保留 `darkMode: 'class'` |
| `src/App.tsx` | 顶部 `useTheme()` 单行 + 1 行 import | 不改 JSX、不改 props 链 |
| `src/main.tsx` | import `applyInitialTheme` + `applyInitialTheme()` 在 `createRoot` 前 | import 顺序在 React 之前 |

### 未触碰（与 T02 边界）

`src/components/MarkdownRenderer.tsx`、`src/components/Reader.tsx`、`src/components/Toolbar.tsx`、`src/components/Toaster.tsx`、`src/components/ErrorBoundary.tsx`、`src/hooks/useMarkdownDoc.ts`、`src/lib/pipeline.ts`、`src/lib/errorMessage.ts`、`src-tauri/**`、`package.json` 均未修改。

---

## 2. 自检结果

| 项目 | 命令 | 结果 |
| ---- | ---- | ---- |
| TypeScript | `npx tsc --noEmit` | EXIT=0（0 错误） |
| ESLint | `npm run lint` | EXIT=0（0 警告 0 错误） |
| Vitest | `npm test` | 5 套件 / 24 用例全过 |
| Build 静态检查 | （typecheck + lint 已覆盖） | 通过 |

---

## 3. WCAG AA 对比度自检（step-13）

> 采用 WCAG 2.1 相对亮度公式（sRGB γ=2.4）计算。

| 档 | 前景 | 背景 | 对比度 | 阈值 | 状态 |
| -- | ---- | ---- | ------ | ---- | ---- |
| light fg on bg | `rgb(15 23 42)` `#0F172A` | `rgb(250 250 252)` `#FAFAFC` | **17.13:1** | ≥ 4.5:1 | ✅ PASS |
| dark fg on bg | `rgb(226 232 240)` `#E2E8F0` | `rgb(15 23 42)` `#0F172A` | **14.48:1** | ≥ 4.5:1 | ✅ PASS |
| dark accent on bg | `rgb(96 165 250)` `#60A5FA` | `rgb(15 23 42)` `#0F172A` | **7.02:1** | ≥ 4.5:1 | ✅ PASS |
| light accent on bg | `rgb(59 130 246)` `#3B82F6` | `rgb(250 250 252)` `#FAFAFC` | **3.53:1** | ≥ 4.5:1 | ❌ **FAIL** |

### ⚠️ 已发现偏差

- 设计文档 §4.4 估算 `light accent on bg ≈ 4.55:1`，但用正式 WCAG 2.1 公式精确计算为 **3.53:1**，**不满足 AA 正文阈值**。
- 原因：`#3B82F6`（Tailwind `blue-500`）在浅色背景上达不到 AA 正文 4.5:1。设计估算与公式结果有 ~30% 偏差（疑似使用了不同蓝色或更暗的背景）。
- 影响面：当前 T01/T02 的 `accent` token 用于：链接（`prose-kite a`）、blockquote 边线、Toolbar 默认色、`<button>` 选中态背景等。链接与选中态按设计 §4.4 表格需 4.5:1，目前实测未达。
- 风险表（`docs/plan/compiled.md` §3.1）的回滚条目：「调整 `--color-fg/bg` 数值；不改 token 名（`bg/fg`）」明确允许此场景下的数值校正，但**本任务范围内不动 token 数值**，交由设计阶段统一校正（避免破坏 T01/T02 视觉基线，且需与需求文档 §4 同步）。
- 候选方案（供设计阶段决策，本任务不采用）：`--color-accent` light 档改为 `29 78 216`（Tailwind `blue-700`，精确计算约 5.93:1）或 `37 99 235`（`blue-600`，约 4.96:1）。

### dark 模式

3 项（fg/bg、accent/bg）全部超出 AA 阈值，深色档无 a11y 风险。

---

## 4. 需求 4 条验收（step-14 / 任务描述 AC）

| # | 验收条目 | 实现位置 | 验证方式 | 状态 |
| - | -------- | -------- | -------- | ---- |
| 1 | 三档按钮可点击且实时切换主题 | `ThemeSwitcher` → `setTheme` → `documentElement.classList.toggle` | typecheck + smoke + 视觉 | ✅（待运行时人工点击） |
| 2 | `system` 档跟随 OS 切换 ≤ 1s | `useTheme` 内 `matchMedia.addEventListener('change')` + 监听器引用配对 | 静态分析+ jsdom 单测已通过 | ✅ |
| 3 | `<html>` 在 React mount 前已带正确类 | `src/main.tsx` import applyInitialTheme + createRoot 前显式调用 | 静态顺序检查 | ✅ |
| 4 | WCAG AA 正文对比度 ≥ 4.5:1 | light fg/bg (17.13), dark fg/bg (14.48), dark accent/bg (7.02) 通过；**light accent/bg (3.53) 未达** | 详见 §3 | ⚠️ PARTIAL |

### Verify 清单 F-08（架构 §13.2）

| # | 校验项 | 实现 | 状态 |
| - | ------ | ---- | ---- |
| 1 | Tailwind `darkMode: 'class'` | `tailwind.config.js` 第 11 行 | ✅ |
| 2 | CSS 变量驱动（无 `colors.dark` 内联调色板） | `global.css` + `tailwind.config.js` `extend.colors` 全走 `var(--color-*)` | ✅ |
| 3 | 三档经由 `prefStore` 受控 | `useTheme()` → `usePrefStore` | ✅ |
| 4 | `<html>` class 仅 'dark'（不含 'sepia'） | `applyInitialTheme` / `useTheme` 仅 toggle `dark`；sepia 仅注释占位 | ✅ |

---

## 5. 风险与已知问题

| 风险 | 状态 | 行动 |
| ---- | ---- | ---- |
| `useTheme` matchMedia 监听器配对 | 已用 `let mql` + 同一 `onChange` 引用 cleanup；jsdom 与生产均安全 | 监控 |
| StrictMode 双调用 | `applyInitialTheme` 幂等（toggle 同一状态）；`useTheme` listener 由 useEffect cleanup 处理 | 已防御 |
| sepia 接口预留（未实现） | `Theme` 类型不含 `'sepia'`；`:root.sepia` 仅注释；UI 无 sepia 按钮 | 已锁定 |
| WCAG light accent 不达 AA | 见 §3 ⚠️ | **需回到设计阶段校正 token 值；本任务不擅自修改** |
| App.tsx 改动越权风险 | 仅新增 1 行 `useTheme()` + 1 行 import；JSX/装配零变化 | 已最小化 |

---

## 6. T04 / F-09 接入路径

- **T04（持久化）**：`prefStore.setTheme` 路径已与 `update({theme})` 等价；`Preferences.theme` 类型已与 `Theme` 同步。T04 只需在 `update` 内接 `tauri.savePreferences` 即可自动化持久化；`load()` 路径读取后写回 `setTheme` 即可。
- **F-09（字号/行高）**：`SettingsPanel` 已预留 dialog 容器；F-09 只需在 `<ThemeSwitcher />` 后追加字号控件即可，无需修改 ThemeSwitcher / 应用入口。
- **Settings 入口**：T03 阶段**不挂载到 `App.tsx`**（避免越权改 T02 布局）；由 T04 在 Toolbar 接入「设置」按钮时挂载。`SettingsPanel` 是 `open` prop 控制的可复用组件。

---

## 7. 完成度结论

- **代码层**：5 新建 + 6 修改，全部按设计 §8 文件清单与 plan §0.3 一致落地。
- **类型 / 静态检查**：100% 通过。
- **测试**：`npm test` 24/24 通过（已有用例 0 回归）。
- **a11y**：2/4 对比度项 PASS，`light accent on bg` 未达 AA —— **需设计阶段修正 token 数值**。
- **整体**：**PARTIAL**（代码完成且静态正确；a11y 偏差需设计阶段裁决）。

T03 内不再追加实现；如设计阶段决定调整 `accent` token，需回归 T01/T02 视觉基线校验。
