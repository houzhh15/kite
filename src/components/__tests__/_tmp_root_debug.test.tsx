/**
 * 调试: 模拟用户场景 — 文件打开后, 渲染 wikilink 看实际产物.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useDocStore } from '../../stores/docStore';
import { usePrefStore } from '../../stores/prefStore';
import MarkdownRenderer from '../MarkdownRenderer';

describe('wikilink render debug', () => {
  it('renders wikilink with currentPath set (follow-current mode)', () => {
    usePrefStore.setState({
      prefs: {
        ...usePrefStore.getState().prefs,
        vaultRootMode: 'follow-current',
        vaultRootCustom: null,
      },
      hydrated: true,
    });
    useDocStore.setState({
      state: {
        currentPath: '/Users/me/vault/wiki/entities/AICon.md',
        content: '',
        title: 'AICon',
        dirty: false,
      },
    });

    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);
    console.log('=== INNER HTML ===');
    console.log(container.innerHTML);

    const linkEl = container.querySelector('[data-wikilink]');
    console.log('linkEl tag:', linkEl?.tagName, 'class:', linkEl?.className);

    expect(true).toBe(true);
  });
});
