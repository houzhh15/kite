#!/usr/bin/env python3
"""
make-icon-transparent.py — 把 RGB 源 PNG (有白底) 转为 RGBA, 仅四角外部背景透明.

两步策略 (互补):

1. **BFS flood-fill from 4 corners**: 把任何"通过相似色像素可达"到边缘的区域视为
   背景, alpha=0. 这把大块的外部 BG (含 rounded-square 外) 干净抠掉, 不伤内部
   设计元素 (因为设计元素有彩色边界隔开).

2. **第二步: 颜色键处理残留 BG** — BFS 阶段无法触达被文字轮廓封闭的内圈 (例如
   "kite" 字母 e/o/c 等含闭环的字体内圈). 这些闭环里的 BG 像素仍然是
   `#FAFAFC` 但被夹在文字里. 用颜色键 (BG 各通道都 ≥ 245) 把它们 alpha=0.

两步结合: BFS 处理大面积 BG, 颜色键处理 topologically-enclosed 残留, 互补完备.

用法:
    python3 scripts/make-icon-transparent.py <src.png> [<dst.png>]

默认: src=源, dst=源覆盖 (就地转换).
"""
import sys
import os
from collections import deque

import numpy as np
from PIL import Image


def make_transparent(src_path: str, dst_path: str | None = None) -> None:
    dst = dst_path or src_path
    img = np.array(Image.open(src_path).convert('RGB'), dtype=np.int32)
    H, W, _ = img.shape

    # Step 1: BG 颜色估计 (四角均值).
    corners = np.array([
        img[0, 0], img[0, W - 1], img[H - 1, 0], img[H - 1, W - 1],
    ])
    bg = corners.mean(axis=0).round().astype(np.int32)
    print(f'BG color (corners mean): {bg}')

    # Step 2: BFS flood-fill from 4 corners + 4 edge midpoints.
    diff = img - bg
    dist = np.sqrt((diff ** 2).sum(axis=-1))
    TOLERANCE = 60.0
    reachable = np.zeros((H, W), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    seeds = [
        (0, 0), (0, W - 1), (H - 1, 0), (H - 1, W - 1),
        (0, W // 2), (H - 1, W // 2), (H // 2, 0), (H // 2, W - 1),
    ]
    for y, x in seeds:
        if dist[y, x] <= TOLERANCE:
            reachable[y, x] = True
            queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and not reachable[ny, nx] and dist[ny, nx] <= TOLERANCE:
                reachable[ny, nx] = True
                queue.append((ny, nx))

    print(f'BFS-reachable (BG) pixels: {reachable.sum()}')

    # Step 3: 颜色键 — BFS 无法触达的 BG 残留 (被设计元素封闭的内圈) 通过
    # 颜色键补齐. 阈值: RGB 各通道 ≥ 245 (近白) 视为 BG 残留.
    # 这一步会把字母 e/o/c 等闭合字体里的 "#FAFAFC 残留" 也透明化.
    color_key_mask = (
        (img[..., 0] >= 245) & (img[..., 1] >= 245) & (img[..., 2] >= 245)
    )  # 只对 RGB 近白 (BG 残留); 不影响 kite 蓝 / 文字深蓝灰.

    # Step 4: 合并 BFS 区域 + 颜色键区域 → alpha=0; 其余 → alpha=255.
    transparent = reachable | color_key_mask
    alpha = np.where(transparent, 0, 255).astype(np.uint8)
    print(f'final transparent pixels: {transparent.sum()}')

    out = np.empty((H, W, 4), dtype=np.uint8)
    out[..., :3] = np.clip(img, 0, 255).astype(np.uint8)
    out[..., 3] = alpha

    Image.fromarray(out, mode='RGBA').save(dst, optimize=True)
    print(f'saved {dst} ({os.path.getsize(dst)} bytes)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    make_transparent(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)