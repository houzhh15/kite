# KITE — Security Audit Exceptions (T14 / C-06 / FR-08 / NFR-S-05)

> **仅 Medium 及以下生效，High / Critical 必修。** 任何新增豁免必须在本表
> 提交一行（含 CVE / advisory id、影响范围、过期日期、负责人），并经维护者
> 在 PR 中显式 `@-mention` 评审通过。未在本表登记的漏洞仍按默认阻断
> (`cargo audit --deny warnings` 失败、`npm audit --audit-level=high` 失败)。

## Schema

| Field       | Description                                          |
| ----------- | ---------------------------------------------------- |
| Advisory    | CVE-YYYY-NNNN 或 GHSA-xxxx / RUSTSEC-YYYY-NNNN       |
| Severity    | Low / Medium（High/Critical 禁止写入）              |
| Component   | 影响的 crate / npm package                            |
| Reason      | 豁免原因（修复进度、误报、依赖限制）                 |
| Expires     | YYYY-MM-DD（超过该日自动失效）                       |
| Owner       | GitHub handle                                        |
| PR          | 引入该豁免的 PR 编号                                 |

## Active Exceptions

<!-- 行示例:
| RUSTSEC-2024-0001 | Medium | ring 0.16 | 升级需 Rust 1.75，本仓库最低 1.74 | 2026-12-31 | @alice | #1234 |
-->

| Advisory | Severity | Component | Reason | Expires | Owner | PR |
| -------- | -------- | --------- | ------ | ------- | ----- | -- |
| _empty_  |          |           |        |         |       |    |

## Audit Hook 契约

`scripts/append-release-notes.mjs` 在写入 release-notes 时会读取本文件的
`Active Exceptions` 段，**仅**对 `Severity ∈ {Low, Medium}` 的行作为 audit
ignore 列表来源；任何非合规行（含 High / Critical、空 reason / expires /
owner）会被脚本以非零退出码拒绝并打印至 `$GITHUB_STEP_SUMMARY`。