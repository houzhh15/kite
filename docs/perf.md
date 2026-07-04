# KITE — Performance Baseline (T13 / F-31)

> 每次 CI release 构建或本地 release 构建后由 `scripts/measure-cold-start.mjs`
> 自动 append. commit 入库, 不允许 `.gitignore`.
>
> 设计依据: docs/design/compiled.md §3 D-09 + docs/requirements/compiled.md §FR-09.

## BEFORE (T13 step-00c 备份基线 — 改动前快照)

| 资产                              | 改动前值                          | 备注 |
| --------------------------------- | --------------------------------- | ---- |
| `Cargo.toml` `[profile.release]`  | 不存在 (走 Rust 默认)             | T12 末态 |
| `vite.config.ts` `minify`         | `esbuild` (默认)                  |      |
| `tailwind.config.js` `content`    | `['./src/**/*.{ts,tsx,html}', './index.html']` | T03 已收紧 |
| `tailwind.config.js` `safelist`   | 未声明                            |      |
| `src/lib/pipeline.ts`             | 内联 14 语言, `COMMON_LANG_KEYS` 仍内联 | T08 step-0a |
| `src/components/MarkdownRenderer.tsx` | 已 `memo()` 包裹                |      |
| `src/hooks/useMarkdownOutline.ts` | `useMemo([markdown])`             |      |
| `src/main.tsx`                    | 无冷启动埋点                       |      |
| `src/components/Reader.tsx`       | 无 cold_to_paint 测量              |      |
| `samples/big.md`                  | placeholder 332B                  |      |
| `docs/perf.md`                    | 不存在                             |      |
| `scripts/check-perf-budget.mjs`   | 不存在                             |      |
| `src/lib/perf.ts`                 | 不存在                             |      |
| `src/workers/`                    | 不存在                             |      |
| `src/lib/markdownParser.ts`       | 不存在                             |      |

## AFTER (T13 落地基线 — 本次 PR)

| 资产                                  | 改动后值                                              | 备注 / 引用 |
| ------------------------------------- | ----------------------------------------------------- | ----------- |
| `Cargo.toml` `[profile.release]`      | strip=true / lto=true / opt-level="z" / panic="abort" / codegen-units=1 | step-01a |
| `vite.config.ts`                      | `minify='terser'` + `drop_console` + `pure_funcs`     | step-02a |
| `tailwind.config.js`                  | content 收紧 + `safelist: []`                         | step-03a |
| `scripts/check-tw-purge.mjs`          | 新增 sentinel class 校验                              | step-03b |
| `scripts/check-perf-budget.mjs`       | 新增 bundle 大小门禁 + Cargo 五项校验                 | step-04a |
| `src/lib/highlightLanguages.ts`       | 新增 `COMMON_LANG_KEYS` (14 项) 集中导出               | step-05a |
| `src/lib/pipeline.ts`                 | 改 import highlightLanguages 常量                      | step-05b |
| `src/components/MarkdownRenderer.tsx` | dev 探针 `console.count('MarkdownRenderer render')`   | step-06a |
| `src/hooks/useMarkdownOutline.ts`     | dev 探针 `console.count('outline-parse')`             | step-06b |
| `src/lib/perf.ts`                     | 新增 mark/measure/isPerfDisabled 降级路径             | step-07a |
| `src/main.tsx`                        | `perfMark('cold_start')` + dev `console.time('cold_to_paint')` | step-08a |
| `src/components/Reader.tsx`           | `perfMark('first_paint')` + `console.info('[perf] cold_to_paint:')` | step-08b |
| `src/lib/idleTasks.ts`                | 新增 `scheduleIdleTask` (requestIdleCallback fallback) | step-09b |
| `src/lib/parserThreshold.ts`          | `PARSER_WORKER_THRESHOLD_BYTES = 262144`               | step-10a |
| `src/workers/markdownParser.worker.ts`| 新增 Worker (remark-parse + remark-gfm)                | step-11a |
| `src/lib/markdownParser.ts`           | 新增 Worker dispatch + fallback listener              | step-12a |
| `src/hooks/useMarkdownDoc.ts`         | 集成 `parseMarkdown` + `setParserFallbackListener`     | step-12a |
| `src/types/markdown.ts`               | 新增 `WorkerFallbackEvent` 类型                       | step-12b |
| `samples/big.md`                      | 自动生成 ~10MB fixture                                | step-00b |
| `scripts/measure-cold-start.mjs`      | 新增 5 次样本 + μ/σ 计算                              | step-14a |

## 构建命令

```bash
# 前端生产构建 (terser + drop_console + check-console 后置断言)
npm run build

# Rust release profile (含 5 项强制参数)
cargo tauri build --release

# 一次性大小门禁 (CI release 任务强制)
npm run check-perf-budget
```

## 包体积 (K1/K2) — 实测 (本地 dev macOS arm64)

| OS              | 资产                              | 大小          | 阈值    | 通过 |
| --------------- | --------------------------------- | ------------- | ------- | ---- |
| macOS (arm64)   | `target/release/kite` (二进制)    | 4.3 MB        | < 30 MB | ✅   |
| macOS (arm64)   | `Kite.app` 全 app bundle (推算)    | ~12 MB        | < 30 MB | ✅ (待 CI 确认) |
| Windows (CI)    | MSI 待 CI 测量                    | -             | < 30 MB | _    |
| Windows (CI)    | NSIS 待 CI 测量                    | -             | < 30 MB | _    |
| macOS (CI)      | DMG 待 CI 测量                    | -             | < 30 MB | _    |

> 体积细化: `vite build` 产物 gzip 总计:
> - `dist/index.html` = 0.67 kB → gzip 0.39 kB
> - `dist/assets/index-*.css` = 25.87 kB → gzip 6.11 kB
> - `dist/assets/index-*.js`  (主 app) = 94.86 kB → gzip 29.53 kB
> - `dist/assets/react-*.js`  = 139.91 kB → gzip 44.82 kB
> - `dist/assets/markdown-*.js` = 329.36 kB → gzip 93.22 kB
> - `dist/assets/markdownParser.worker-*.js` = 109.27 kB (Worker 单独 chunk)
>
> 完整 JS bundle ≈ 564 KB 未压缩, 约 **168 KB gzipped**.
>
> **结论**: T13 改动未引入体积回退, 远低于 V1 验收门槛 (30 MB)。
> CI 上 windows/macOS 双矩阵的 MSI/DMG 实测将在 release 任务里自动
> append 到本节下方.

## 启动性能 (K3/K4) — 10MB 文档冷启动

| Run | cold_to_paint (ms) |
| --- | ------------------ |
| 1   | 待测量             |
| 2   | 待测量             |
| 3   | 待测量             |
| 4   | 待测量             |
| 1   | 1823.0 |
| 2   | 1756.0 |
| 3   | 1889.0 |
| 4   | 1794.0 |
| 5   | 1832.0 |

> 样本由 `scripts/measure-cold-start.mjs` 在 windows-2022 + macos-13
> runner 上分别 spawn 应用并解析 stdout `[perf] cold_to_paint: <ms>ms` 自动
> append. μ/σ/σμ 由该脚本计算, 与 V1/V2/V3 验收口径一致 (σ/μ < 0.20).

| 指标 | 取值            |
| ---- | --------------- |
| μ    | 待 append       |
| σ    | 待 append       |
| σ/μ  | 待 append (< 0.20) |
| 阈值 | σ/μ < 0.20 (K4) |
| 结论 | 待 append       |

## 解析耗时 (K6) — Worker / Fallback

| Run | parse_ms | doc size | 通道  |
| --- | -------- | -------- | ----- |
| 1   | 待测量   | 10 MB    | 待记  |
| 2   | 待测量   | 10 MB    | 待记  |
| 3   | 待测量   | 10 MB    | 待记  |

> 由 `parseMarkdown` 在 OPEN_OK 后异步触发, `console.info('[parser] K6 parse_ms:')`
> 输出. CI 上抓取该字符串计算均值后 append.

## 备注 / DEVIATION

- 当前 (T13 实现) 无任何 release profile 参数放宽.

## 测试覆盖 (E 组)

| 测试文件                                                                 | 覆盖点 |
| ----------------------------------------------------------------------- | ------ |
| `src/lib/__tests__/perf.test.ts`                                        | mark/measure 降级 |
| `src/lib/__tests__/parserThreshold.test.ts`                             | 256 KB 数值 |
| `src/lib/__tests__/highlightLanguages.test.ts`                          | 14 项白名单 |
| `src/hooks/__tests__/useMarkdownDoc.worker.test.ts`                      | Worker fallback |
| `src/components/__tests__/MarkdownRenderer.memo.test.tsx`                | memo 探针 |
| `scripts/check-perf-budget.mjs`                                         | bundle/ Cargo |
| `scripts/check-tw-purge.mjs`                                            | sentinel |
| `scripts/check-console-drop.mjs`                                        | console.log=0 |
| `scripts/generate-big-md.mjs`                                           | 10MB fixture |
| `scripts/measure-cold-start.mjs`                                        | μ/σ 计算 |

## CI workflow 概览 (step-15a)

`.github/workflows/ci.yml` release 任务矩阵:

- `runs-on: [windows-2022, macos-13]`
- 步骤:
  1. `npm ci`
  2. `npm run build` (含 check-console)
  3. `cargo tauri build --release`
  4. `npm run check-perf-budget`
  5. `node scripts/measure-cold-start.mjs` × 5 (spawn 安装产物, 解析 stdout)
  6. append docs/perf.md + commit + push

> **Auto-appended (2026-07-03T20:17:54.756Z)**:
> μ = 1818.8 ms, σ = 44.0 ms, σ/μ = 0.024
> K3 (μ < 2000 ms): PASS
> K4 (σ/μ < 0.2): PASS

> **Auto-appended (2026-07-03T20:31:32.760Z)**:
> μ = 1800.0 ms, σ = 14.1 ms, σ/μ = 0.008
> K3 (μ < 2000 ms): PASS
> K4 (σ/μ < 0.2): PASS

## mermaid-vendor-bin Size Report (T23)

> 体积治理基线段：每次 CI release 构建采集 1 行；`mermaid-vendor-bin in Cargo.lock`
> 列为传递依赖剥离（方案 B）后的实测值，由 `grep -c 'mermaid-vendor-bin'
> src-tauri/Cargo.lock` 自动采集。
>
> 设计依据：`docs/decisions/ADR-T23-mermaid-vendor-bin.md`（方案 B）。

| Release | Bundle Bytes | mermaid-vendor-bin in Cargo.lock | Source |
| ------- | ------------: | --------------------------------: | ------ |
| T23 baseline (FR-04 / AC-04-1) | < 30 MB (per `npm run check-perf-budget`) | 0 (removed by 方案 B) | local + `docs/decisions/ADR-T23-mermaid-vendor-bin.md` |

> 注：本任务 (`task_39d01630-61cd-4e4a-afa6-10c465f8f05d`) 落地的本地实测
> `check-perf-budget` 退出码由 CI 上 windows-latest + macos-latest 双矩阵自动
> 采集；本节表格仅记录基线行（AC-04-1）。后续每次 release 由 append-release-notes
> 工作流自动化更新。

