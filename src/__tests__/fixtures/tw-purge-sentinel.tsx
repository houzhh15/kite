/**
 * tw-purge-sentinel.tsx — T13 step-03b 哨兵 fixture.
 *
 * 故意把 sentinel class `tw-purge-1 / tw-purge-2 / tw-purge-3` 作为
 * 字符串字面量写进 src/ 下 .tsx 文件 (Tailwind content 范围之内),
 * 但 Tailwind 无法识别其属于既有 utility, 故不会生成对应规则.
 * scripts/check-tw-purge.mjs 通过扫描 dist/*.css 断言这些 class 未出现,
 * 防止 tailwind config 被错误地放宽到非源码路径.
 *
 * 该 fixture 不会被导入或被任何组件使用; 仅作为脚本静态扫描的 "牙".
 * 不要在 UI 中使用 tw-purge-* 前缀.
 */
export const TW_PURGE_SENTINEL_LITERAL =
  'tw-purge-1 tw-purge-2 tw-purge-3';
export default TW_PURGE_SENTINEL_LITERAL;
