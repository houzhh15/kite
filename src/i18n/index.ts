/**
 * i18n — T15 (FR-03) react-i18next initialization (设计 §3.3 + 需求 FR-03).
 *
 * 责任:
 *   - 暴露 i18next 单例, 由 main.tsx 顶部 import 初始化.
 *   - 资源表 resources = { 'zh-CN': zhCN, 'en-US': enUS }.
 *   - fallbackLng = 'zh-CN' (需求 §3 / FR-03 行为).
 *   - saveMissing 仅 dev 模式开启 (满足 AC-03-3 控制台 warn).
 *   - interpolation.escapeValue = false (React 已默认转义, 避免双重转义).
 *
 * 命名空间策略: 不使用 i18next 自带 namespace 机制, 而是把整个字典作为
 * default ns (即 `common.open` / `toolbar.tree` / `tree.emptyHint` / ...).
 * 这样前端代码用 `t('toolbar.tree')` 直接取出, 不必切换 ns.
 *
 * 纪律:
 *   - 纯初始化; 不调 IPC; 不读 store. store 偏好 (FR-05) 由 App.tsx hydrate
 *     后调 `i18n.changeLanguage(...)`.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { zhCN } from './zh-CN';
import { enUS } from './en-US';

/** 支持的 locale. 与 prefStore.language 联合. */
export type SupportedLng = 'zh-CN' | 'en-US';

export const SUPPORTED_LNGS: readonly SupportedLng[] = ['zh-CN', 'en-US'] as const;

/** 默认值, 非法/缺省时回退使用. */
export const DEFAULT_LNG: SupportedLng = 'zh-CN';

/** Type guard: 校验 unknown 是否为 SupportedLng. */
export function isSupportedLng(value: unknown): value is SupportedLng {
  return value === 'zh-CN' || value === 'en-US';
}

/** 规范化语言字符串: 任何无法识别的值都回退到 DEFAULT_LNG. */
export function normalizeLng(value: unknown): SupportedLng {
  return isSupportedLng(value) ? value : DEFAULT_LNG;
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: DEFAULT_LNG,
  fallbackLng: DEFAULT_LNG,
  defaultNS: 'translation',
  interpolation: {
    escapeValue: false,
  },
  // 缺失 key: dev 模式 console.warn (AC-03-3); UI 不崩 (返回 key 字符串).
  saveMissing: import.meta.env.DEV,
  // 在 dev 模式把缺 key 暴露给 console, 但 release 不输出.
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, _ns, key) => {
        // dev-only missing-key warning; release 模式未注册 handler.
        console.warn(`[i18n] missing key: ${key}`);
      }
    : undefined,
  returnEmptyString: false,
  // 不写 cookie / 不读浏览器语言; 由 prefStore 显式控制.
  detection: undefined,
});

export { i18n };
export default i18n;
