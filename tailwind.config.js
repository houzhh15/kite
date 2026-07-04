/**
 * Tailwind config for KITE.
 * - darkMode: 'class' enables dark theme via document.documentElement.classList.toggle('dark')
 * - content scans .ts/.tsx/.html under src/ + the root index.html (T13 step-03a 精确化).
 * - safelist = []: 默认空, 禁止静默扩容; 若需动态 class, 在此显式列出.
 * - colors map to CSS variables declared in src/styles/global.css
 *   so Tailwind utilities (`bg-bg`, `text-fg`, `bg-accent`) resolve at build time.
 *
 * 故意排除的扫描路径 (T13 step-03a / FR-03):
 *   - src-tauri 目录 (Rust 源码不会被 Tailwind 扫描)
 *   - dist 目录 (避免 build 自我引用)
 *   - node_modules (依赖代码不参与 utility class 扫描)
 *   - Markdown 文档 (不是 class 源)
 *
 * `npm run check-tw-purge` 会在 dist CSS 里验证 sentinel class 未被误收.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}', './index.html'],
  safelist: [],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        fg: 'rgb(var(--color-fg) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        // T03 step-05: 辅助 token 映射 (设计 §3.9).
        border: 'rgb(var(--color-border) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
