/**
 * ImageHandler — Markdown 图片处理器 (契约 5 / FR-10) + T08 step-5 接入.
 *
 * 设计依据: docs/design/compiled.md §3.5.2 + §3.8 契约 5 + FR-10 + T08 step-5.
 *
 * 责任:
 *   - src 经 urlSafe() 校验; 危险协议改写 src=''
 *   - 相对路径 → 通过 resolveImagePath 异步解析, 结果写入 LRU (imageCache)
 *   - 解析失败回退为占位 (src 留原值以触发 img onError → 占位 UI)
 *   - onError 触发 → data-broken="true"
 *   - 默认属性: loading="lazy" / decoding="async" / referrerPolicy="no-referrer"
 *   - data-t09-clickable="true" 供 T09 委托放大查看
 *   - T08 step-5: onClick 委托 useImageViewer.open; 父级为 <a href="https://...">
 *     时不触发 (T07 LinkHandler 已 preventDefault + stopPropagation).
 *
 * 不实现:
 *   - 放大弹窗 UI 本身 (由 <ImageViewer /> 顶层单例负责)
 *   - onError 内联 SVG 占位 UI (通过 CSS data-broken 视觉降级)
 */
import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveImagePath } from '../lib/tauri';
import { urlSafe } from '../lib/inline/urlSafe';
import { useDocStore } from '../stores/docStore';
import { imageCache } from '../lib/imageCache';
import { useImageViewer } from '../hooks/useImageViewer';
import { pushToast } from '../lib/toast';

export interface ImageHandlerProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  alt?: string;
}

export function ImageHandler(props: ImageHandlerProps): JSX.Element {
  const { src, alt, title, ...rest } = props;
  const { t } = useTranslation(); // T18 (FR-02 / §3.4 P1): image.loadFail 模板插值.
  const basePath = useDocStore((s) => s.state.currentPath);
  const viewer = useImageViewer();
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (typeof src !== 'string' || src.length === 0) {
      setResolvedSrc('');
      return () => {
        cancelled = true;
      };
    }
    const check = urlSafe(src);
    if (!check.safe) {
      setResolvedSrc('');
      return () => {
        cancelled = true;
      };
    }
    // 1) 相对路径 → 走 LRU + IPC
    if (check.kind === 'relative') {
      const key = `${basePath ?? ''}::${src}`;
      const cached = imageCache.get(key);
      if (cached) {
        setResolvedSrc(cached);
        return () => {
          cancelled = true;
        };
      }
      // base 为空 → resolveImagePath 自身 reject, 这里兜底不再调 IPC.
      if (!basePath) {
        setResolvedSrc('');
        return () => {
          cancelled = true;
        };
      }
      resolveImagePath(basePath, src).then(
        (url) => {
          if (cancelled) return;
          imageCache.put(key, url);
          setResolvedSrc(url);
        },
        (err) => {
          if (cancelled) return;
          // 解析失败: 保留原 src, 让 <img> 走 onError → 占位 + toast.
          setResolvedSrc(src);
          setBroken(true);
          const msg =
            (err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : '');
          pushToast({ kind: 'error', message: t('image.loadFail', { msg }) });
        },
      );
      return () => {
        cancelled = true;
      };
    }
    // 2) external / data / anchor: 直接使用原值
    setResolvedSrc(src);
    return () => {
      cancelled = true;
    };
  }, [src, basePath]);

  // 父级为 <a> 时不触发 ImageViewer (T07 LinkHandler 已处理, 这里再防御一次).
  const onClick = (e: MouseEvent<HTMLImageElement>): void => {
    if (e.currentTarget.closest('a')) return;
    if (!resolvedSrc) return;
    e.preventDefault();
    e.stopPropagation();
    viewer.open(resolvedSrc, alt);
  };

  return (
    <img
      src={resolvedSrc}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-t09-clickable="true"
      data-broken={broken ? 'true' : undefined}
      onClick={onClick}
      onError={() => {
        setBroken(true);
      }}
      {...rest}
    />
  );
}

export default ImageHandler;
