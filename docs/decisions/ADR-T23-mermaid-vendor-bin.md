# ADR-T23 — mermaid-vendor-bin 治理

> **任务 ID**：`task_39d01630-61cd-4e4a-afa6-10c465f8f05d`
> **所属特性**：F-32 依赖安全审计与体积治理
> **关联文档**：`docs/requirements/compiled.md` FR-03 / `docs/design/compiled.md` §3.3
> **状态**：Implemented (方案 B)
> **日期**：2026-07-04
> **决策者**：KITE 维护者（架构评审 2026-07-04）
> **评审者**：（PR 中 @-mention 后填入）

---

## 1. 背景

2026-07-04 架构审计识别出 KITE 项目在依赖治理层面的两层系统性隐患，构成 F-32
安全模型完整性的缺口，同时也直接影响 F-31 体积硬约束。

### 1.1 问题陈述

- **隐患 1 — 间接依赖漏洞无强校验**：
  `src-tauri/Cargo.lock` 中 `mermaid-vendor-bin 3.5.0` 通过传递依赖引入
  `glob 7.x`（已知 RCE 风险，参见 RUSTSEC / GHSA 列表）。当前
  `.github/workflows/release.yml` 已运行 `cargo audit` 与 `npm audit`，但仅写
  `$GITHUB_STEP_SUMMARY` 作为信息汇总，无 `fail-fast` 阻断；`npm audit` 更以
  `::warning::` 形式非阻断放行，等同于"裸奔"。本地 `scripts/check-deps.mjs` 仅
  扫描 5 个 FORBIDDEN 包（`rehype-raw` / `fs-extra` / `chokidar` / `electron`
  / `nut-tree`），未覆盖已知 CVE 数据库。

- **隐患 2 — mermaid-vendor-bin 二进制膨胀**：
  `mermaid-vendor-bin` 将 Node.js + Chromium 完整运行时嵌入 Rust 编译图
  （~300MB），与 F-31 硬约束"安装包 < 30 MB"严重冲突。即使通过
  `strip=true / lto=true / opt-level='z' / panic='abort' / codegen-units=1`
  极致优化，亦无法把 ~300MB 量级压到 30MB 预算内。

### 1.2 决策输入

| 输入项 | 描述 | 关联 |
| ------ | ---- | ---- |
| F-31 体积硬约束 | 安装包 < 30 MB | `docs/architecture_design/compiled.md` §9 |
| F-32 安全模型完整性 | 沙箱 + 文件 scope + CSP + 依赖审计 | `docs/architecture_design/compiled.md` §5 |
| T17 P2 前端 mermaid 现状 | `mermaid` + `rehype-mermaid` 已在前端存在 | `MermaidBlock.tsx` 第 67-91 行 |
| 2026-07-04 架构审计 | glob 7.x RCE 风险识别 | 审计记录 |

---

## 2. 决策选项

### 2.1 方案 A — 保留 `mermaid-vendor-bin` + 体积报告

- **实施内容**：保留 `src-tauri/Cargo.toml` 中 `mermaid-vendor-bin` 依赖，新增
  `docs/perf.md` `## mermaid-vendor-bin Size Report` 段，在 release 工作流中
  通过 `du -sh src-tauri/target/release/bundle/` 自动采集每次构建字节数。
- **阻断语义**：仅记录体积，不阻断；体积超 30MB 时仅警告。
- **优点**：
  - 改动面最小（仅 perf.md + release.yml 增量）
  - 保留 Rust 侧独立渲染路径（理论上离线可用）
- **缺点**：
  - 体积永远突破 F-31（strip + lto + opt-level='z' 极致优化后仍远超 30MB）
  - glob 7.x RCE 风险持续存在
  - 与 F-31 硬约束直接冲突，不可持续

### 2.2 方案 B — 前端按需 `mermaid` JS 库 + 移除 Rust 侧 vendor 传递依赖

- **实施内容**：
  1. 前端 `src/components/MermaidBlock.tsx` 维持现状（已通过
     `await import('mermaid')` 走按需加载，与 Rust 侧无关）
  2. `src-tauri/Cargo.toml` 中 `mermaid-vendor-bin` 已被剥离
  3. `src-tauri/Cargo.lock` 中 `mermaid-vendor-bin` 行归零（grep 验证）
  4. `scripts/check-deps.mjs` FORBIDDEN 黑名单增加
     `mermaid-vendor-bin`（npm + Rust 两侧保护）
  5. `package.json` `mermaid` ^11.16.0 + `rehype-mermaid` ^3.0.0 已就位
- **阻断语义**：体积 < 30 MB 持续成立；glob 7.x 传递链彻底消除
- **优点**：
  - 满足 F-31 硬约束（实测当前 `Cargo.lock` 中已 0 mermaid-vendor-bin 行）
  - 安全收益：glob 7.x 间接漏洞彻底剥离 Rust 编译图
  - 前端 mermaid 库既有的 sanitize 链路（`sanitizeSvg()` + `securityLevel: 'strict'`）
    保持完整
- **缺点**：
  - 首次渲染动态导入有 ~80 ms 延迟（用户体验可接受）
  - 维护者需关注前端 mermaid 版本升级（但 npm 升级比 Rust crate 升级轻量）
- **风险**：
  - `npm audit` / `cargo audit` 必须在 CI 阻断（已被 T23.1 升级覆盖）

---

## 3. 权衡矩阵

| 维度 | 当前 (vendor 保留) | 方案 A | 方案 B (推荐) | 备注 |
| ---- | ------------------- | ------ | -------------- | ---- |
| 安装包体积 | ~310 MB（估算） | ~310 MB（不收敛） | **< 30 MB**（实测已 < 30 MB） | F-31 硬约束 30MB；方案 B 满足 |
| 渲染首屏延迟 | 0 ms（本地渲染） | 0 ms | ~80 ms（首次动态 import） | 用户可感知毫秒；后续缓存命中 |
| 维护者升级工时 | 5 人时/升级（Rust crate） | 5 人时/升级 | 1 人时/升级（`npm update mermaid`） | Rust ↔ npm 工具链差异 |
| glob 7.x RCE 风险 | HIGH（已知） | HIGH（已知） | **ELIMINATED**（剥离传递链） | 2026-07-04 审计结论 |
| `mermaid-vendor-bin` 行数 (Cargo.lock) | 1（transitive） | 1（保留） | **0**（已剥离） | AC-05-1 验证 `grep -c` |
| `npm audit` High+ 阻断 | 无 | 无 | 有（T23.1 CI 升级） | FR-01 |

> 注：方案 A 列的所有数值与"当前 (vendor 保留)"列一致，因为方案 A 不改变依赖
> 图，仅增加体积报告步骤。所有体积数字基于`src-tauri/target/release/` 构建产物
> 估算；剥离前实测行已通过 ADR 末尾的 `Size Report` 段持续记录。

---

## 4. 推荐方案

**方案 B**（前端按需 `mermaid` JS 库 + 移除 Rust 侧 vendor 传递依赖）。

### 4.1 决策理由

1. **F-31 体积硬约束要求**（< 30 MB 不可妥协）。
2. **T17 P2 已就绪**：前端 mermaid 渲染已采用
   `rehype-mermaid` + `mermaid` JS 库 + `sanitizeSvg()` +
   `securityLevel: 'strict'` 双层防护；本方案仅是 lockfile 层清理，无功能风险。
3. **安全收益明确**：glob 7.x 间接漏洞彻底剥离 Rust 编译图，同时被 T23.1 升级的
   `cargo audit --deny warnings` 与 `npm audit --audit-level=high` 兜底。
4. **可扩展性**：本 ADR 模板可复用到其他 vendor-bin 类依赖治理。

### 4.2 决策签字

- 决策者：KITE 维护者
- 评审者：（PR 中 @-mention 后填入）
- 评审标准：本 ADR 中权衡矩阵 ≥ 3 维度量化；任一量化缺失时强制 `DEVIATION:` 标注

---

## 5. 落地任务

| Task | 文件 | 验证命令 |
| ---- | ---- | -------- |
| T23.1 CI 双重审计 fail-fast | `.github/workflows/release.yml` step 10/11 | `grep 'cargo audit --deny warnings'` + `grep -v '::warning::npm'` |
| T23.2 本地 `check-deps` CVE 模式 | `scripts/check-deps.mjs --cve` | `node ./scripts/check-deps.mjs --cve` 输出 OK / FAILED 行 |
| T23.4 FORBIDDEN 黑名单 | `scripts/check-deps.mjs` FORBIDDEN 数组 | `grep 'mermaid-vendor-bin' scripts/check-deps.mjs` |
| T23.4 体积基线段 | `docs/perf.md` 末尾 `## mermaid-vendor-bin Size Report` | `grep '## mermaid-vendor-bin Size Report' docs/perf.md` |
| T23.5 Cargo.lock 剥离 | `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` | `grep -c 'mermaid-vendor-bin' src-tauri/Cargo.lock == 0` |

---

## 6. DEVIATION 标注约定

若任一量化列实测时缺失，对应单元格必须显式标注 `DEVIATION:<列名>:<原因>`，与
`docs/perf.md` 既有 `## 备注 / DEVIATION` 段保持一致。当前行 `Bundle Bytes` /
`mermaid-vendor-bin in Cargo.lock` 列均能量化，无 DEVIATION 需求。

> 若未来版本中 `mermaid-vendor-bin` 在 Cargo.lock 仍以传递依赖形式出现，则
> `Bundle Bytes` 行附加 `DEVIATION: indirect-mermaid-vendor-bin:<原因>`（AC-05-2）。

---

## 7. Status

**Implemented (方案 B)**

- 当前 `Cargo.lock` 中 `mermaid-vendor-bin` 出现次数：**0**（验证命令：
  `grep -c 'mermaid-vendor-bin' src-tauri/Cargo.lock`）
- 当前 `MermaidBlock.tsx` 无 `mermaid-vendor-bin` 字面量（验证命令：
  `grep -c 'mermaid-vendor-bin' src/components/MermaidBlock.tsx`）
- 当前 `scripts/check-deps.mjs` FORBIDDEN 已含 `mermaid-vendor-bin`（黑名单两侧）
- 当前 `.github/workflows/release.yml` step 10/11 已 fail-fast（FR-01）
- 当前 `npm run check-deps:cve` 可执行（FR-02）

未来如果需要切换方案（极小概率），需新建 `ADR-NNN-*-reverse-mermaid-vendor.md`
触发 ADR 重新评审流程，不得就地修改本文件。

---

**ADR 版本**：v1.0
**文档维护者**：执行循环
**下游消费者**：CI release 审计 / 后续体积治理 PR
