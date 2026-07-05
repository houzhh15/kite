#!/usr/bin/env bash
# scripts/regenerate-icons.sh — 重新生成 Tauri 2 应用图标 (Windows/macOS/Linux/iOS/Android).
#
# 用法:
#   ./scripts/regenerate-icons.sh [path-to-source.png]
#
# 默认源文件: src-tauri/icons/source/kite_icon_1254x1254.png
#
# 依赖: cargo-tauri (https://tauri.app/distribution/) — `cargo install tauri-cli --version '^2'`.
# 'cargo tauri icon' 接受一个 ≥ 1024×1024 的 PNG, 输出 src-tauri/icons/ 下全套图标:
#   - icon.ico       (Windows 多尺寸)
#   - icon.icns      (macOS 多尺寸, App bundle / Dock / Spotlight)
#   - icon.png       (1024×1024, Linux default)
#   - 32x32.png, 128x128.png, 128x128@2x.png (Linux alt)
#   - Square*.png    (Windows Store legacy)
#   - ios/AppIcon-*.png   (iOS, AppIcon.appiconset 内可指向它们)
#   - android/mipmap-*.png (Android, manifest @mipmap/ic_launcher)
#
# 注意: 此脚本必须在仓库根目录运行, 因为 `cargo tauri icon` 会修改 src-tauri/icons.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${1:-$ROOT/src-tauri/icons/source/kite_icon_1254x1254.png}"
if [[ ! -f "$SRC" ]]; then
  echo "✗ Source file not found: $SRC"
  echo "  Usage: $0 [path-to-source.png]"
  exit 1
fi

echo "→ Generating icons from $SRC via 'cargo tauri icon'"
( cd src-tauri && cargo tauri icon "$SRC" )
echo "✓ Done. Icons written to src-tauri/icons/."