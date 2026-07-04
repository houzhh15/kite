/**
 * src/components/Settings.tsx — 设置面板 (T04 替换/扩展 T03 SettingsPanel).
 *
 * 设计依据: docs/design/compiled.md §3.6.
 *
 * 责任:
 *   - open=false → 返回 null.
 *   - open=true → 渲染包含 ThemeSwitcher + 字号 5 档 radiogroup + 行高 3 档
 *     radiogroup + 代码块字号 4 档 radiogroup + 重置按钮 + 关闭按钮.
 *   - 字号 / 行高 / 代码块字号: T12 用 radiogroup + role="radio" + aria-checked
 *     离散档位; T04 旧的 range slider 由 radiogroup 取代 (更易键盘操作).
 *   - 关闭按钮: 接 focus 回退 (T12 step-11 由 useDialogFocusTrap 接管).
 *
 * 纪律:
 *   - 受控源严格 = prefStore; 不读其它 store; 不调 IPC.
 *   - 与 ThemeSwitcher 同区共存, 不嵌套 radiogroup (避免 ARIA 冲突).
 *   - 重置按钮: resetReadingPrefs 把字号 / 行高 / 代码块字号回默认.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefStore, type Language } from '../stores/prefStore';
import { ThemeSwitcher } from './ThemeSwitcher';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap';
import {
  FONT_SIZES,
  LINE_HEIGHTS,
  CODE_FONT_SIZES,
  getFontSizeMeta,
  getLineHeightMeta,
  type FontSize,
  type LineHeight as LineHeightId,
  type CodeFontSize,
} from '../lib/reader-prefs';

export interface SettingsProps {
  /** 是否打开; false 时返回 null. */
  open: boolean;
  /** 关闭回调. */
  onClose: () => void;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Settings(props: SettingsProps): JSX.Element | null {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const fontSizeId = usePrefStore((s) => s.prefs.fontSizeId);
  const lineHeightId = usePrefStore((s) => s.prefs.lineHeightId);
  const codeFontSizeId = usePrefStore((s) => s.prefs.codeFontSizeId);
  const setFontSizeId = usePrefStore((s) => s.setFontSizeId);
  const setLineHeightId = usePrefStore((s) => s.setLineHeightId);
  const setCodeFontSize = usePrefStore((s) => s.setCodeFontSize);
  const resetReadingPrefs = usePrefStore((s) => s.resetReadingPrefs);
  const language = usePrefStore((s) => s.prefs.language);
  const setLanguage = usePrefStore((s) => s.setLanguage);
  // T17-P2 (F-21/F-22): mermaidEnabled / katexEnabled 状态 + setter.
  const mermaidEnabled = usePrefStore((s) => s.prefs.mermaidEnabled);
  const katexEnabled = usePrefStore((s) => s.prefs.katexEnabled);
  const setMermaidEnabled = usePrefStore((s) => s.setMermaidEnabled);
  const setKatexEnabled = usePrefStore((s) => s.setKatexEnabled);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // T12 step-11: 焦点陷阱 + 焦点回退 (设计 §3.6.6). 委托 useDialogFocusTrap.
  useDialogFocusTrap({
    containerRef: dialogRef,
    active: open,
    onEscape: onClose,
    initialFocusSelector: '[data-testid="settings-close"]',
  });

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.panelLabel')}
      data-testid="settings-panel"
      className="fixed inset-x-4 top-20 z-40 mx-auto max-w-md rounded-lg border border-border bg-bg p-6 text-fg shadow-lg"
    >
      <h2 className="mb-4 text-lg font-semibold">{t('settings.title')}</h2>

      {/* 主题切换 — T03 控件不动, 不嵌套 radiogroup */}
      <section className="mb-4">
        <p className="mb-2 text-sm text-muted">{t('settings.theme')}</p>
        <ThemeSwitcher />
      </section>

      {/* T15 (FR-03/FR-05): 语言切换 — 单一 select, 不嵌套 radiogroup */}
      <section className="mb-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{t('settings.language')}</legend>
          <select
            data-testid="language-select"
            value={language}
            onChange={(e) => {
              const next = e.target.value as Language;
              setLanguage(next);
            }}
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          >
            <option value="zh-CN">{t('settings.languageOption.zhCN')}</option>
            <option value="en-US">{t('settings.languageOption.enUS')}</option>
          </select>
        </fieldset>
      </section>

      {/* 字号 5 档 — T12 离散 radiogroup */}
      <section className="mb-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{t('settings.fontSize')}</legend>
          <div
            role="radiogroup"
            aria-label={t('settings.fontSize')}
            data-testid="font-size-radiogroup"
            className="flex flex-wrap gap-2"
          >
            {FONT_SIZES.map((id: FontSize) => {
              const meta = getFontSizeMeta(id);
              const isActive = fontSizeId === id;
              // T18 (FR-02): 优先 t('settings.fontSize.<id>'), 缺失时回退 meta.label.
              const label = t(`settings.fontSize.${id}` as never) || meta.label;
              return (
                <button
                  key={id}
                  ref={id === fontSizeId || id === 'md' ? undefined : undefined}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`${t('settings.fontSize')} ${label} ${meta.hint}`}
                  data-testid={`font-size-${id}`}
                  onClick={() => setFontSizeId(id)}
                  className={cx(
                    'rounded-md border px-3 py-1.5 text-sm',
                    isActive
                      ? 'border-accent bg-accent/10 font-semibold'
                      : 'border-border hover:bg-fg/5',
                  )}
                >
                  {label}
                  <span className="ml-2 text-xs text-muted">{meta.px}px</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      {/* 行高 3 档 — T12 离散 radiogroup (T04 行为保留, 改 discrete). */}
      <section className="mb-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{t('settings.lineHeight')}</legend>
          <div
            role="radiogroup"
            aria-label={t('settings.lineHeight')}
            data-testid="line-height-radiogroup"
            className="flex gap-2"
          >
            {LINE_HEIGHTS.map((id: LineHeightId) => {
              const meta = getLineHeightMeta(id);
              const isActive = lineHeightId === id;
              // T18 (FR-02): 优先 t('settings.lineHeight.<id>').
              const label = t(`settings.lineHeight.${id}` as never) || meta.label;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`${t('settings.lineHeight')} ${label}`}
                  data-testid={`line-height-${id}`}
                  onClick={() => setLineHeightId(id)}
                  className={cx(
                    'rounded-md border px-3 py-1.5 text-sm',
                    isActive
                      ? 'border-accent bg-accent/10 font-semibold'
                      : 'border-border hover:bg-fg/5',
                  )}
                >
                  {label}
                  <span className="ml-2 text-xs text-muted">{meta.value}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      {/* 代码块字号 4 档 — T12 新增 */}
      <section className="mb-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{t('settings.codeFontSize')}</legend>
          <div
            role="radiogroup"
            aria-label={t('settings.codeFontSize')}
            data-testid="code-font-size-radiogroup"
            className="flex gap-2"
          >
            {CODE_FONT_SIZES.map((id: CodeFontSize) => {
              const isActive = codeFontSizeId === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`${t('settings.codeFontSize')} ${id}`}
                  data-testid={`code-font-size-${id}`}
                  onClick={() => setCodeFontSize(id)}
                  className={cx(
                    'rounded-md border px-3 py-1.5 text-sm',
                    isActive
                      ? 'border-accent bg-accent/10 font-semibold'
                      : 'border-border hover:bg-fg/5',
                  )}
                >
                  {id}
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      {/* T17-P2 (F-21/F-22): 图表与公式分组 — 两个独立开关.
        role="switch" + aria-checked, label/description 走 i18n. */}
      <section
        className="mb-4"
        data-section="diagrams"
        data-testid="settings-diagrams"
      >
        <fieldset>
          <legend className="mb-2 text-sm text-muted">
            {t('settings.section.diagrams')}
          </legend>
          <div className="mb-2 flex items-start justify-between gap-4">
            <div className="flex-1">
              <label
                htmlFor="mermaid-enable"
                className="text-sm font-medium"
                id="mermaid-enable-label"
              >
                {t('settings.mermaidEnable')}
              </label>
              <p
                id="mermaid-enable-desc"
                className="text-xs text-muted"
              >
                {t('settings.mermaidDesc')}
              </p>
            </div>
            <button
              id="mermaid-enable"
              type="button"
              role="switch"
              aria-checked={mermaidEnabled}
              aria-describedby="mermaid-enable-desc"
              aria-labelledby="mermaid-enable-label"
              data-testid="settings-mermaid"
              onClick={() => setMermaidEnabled(!mermaidEnabled)}
              className={cx(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border',
                mermaidEnabled
                  ? 'border-accent bg-accent'
                  : 'border-border bg-fg/10',
              )}
            >
              <span
                className={cx(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                  mermaidEnabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
                aria-hidden="true"
              />
            </button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <label
                htmlFor="katex-enable"
                className="text-sm font-medium"
                id="katex-enable-label"
              >
                {t('settings.katexEnable')}
              </label>
              <p
                id="katex-enable-desc"
                className="text-xs text-muted"
              >
                {t('settings.katexDesc')}
              </p>
            </div>
            <button
              id="katex-enable"
              type="button"
              role="switch"
              aria-checked={katexEnabled}
              aria-describedby="katex-enable-desc"
              aria-labelledby="katex-enable-label"
              data-testid="settings-katex"
              onClick={() => setKatexEnabled(!katexEnabled)}
              className={cx(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border',
                katexEnabled
                  ? 'border-accent bg-accent'
                  : 'border-border bg-fg/10',
              )}
            >
              <span
                className={cx(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                  katexEnabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
                aria-hidden="true"
              />
            </button>
          </div>
        </fieldset>
      </section>

      {/* 重置阅读偏好 */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={resetReadingPrefs}
          aria-label={t('settings.reset')}
          data-testid="settings-reset"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-fg/5"
        >
          {t('settings.reset')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('settings.close')}
          data-testid="settings-close"
          ref={closeRef}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-fg/5"
        >
          {t('settings.close')}
        </button>
      </div>
    </div>
  );
}

export default Settings;