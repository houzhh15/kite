/**
 * src/components/SettingsPanel.tsx — 设置面板 dialog 容器.
 *
 * 设计依据: docs/design/compiled.md §3.6 + T04 扩展 (字号 / 行高).
 *
 * T03 阶段: 由 T03 step-09 落地, 仅含 ThemeSwitcher + 关闭按钮.
 * T04 阶段: 新建 `Settings.tsx` 含 ThemeSwitcher + 字号滑块 + 行高按钮组 + 关闭按钮.
 *           本文件保留为重导出, 兼容外部 `import { SettingsPanel }` 调用面 (Toolbar 等).
 *           T03 既有 UI 行为 (open=false → null; 含 role="dialog" 等) 由 Settings.tsx 继承.
 *
 * 纪律:
 *   - 本文件不再写实现; 只做 alias.
 *   - Toolbar / App 调用面不动 (外部 import 仍走 SettingsPanel).
 *   - 删除 T03 旧实现前, 已通过 Settings.test.tsx 测试覆盖 Settings 的全部行为.
 */

export { Settings as SettingsPanel } from './Settings';
export type { SettingsProps as SettingsPanelProps } from './Settings';