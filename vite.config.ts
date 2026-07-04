import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for KITE (Tauri 2 frontend).
// - Fixed dev server port 1420 (Tauri default reads VITE_DEV_SERVER_URL or this).
// - clearScreen: false keeps Rust cargo build logs visible during `tauri dev`.
// - HMR uses same host as dev server.
// - T02 起启用 vitest (单元 / 组件测试); 环境用 jsdom.
// - T13 (F-31 / FR-02) 生产构建: terser + drop_console, 移除 console.log/debug/info.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: 'localhost',
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: true,
    // T13 FR-02: 用 terser 替换默认 esbuild; 显式 drop_console + pure_funcs
    // 完全剔除 console.log / console.debug / console.info.
    // console.error / console.warn 保留用于运行时报错监控 (AC-02-1).
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        pure_funcs: ['console.log', 'console.debug', 'console.info'],
        passes: 2,
      },
      format: {
        comments: false,
      },
    },
    // 手工分包: 主应用与渲染管线拆开, 提高缓存命中 + 减少首屏 JS.
    // T17-P2 (F-21/F-22): 追加 mermaid-vendor / katex-vendor 分类, 让运行时
    //   动态 import 的 mermaid/katex 落在独立 chunk, 关闭态不引入对应 vendor.
    //   匹配顺序: 先 mermaid / katex, 再 markdown (避免 mermaid 子依赖被错误归类).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // T17-P2: mermaid + 子依赖 (d3 等) → mermaid-vendor.
            if (id.includes('mermaid') || id.includes('d3') || id.includes('dagre')) {
              return 'mermaid-vendor';
            }
            // T17-P2: katex + remark-math + rehype-katex → katex-vendor.
            if (
              id.includes('katex') ||
              id.includes('rehype-katex') ||
              id.includes('remark-math')
            ) {
              return 'katex-vendor';
            }
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('mdast') || id.includes('hast')) {
              return 'markdown';
            }
            if (id.includes('highlight.js')) {
              return 'markdown';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react';
            }
          }
          return undefined;
        },
      },
    },
    // T17-P2 (F-21/F-22): 过滤 modulePreload, 让 mermaid-vendor / katex-vendor
    //   / MermaidBlock 不在 index 主入口的 __vite__mapDeps preload 数组里出现.
    //   关闭态浏览器不会主动 fetch vendor 或 MermaidBlock chunk; 启用后由
    //   React.lazy / import() 在首次渲染 mermaid 围栏时按需触发.
    modulePreload: {
      polyfill: true,
      resolveDependencies: (_filename, deps) => {
        // 过滤掉 mermaid / katex 相关 vendor 与 MermaidBlock 懒加载 chunk.
        return deps.filter(
          (d) =>
            !/mermaid-vendor|katex-vendor|MermaidBlock-/.test(d),
        );
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
  },
});
