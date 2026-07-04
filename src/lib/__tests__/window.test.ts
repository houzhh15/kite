/**
 * src/lib/__tests__/window.test.ts — T21 F-16 窗口标题联动单测.
 *
 * 设计依据: docs/design/compiled.md §3.4 (单测设计) / §3.1.1 (契约).
 *
 * 覆盖 AC-FR02-1 ~ AC-FR02-6 + 常量导出:
 *   - 透传非空 5 字符 ('hello') → IPC 入参 'hello'
 *   - 透传空串 → IPC 入参 ''
 *   - null / undefined 归一化 → IPC 入参 ''
 *   - 80 字符截断 → 前 60 字符 + '…'
 *   - 60 字符边界 → 原样 60 字符 (不追加 '…')
 *   - 61 字符边界 → 前 60 字符 + '…'
 *   - 常量导出 APP_NAME === 'KITE', TITLE_MAX === 60
 *   - 返回 Promise 不 reject (正常)
 *   - IPC reject 透传 (错误由调用方 .catch 决定)
 *
 * mock 策略:
 *   - vi.mock('../tauri') 替换被测模块 (../window) 的内部 IPC 依赖.
 *     关键: vi.mock 路径按模块解析 (即 'src/lib/tauri.ts'), 与测试文件位置无关 ——
 *     被 mock 的模块就是 window.ts 通过 './tauri' import 解析到的同一文件.
 *   - 与 App.test.tsx 的 '../lib/tauri' mock 互不干扰; 本测试只验证 window.ts 纯函数契约.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tauri', () => ({
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
}));

import { setWindowTitle, APP_NAME, TITLE_MAX } from '../window';
import { setWindowTitle as setWindowTitleIpc } from '../tauri';

const ipc = setWindowTitleIpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  ipc.mockReset();
  ipc.mockResolvedValue(undefined);
});

describe('setWindowTitle (T21 F-16 / FR-02)', () => {
  describe('常量导出 (NFR-M-02 / step-1d)', () => {
    it('APP_NAME === "KITE"', () => {
      expect(APP_NAME).toBe('KITE');
    });

    it('TITLE_MAX === 60', () => {
      expect(TITLE_MAX).toBe(60);
    });
  });

  describe('AC-FR02-1: 透传非空字符串', () => {
    it('"hello" (5 字符) 原样透传', async () => {
      await setWindowTitle('hello');
      expect(ipc).toHaveBeenCalledTimes(1);
      expect(ipc).toHaveBeenCalledWith('hello');
    });

    it('"readme" 透传给 IPC', async () => {
      await setWindowTitle('readme');
      expect(ipc).toHaveBeenCalledWith('readme');
    });
  });

  describe('AC-FR02-2: 透传空字符串', () => {
    it('"" 透传给 IPC (用于还原默认 KITE)', async () => {
      await setWindowTitle('');
      expect(ipc).toHaveBeenCalledTimes(1);
      expect(ipc).toHaveBeenCalledWith('');
    });
  });

  describe('AC-FR02-3: null / undefined 归一化', () => {
    it('null 不抛同步异常, IPC 收到 ""', async () => {
      await expect(
        setWindowTitle(null as unknown as string),
      ).resolves.toBeUndefined();
      expect(ipc).toHaveBeenCalledTimes(1);
      expect(ipc).toHaveBeenCalledWith('');
    });

    it('undefined 不抛同步异常, IPC 收到 ""', async () => {
      await expect(
        setWindowTitle(undefined as unknown as string),
      ).resolves.toBeUndefined();
      expect(ipc).toHaveBeenCalledTimes(1);
      expect(ipc).toHaveBeenCalledWith('');
    });
  });

  describe('AC-FR02-4: 80 字符截断', () => {
    it('80 字符 → 前 60 字符 + "…" (共 61 字符)', async () => {
      const input = 'a'.repeat(80);
      expect(input.length).toBe(80);
      await setWindowTitle(input);
      expect(ipc).toHaveBeenCalledTimes(1);
      const arg = ipc.mock.calls[0]?.[0] as string;
      expect(arg.length).toBe(61);
      expect(arg).toBe('a'.repeat(60) + '…');
    });
  });

  describe('AC-FR02-5: 60 字符边界 (原样透传)', () => {
    it('恰好 60 字符 → 原样 60 字符, 不追加 "…"', async () => {
      const input = 'b'.repeat(60);
      expect(input.length).toBe(60);
      await setWindowTitle(input);
      expect(ipc).toHaveBeenCalledTimes(1);
      const arg = ipc.mock.calls[0]?.[0] as string;
      expect(arg).toBe(input);
      expect(arg.length).toBe(60);
      expect(arg.endsWith('…')).toBe(false);
    });
  });

  describe('AC-FR02-6: 61 字符边界 (截断)', () => {
    it('61 字符 → 前 60 字符 + "…" (共 61 字符)', async () => {
      const input = 'c'.repeat(61);
      expect(input.length).toBe(61);
      await setWindowTitle(input);
      expect(ipc).toHaveBeenCalledTimes(1);
      const arg = ipc.mock.calls[0]?.[0] as string;
      expect(arg.length).toBe(61);
      expect(arg).toBe('c'.repeat(60) + '…');
    });
  });

  describe('特殊字符 / Unicode (C-05)', () => {
    it('含 "—" 等 Unicode 字符 (≤ TITLE_MAX) 原样透传', async () => {
      const title = 'chapter-2 — 草稿';
      await setWindowTitle(title);
      expect(ipc).toHaveBeenCalledWith(title);
    });

    it('长 Unicode 标题 (>60 字符) 截断', async () => {
      const title = '你'.repeat(80);
      expect(title.length).toBe(80);
      await setWindowTitle(title);
      const arg = ipc.mock.calls[0]?.[0] as string;
      expect(arg.length).toBe(61);
      expect(arg.endsWith('…')).toBe(true);
      expect(arg).toBe('你'.repeat(60) + '…');
    });
  });

  describe('Promise 契约 (NFR-M-01)', () => {
    it('返回的 Promise 不 reject 同步异常', async () => {
      await expect(setWindowTitle('x')).resolves.toBeUndefined();
    });

    it('IPC reject 时, setWindowTitle 把 reject 透传给调用方 (不二次吞错)', async () => {
      const err = new Error('ipc failure');
      ipc.mockRejectedValueOnce(err);
      await expect(setWindowTitle('boom')).rejects.toBe(err);
      expect(ipc).toHaveBeenCalledWith('boom');
    });
  });
});
