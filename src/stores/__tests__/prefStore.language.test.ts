/**
 * prefStore.language.test.ts — T15 (FR-05) 语言字段持久化.
 *
 * 覆盖:
 *   - 默认 language='zh-CN'.
 *   - setLanguage('en-US') 写入并保留 (AC-05-1).
 *   - hydrate({language:'fr-FR'}) 非法值回退 'zh-CN' (AC-05-2).
 *   - setLanguage 非法字面量 console.warn 后保持原值.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefStore } from '../prefStore';

describe('prefStore — T15 (FR-05) language', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: {
        theme: 'system',
        fontSize: 16,
        lineHeight: 1.6,
        codeBlockTheme: 'github',
        fontSizeId: 'md',
        lineHeightId: 'cozy',
        codeFontSizeId: 'md',
        language: 'zh-CN',
        mermaidEnabled: false,
        katexEnabled: false,
        externalEditor: 'system',
        externalEditorCustomCmd: '',
      },
      hydrated: false,
      loaded: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default language is zh-CN', () => {
    expect(usePrefStore.getState().prefs.language).toBe('zh-CN');
  });

  it('setLanguage("en-US") persists to prefs.language', () => {
    usePrefStore.getState().setLanguage('en-US');
    expect(usePrefStore.getState().prefs.language).toBe('en-US');
  });

  it('setLanguage("zh-CN") switches back', () => {
    usePrefStore.getState().setLanguage('en-US');
    usePrefStore.getState().setLanguage('zh-CN');
    expect(usePrefStore.getState().prefs.language).toBe('zh-CN');
  });

  it('setLanguage with invalid literal warns and ignores', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePrefStore.getState().setLanguage('fr-FR' as never);
    expect(usePrefStore.getState().prefs.language).toBe('zh-CN');
    expect(warn).toHaveBeenCalled();
  });

  it('hydrate accepts language string "en-US"', () => {
    usePrefStore.getState().hydrate({ language: 'en-US' });
    expect(usePrefStore.getState().prefs.language).toBe('en-US');
    expect(usePrefStore.getState().hydrated).toBe(true);
  });

  it('hydrate falls back to zh-CN when language is invalid (AC-05-2)', () => {
    usePrefStore.setState({
      prefs: {
        theme: 'system',
        fontSize: 16,
        lineHeight: 1.6,
        codeBlockTheme: 'github',
        fontSizeId: 'md',
        lineHeightId: 'cozy',
        codeFontSizeId: 'md',
        language: 'en-US',
        mermaidEnabled: false,
        katexEnabled: false,
        externalEditor: 'system',
        externalEditorCustomCmd: '',
      },
      hydrated: false,
      loaded: false,
    });
    usePrefStore.getState().hydrate({ language: 'fr-FR' as never });
    expect(usePrefStore.getState().prefs.language).toBe('zh-CN');
  });

  it('hydrate without language keeps current value', () => {
    usePrefStore.getState().setLanguage('en-US');
    usePrefStore.getState().hydrate({});
    expect(usePrefStore.getState().prefs.language).toBe('en-US');
  });

  it('resetReadingPrefs preserves language choice (T15 行为)', () => {
    usePrefStore.getState().setLanguage('en-US');
    usePrefStore.getState().setFontSizeId('2xl');
    usePrefStore.getState().resetReadingPrefs();
    // 字号回到 md, 但语言保持 en-US.
    expect(usePrefStore.getState().prefs.fontSizeId).toBe('md');
    expect(usePrefStore.getState().prefs.language).toBe('en-US');
  });
});
