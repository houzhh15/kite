/**
 * useDebouncedValue — T10 step-1a 通用 50ms 防抖 hook (设计 §3.1.2 / §4.2).
 *
 * 设计依据: docs/design/compiled.md §4.2 (debounce 策略).
 *
 * 责任:
 *   - 返回 `[value, debouncedValue]`.
 *   - value 变化时, 50ms 窗口内只提交末尾一次 (用 ref + setTimeout 实现).
 *   - 卸载或 value 变更时清掉未到期的 timer, 不泄漏.
 *   - 清空 query (设为 '') 时**不**走 debounce: 立即同步提交空串, 保证 wrapper
 *     立即清空 <mark>, 满足 AC-02-3 / NFR-04-2.
 *
 * 边界:
 *   - 同步初值: 首次渲染 `debouncedValue === value`, 不触发额外提交.
 *   - delay 变化: 以最新 delay 为准, 重新安排 timer.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * 返回二元组: 当前值 + 防抖提交后的值.
 * 第二个元素在 `value` 停止变化 `delay` 毫秒后才会更新.
 *
 * 注意: 当 `value === ''` 时, 跳过防抖立即同步; 这是设计 §4.2 的明确决策
 * (清空查询必须立即反映在 UI 上, 否则 wrapper 会滞后移除 <mark>).
 */
export function useDebouncedValue<T>(value: T, delay: number): [T, T] {
  const [debounced, setDebounced] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // 清空 query (或空字符串 falsy 检测): 立即同步, 不走 debounce.
    if (value === '' || (typeof value === 'string' && value.length === 0)) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDebounced(value);
      return undefined;
    }

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      timerRef.current = null;
      setDebounced(value);
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, delay]);

  return [value, debounced];
}

export default useDebouncedValue;