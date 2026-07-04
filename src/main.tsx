// KITE 前端入口 (T01 最终版; T03 step-11 在 createRoot 前应用主题)
//
// 顺序很重要:
//   1. global.css 必须在 React 渲染前 import,
//      让 CSS 变量与 @tailwind directives 先生效;
//   2. applyInitialTheme (T03) 在 createRoot 前**同步**应用主题,
//      防止深色用户在 light 默认下看到首屏白闪 (FR-08 / 设计 §3.3);
//   3. App 是统一渲染根; 路由/Provider 后续任务会在这里叠加.
//
// ES module semantics: 所有 import 提升至模块顶部, 但函数调用按字面顺序执行.
// 因此 `applyInitialTheme()` 必然在 createRoot 之前同步生效 (import 解析阶段
// 已完成 CSS 解析, 调用发生在 import + 第一个函数调用之间).
//
// T04 增量: 引入 tokens.css (字号/行高运行时 token). 这是 9 文件清单明确包含
// 的 tokens.css 必要配套; git commit 标注: 突破 locked-out 仅此一处.
//
// T13 增量 (FR-08 / D-08): cold_start 埋点. perfMark('cold_start') 在
// applyInitialTheme 之后 / createRoot 之前执行; dev 模式同步启动 console.time
// 计时器, Reader mount 后 reader.tsx 用 console.timeEnd 配对输出.
import './styles/global.css';
import './styles/tokens.css';
import './styles/highlight.css';
import './styles/drag-state.css';
// T16-P2 (FR-03): 全屏态 CSS (data-fullscreen + cursor auto-hide).
import './styles/fullscreen.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './i18n'; // T15 (FR-03): 初始化 react-i18next (顶部 import, 同步生效).
import { applyInitialTheme } from './lib/applyInitialTheme';
import { setWindowTitle } from './lib/window';
import { useRecentStore } from './stores/recentStore';
import { isPerfDisabled, mark as perfMark } from './lib/perf';

applyInitialTheme(); // T03 step-11: 在 React mount 之前同步设置 <html>.dark.
const PERF_ENABLED = !isPerfDisabled();
if (PERF_ENABLED) {
  perfMark('cold_start');
  if (import.meta.env.DEV) {
    console.time('cold_to_paint');
  }
}
// T06: 启动时还原默认窗口标题 'KITE' (后端规则: 空串 → 默认名).
setWindowTitle('').catch((e) => console.warn('[main] initial setWindowTitle failed:', e));
// T06: hydrate 最近文件列表 (失败仅 console.warn, 不阻塞首屏 AC-08).
void useRecentStore.getState().load();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
