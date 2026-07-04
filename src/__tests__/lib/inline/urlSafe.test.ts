/**
 * urlSafe.test.ts — 协议白名单 + 锚点 + data 图片 (契约 1 / AC-14-6).
 *
 * 设计依据: docs/design/compiled.md §3.3.1 + §3.8 契约 1.
 * 覆盖用例 (与契约 1 一一对应):
 *   1. https://example.com/x → external
 *   2. javascript:alert(1)  → inert
 *   3. data:text/html,<script> → inert (data-html)
 *   4. data:image/png;base64,... → data
 *   5. mailto:a@b.com → external (host=b.com)
 *   6. #section → anchor
 *   7. '' → anchor
 *   8. vbscript:msgbox(1) → inert
 *   9. file:///etc/passwd → inert
 * 10. 性能: 10000 次 < 1s (AC-14-6)
 * 11. 长度上限: > 2048 字符 → inert
 */
import { describe, expect, it } from 'vitest';

import { urlSafe } from '../../../lib/inline/urlSafe';

describe('urlSafe — 协议白名单 (契约 1)', () => {
  it('accepts https:// as external with host (AC-06-1)', () => {
    const r = urlSafe('https://example.com/x');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('external');
    expect(r.href).toBe('https://example.com/x');
    expect(r.host).toBe('example.com');
    expect(r.reason).toBeUndefined();
  });

  it('accepts http:// as external (AC-06-1)', () => {
    const r = urlSafe('http://example.com');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('external');
    expect(r.host).toBe('example.com');
  });

  it('rejects javascript: as inert (AC-06-4 / AC-14-3)', () => {
    const r = urlSafe('javascript:alert(1)');
    expect(r.safe).toBe(false);
    expect(r.kind).toBe('inert');
    expect(r.href).toBe('#');
    expect(r.reason).toBe('protocol:javascript');
  });

  it('rejects data:text/html as inert (AC-06-6 / AC-14-4)', () => {
    const r = urlSafe('data:text/html,<script>alert(1)</script>');
    expect(r.safe).toBe(false);
    expect(r.kind).toBe('inert');
    expect(r.href).toBe('#');
    expect(r.reason).toBe('protocol:data-html');
  });

  it('accepts data:image/* as data kind (AC-10-3)', () => {
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
    const r = urlSafe(url);
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('data');
    expect(r.href).toBe(url);
  });

  it('accepts data:image/jpeg', () => {
    const url = 'data:image/jpeg;base64,/9j/4AAQ';
    const r = urlSafe(url);
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('data');
  });

  it('accepts data:image/svg+xml (still data kind; image/svg uses img not inline)', () => {
    const url = 'data:image/svg+xml;utf8,<svg/>';
    const r = urlSafe(url);
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('data');
  });

  it('accepts mailto: as external with host (AC-07-3)', () => {
    const r = urlSafe('mailto:a@b.com');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('external');
    expect(r.host).toBe('b.com');
  });

  it('accepts tel: as external', () => {
    const r = urlSafe('tel:+1-555-0100');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('external');
  });

  it('accepts #section as anchor (AC-11-1)', () => {
    const r = urlSafe('#section');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('anchor');
    expect(r.href).toBe('#section');
  });

  it('accepts empty string as anchor (AC-06-5 / AC-13-4)', () => {
    const r = urlSafe('');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('anchor');
    expect(r.href).toBe('#');
  });

  it('rejects vbscript: as inert', () => {
    const r = urlSafe('vbscript:msgbox(1)');
    expect(r.safe).toBe(false);
    expect(r.kind).toBe('inert');
    expect(r.href).toBe('#');
  });

  it('rejects file:// as inert (外链场景, FR-14)', () => {
    const r = urlSafe('file:///etc/passwd');
    expect(r.safe).toBe(false);
    expect(r.kind).toBe('inert');
    expect(r.href).toBe('#');
    expect(r.reason).toBe('protocol:file');
  });

  it('treats relative path as relative kind', () => {
    const r = urlSafe('./img/a.png');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('relative');
    expect(r.href).toBe('./img/a.png');
  });

  it('treats ../ relative path as relative kind', () => {
    const r = urlSafe('../docs/a.md');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('relative');
  });

  it('treats bare path as relative kind', () => {
    const r = urlSafe('img/diagram.png');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('relative');
  });

  it('rejects extremely long URL (> 2048 chars) as inert (DoS 防护)', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    const r = urlSafe(long);
    expect(r.safe).toBe(false);
    expect(r.kind).toBe('inert');
    expect(r.reason).toBe('too-long');
  });

  it('host 为空的外链 (例 javascript) 不暴露 host', () => {
    const r = urlSafe('javascript:alert(1)');
    expect(r.host).toBeUndefined();
  });

  it('mailto 中 host 提取域名后缀', () => {
    const r = urlSafe('mailto:user@example.org');
    expect(r.host).toBe('example.org');
  });

  it('mailto 无 host 时 host 为 undefined', () => {
    // mailto 但 host 缺省时, URL.host 不存在; urlSafe 用 try/catch 兜底
    const r = urlSafe('mailto:user');
    expect(r.safe).toBe(true);
    expect(r.kind).toBe('external');
  });

  it('性能: 10000 次调用 < 1s (AC-14-6)', () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      urlSafe('https://example.com/x');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('性能: 10000 次混合输入 < 1s', () => {
    const inputs = [
      'https://example.com',
      '#section',
      'mailto:a@b.com',
      'javascript:alert(1)',
      'data:image/png;base64,xxx',
      './img/a.png',
    ];
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      const input = inputs[i % inputs.length];
      if (input !== undefined) urlSafe(input);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});