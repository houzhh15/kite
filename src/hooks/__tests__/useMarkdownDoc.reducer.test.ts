import { describe, expect, it } from 'vitest';

import { reducer } from '../useMarkdownDoc';
import type { Action, MarkdownDoc, MarkdownState } from '../../types/markdown';

const sampleDoc: MarkdownDoc = {
  path: '/tmp/x.md',
  title: 'x',
  content: '# Hi',
};

function s(status: MarkdownState['status'], doc: MarkdownDoc | null = null, errorMessage: string | null = null): MarkdownState {
  return { status, doc, errorMessage };
}

function dispatch(state: MarkdownState, action: Action): MarkdownState {
  return reducer(state, action);
}

describe('useMarkdownDoc reducer', () => {
  it('OPEN_START from idle → loading, doc cleared, error gone', () => {
    const next = dispatch(s('error', null, 'old'), { type: 'OPEN_START' });
    expect(next.status).toBe('loading');
    expect(next.doc).toBeNull();
    expect(next.errorMessage).toBeNull();
  });

  it('OPEN_START preserves prior doc to avoid blank flash', () => {
    const next = dispatch(s('ok', sampleDoc, null), { type: 'OPEN_START' });
    expect(next.status).toBe('loading');
    expect(next.doc).toEqual(sampleDoc);
  });

  it('OPEN_OK replaces doc, clears error', () => {
    const next = dispatch(s('error', null, 'old'), { type: 'OPEN_OK', doc: sampleDoc });
    expect(next.status).toBe('ok');
    expect(next.doc).toEqual(sampleDoc);
    expect(next.errorMessage).toBeNull();
  });

  it('OPEN_ERR from loading sets error but keeps previous doc', () => {
    const next = dispatch(s('ok', sampleDoc, null), { type: 'OPEN_ERR', errorMessage: '文件不存在' });
    expect(next.status).toBe('error');
    expect(next.doc).toEqual(sampleDoc);
    expect(next.errorMessage).toBe('文件不存在');
  });

  it('OPEN_ERR from loading w/o prior doc → error + null doc', () => {
    const next = dispatch(s('loading'), { type: 'OPEN_ERR', errorMessage: '文件过大' });
    expect(next.status).toBe('error');
    expect(next.doc).toBeNull();
    expect(next.errorMessage).toBe('文件过大');
  });

  it('OPEN_ERR from error replaces existing error message', () => {
    const next = dispatch(s('error', null, 'old'), { type: 'OPEN_ERR', errorMessage: '更新错误' });
    expect(next.errorMessage).toBe('更新错误');
  });

  it('RETRY acts like OPEN_START but preserves doc', () => {
    const next = dispatch(s('error', sampleDoc, '文件不存在'), { type: 'RETRY' });
    expect(next.status).toBe('loading');
    expect(next.doc).toEqual(sampleDoc);
    expect(next.errorMessage).toBeNull();
  });

  it('RETRY from idle also becomes loading', () => {
    const next = dispatch(s('idle'), { type: 'RETRY' });
    expect(next.status).toBe('loading');
  });

  it('CLOSE from any state → idle + null doc + null error', () => {
    expect(dispatch(s('ok', sampleDoc, null), { type: 'CLOSE' })).toEqual({ status: 'idle', doc: null, errorMessage: null });
    expect(dispatch(s('error', null, 'err'), { type: 'CLOSE' })).toEqual({ status: 'idle', doc: null, errorMessage: null });
    expect(dispatch(s('loading'), { type: 'CLOSE' })).toEqual({ status: 'idle', doc: null, errorMessage: null });
    expect(dispatch(s('idle'), { type: 'CLOSE' })).toEqual({ status: 'idle', doc: null, errorMessage: null });
  });

  it('OK → OPEN_ERR does not clobber a previously good doc', () => {
    // 模拟第一次成功, 第二次失败. 用户期望还能看到上一次的文档 (AC-03-2).
    const afterOk = dispatch(s('loading'), { type: 'OPEN_OK', doc: sampleDoc });
    const afterErr = dispatch(afterOk, { type: 'OPEN_ERR', errorMessage: '读取失败' });
    expect(afterErr.doc).toEqual(sampleDoc);
    expect(afterErr.errorMessage).toBe('读取失败');
  });
});
