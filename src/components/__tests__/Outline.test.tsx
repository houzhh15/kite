/**
 * Outline 单元测试 (T09 / FR-02 / FR-05 / AC-02 / AC-05).
 *
 * 覆盖:
 *   - 空 outline -> 占位「无目录」.
 *   - 35 项渲染 (5h1 + 20h2 + 10h3), 缩进按 level.
 *   - 折叠 / 展开切换 (width 240 ↔ 32, aria-expanded).
 *   - 受控 onCollapsedChange 回调.
 *   - 点击条目 -> scrollIntoView + history.replaceState (URL hash).
 *   - currentId -> aria-current="location" + 视觉高亮 data-current="true".
 *   - 键盘 ArrowDown/Up/Home/End/Enter 焦点跳转.
 *   - 200+ 项 → 虚拟滚动 (DOM 节点数 ≤ ~50).
 *   - React.memo 包裹 (校验 $$typeof).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import Outline from '../Outline';
import type { OutlineItem } from '../../lib/outline';
import i18n, { DEFAULT_LNG } from '../../i18n';

beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LNG);
});

function makeOutline(n: number): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (let i = 1; i <= n; i++) {
    const level = (i % 6) + 1; // 2,3,4,5,6,1 循环
    out.push({ id: `item-${i}`, level: level as 1 | 2 | 3 | 4 | 5 | 6, text: `Item ${i}`, line: i });
  }
  return out;
}

function makeStructured(): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (let i = 1; i <= 5; i++) out.push({ id: `h1-${i}`, level: 1, text: `H1 ${i}`, line: i });
  for (let i = 1; i <= 20; i++) out.push({ id: `h2-${i}`, level: 2, text: `H2 ${i}`, line: 5 + i });
  for (let i = 1; i <= 10; i++) out.push({ id: `h3-${i}`, level: 3, text: `H3 ${i}`, line: 25 + i });
  return out;
}

/** T18: 包裹 I18nextProvider, 让 Outline 内部 useTranslation() 拿到字典. */
function renderOutline(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('Outline', () => {
  beforeEach(() => {
    // Ensure clean DOM between tests; jsdom keeps bodies across tests.
    document.body.innerHTML = '';
  });

  it('render 不崩溃 (空 outline)', () => {
    const { getByTestId } = renderOutline(<Outline outline={[]} currentId={null} />);
    expect(getByTestId('outline')).toBeTruthy();
    // T18: outline.empty 文案来自 zh-CN 字典.
    expect(getByTestId('outline-empty').textContent).toContain('无目录');
  });

  it('35 项渲染 (5h1 + 20h2 + 10h3) -> 35 个 treeitem', () => {
    const items = makeStructured();
    const { queryAllByRole } = renderOutline(<Outline outline={items} currentId={null} />);
    const treeitems = queryAllByRole('treeitem');
    expect(treeitems.length).toBe(35);
  });

  it('折叠: 点击 toggle -> data-collapsed=true + width=32 (AC-02-4)', () => {
    const items = makeStructured();
    const { getByTestId } = renderOutline(<Outline outline={items} currentId={null} width={240} />);
    expect(getByTestId('outline').getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(getByTestId('outline-toggle'));
    expect(getByTestId('outline').getAttribute('data-collapsed')).toBe('true');
    expect(getByTestId('outline').getAttribute('data-width')).toBe('32');
  });

  it('展开: 再次点击 toggle -> data-collapsed=false + width=240', () => {
    const items = makeStructured();
    const { getByTestId } = renderOutline(<Outline outline={items} currentId={null} defaultCollapsed width={240} />);
    expect(getByTestId('outline').getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(getByTestId('outline-toggle'));
    expect(getByTestId('outline').getAttribute('data-collapsed')).toBe('false');
    expect(getByTestId('outline').getAttribute('data-width')).toBe('240');
  });

  it('受控模式: onCollapsedChange 收到状态变化', () => {
    const onCol = vi.fn();
    const items = makeStructured();
    const { getByTestId } = renderOutline(
      <Outline
        outline={items}
        currentId={null}
        collapsed={false}
        onCollapsedChange={onCol}
      />,
    );
    fireEvent.click(getByTestId('outline-toggle'));
    expect(onCol).toHaveBeenCalledWith(true);
  });

  it('点击条目 -> scrollIntoView 被调用 + URL hash 更新 (AC-02-2)', () => {
    const items = makeStructured();
    const scrollSpy = vi.fn();
    // jsdom 没有天然的 id; 给 article 添加一个 target 节点.
    const article = document.createElement('article');
    const target = document.createElement('h2');
    target.id = 'h2-1';
    article.appendChild(target);
    document.body.appendChild(article);
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    const { queryAllByRole } = renderOutline(<Outline outline={items} currentId={null} width={240} />);
    const item = queryAllByRole('treeitem').find((el) => el.getAttribute('data-outline-id') === 'h2-1');
    if (!item) throw new Error('h2-1 item not found');
    fireEvent.click(item);
    expect(scrollSpy).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();
    expect(String(replaceSpy.mock.calls[0]?.[2])).toContain('#h2-1');
  });

  it('currentId 匹配项 -> aria-current="location" + data-current=true (AC-02-3)', () => {
    const items = makeStructured();
    const { queryAllByRole, getByText } = renderOutline(
      <Outline outline={items} currentId="h2-5" />,
    );
    const all = queryAllByRole('treeitem');
    const matched = all.find((el) => el.getAttribute('data-outline-id') === 'h2-5');
    expect(matched?.getAttribute('aria-current')).toBe('location');
    expect(matched?.getAttribute('data-current')).toBe('true');
    expect((matched as HTMLElement).className).toContain('font-semibold');
    // 顺带校验文本节点存在.
    expect(getByText('H2 5')).toBeTruthy();
  });

  it('键盘 ArrowDown -> 焦点下移 (AC-05-1)', () => {
    const items = makeStructured();
    const { queryAllByRole, getByTestId } = renderOutline(
      <Outline outline={items} currentId={null} />,
    );
    const list = getByTestId('outline-list');
    // 把焦点先放到第一项.
    const all = queryAllByRole('treeitem');
    expect(all.length).toBeGreaterThan(0);
    (all[0] as HTMLElement).focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    // 焦点应在第三项 (index 2).
    expect(document.activeElement?.getAttribute('data-outline-id')).toBe('h1-3');
  });

  it('键盘 Home / End -> 首/末 (AC-05-1)', () => {
    const items = makeStructured();
    const { queryAllByRole, getByTestId } = renderOutline(
      <Outline outline={items} currentId={null} />,
    );
    const list = getByTestId('outline-list');
    const all = queryAllByRole('treeitem');
    (all[10] as HTMLElement).focus();
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement?.getAttribute('data-outline-id')).toBe('h1-1');
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement?.getAttribute('data-outline-id')).toBe('h3-10');
  });

  it('键盘 Enter -> scrollIntoView (focused item)', () => {
    const items = makeStructured();
    // 注入目标节点, 让 scrollToId 真正命中.
    const targetH = document.createElement('h1');
    targetH.id = 'h1-4';
    document.body.appendChild(targetH);
    const scrollSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    const { queryAllByRole, getByTestId } = renderOutline(
      <Outline outline={items} currentId={null} />,
    );
    const list = getByTestId('outline-list');
    const all = queryAllByRole('treeitem');
    (all[3] as HTMLElement).focus(); // 4th item -> h1-4
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(scrollSpy).toHaveBeenCalled();
    expect(String(replaceStateSpy.mock.calls[0]?.[2])).toContain('#h1-4');
  });

  it('200+ 项 -> 虚拟滚动 (DOM 节点数 ≤ 50, AC-02-6 / NFR-PERF-3)', () => {
    const items = makeOutline(300);
    const { queryAllByRole } = renderOutline(<Outline outline={items} currentId={null} />);
    const itemsRendered = queryAllByRole('treeitem');
    expect(itemsRendered.length).toBeLessThan(50);
    expect(itemsRendered.length).toBeGreaterThan(0);
  });

  it('Outline 受 React.memo 包裹 (顶层 $$typeof)', () => {
    // memo 包装后的组件 $$typeof 是 Symbol.for("react.memo")
    expect((Outline as unknown as { $$typeof?: symbol }).$$typeof?.toString()).toContain(
      'react.memo',
    );
  });

  it('缩进: level 1..6 -> paddingLeft 0..60px', () => {
    const items: OutlineItem[] = [
      { id: 'l1', level: 1, text: 'a', line: 1 },
      { id: 'l2', level: 2, text: 'b', line: 2 },
      { id: 'l3', level: 3, text: 'c', line: 3 },
      { id: 'l4', level: 4, text: 'd', line: 4 },
      { id: 'l5', level: 5, text: 'e', line: 5 },
      { id: 'l6', level: 6, text: 'f', line: 6 },
    ];
    const { queryAllByRole } = renderOutline(<Outline outline={items} currentId={null} />);
    const all = queryAllByRole('treeitem');
    expect((all[0] as HTMLElement).style.paddingLeft).toBe('0px');
    expect((all[1] as HTMLElement).style.paddingLeft).toBe('12px');
    expect((all[5] as HTMLElement).style.paddingLeft).toBe('60px');
  });
});
