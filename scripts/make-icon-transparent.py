#!/usr/bin/env python3
"""
make-icon-transparent.py — 把 RGB 源 PNG (有白底) 转为 RGBA, 仅四角外部背景透明.

策略: 不靠颜色键 (会误伤白色高光 / 云朵), 而是从四个角 + 四边中点 BFS
flood-fill, 把任何"通过相似色像素可达"到边缘的区域视为背景, alpha=0.
这样设计元素 (例如 rounded-square 内的白色云 / 高光 / K 字母 / 装饰元素)
即使内部包含近白像素, 也不会被错抠.

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

    # 1. BG 颜色: 四角均值.
    corners = np.array([
        img[0, 0], img[0, W - 1], img[H - 1, 0], img[H - 1, W - 1],
    ])
    bg = corners.mean(axis=0).round().astype(np.int32)
    print(f'BG color (corners mean): {bg}')

    # 2. 像素到 BG 的 L2 距离.
    diff = img - bg
    dist = np.sqrt((diff ** 2).sum(axis=-1))

    # 3. BFS flood-fill 从四角 + 四边中点出发. 距离 < TOLERANCE 视为可达 BG.
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

    print(f'reachable (BG) pixels: {reachable.sum()}')
    print(f'opaque pixels: {(~reachable).sum()}')

    # 4. 输出 RGBA.
    alpha = np.where(reachable, 0, 255).astype(np.uint8)
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