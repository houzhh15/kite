// ESLint flat config (eslint v9) for KITE.
//
// 双重作用:
//   1. R-04 缓解 — no-restricted-imports 禁止前端代码绕过 src/lib/tauri.ts
//      直接 import { invoke } from '@tauri-apps/api/core'.
//   2. TS strict — 手工启用 typescript-eslint 推荐规则 (不需要 preset).
//      TODO[T0X]: 后续任务可加 react-hooks / jsx-a11y 规则.

import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const tsRules = {
  // 来自 @typescript-eslint/recommended
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-private-class-members': 'error',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/consistent-type-imports': 'error',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'e2e/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
    },
    rules: {
      ...tsRules,
      // R-04 缓解: 唯一 IPC 出口.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tauri-apps/api/core',
              importNames: ['invoke'],
              message:
                'Use src/lib/tauri.ts as the single IPC exit; do not import invoke directly.',
            },
            { name: 'fs', message: 'Filesystem IO must go through tauri IPC (NFR-SEC-03).' },
            { name: 'node:fs', message: 'Filesystem IO must go through tauri IPC (NFR-SEC-03).' },
            { name: 'fs/promises', message: 'Filesystem IO must go through tauri IPC (NFR-SEC-03).' },
            { name: 'node:fs/promises', message: 'Filesystem IO must go through tauri IPC (NFR-SEC-03).' },
            { name: 'path', message: 'Path resolution must go through tauri IPC (NFR-SEC-03).' },
            { name: 'node:path', message: 'Path resolution must go through tauri IPC (NFR-SEC-03).' },
            { name: 'fs-extra', message: 'Forbidden dependency (R-03).' },
            { name: 'chokidar', message: 'Forbidden dependency (R-03).' },
            { name: 'rehype-raw', message: 'Forbidden dependency (R-03).' },
          ],
        },
      ],
    },
  },
];
