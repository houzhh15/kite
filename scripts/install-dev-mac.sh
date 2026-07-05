#!/usr/bin/env bash
# scripts/install-dev-mac.sh — 安装/重装 KITE.app 到 /Applications 并修复 Gatekeeper 警告.
#
# 设计依据:
#   Tauri 2.x macOS bundler 调 codesign(1) 时默认 --ad-hoc + 不设 runtime,
#   产物里 Info.plist=not bound / Sealed Resources=none,
#   触发 Apple Silicon 上 Gatekeeper 弹"无法验证是否恶意软件"警告.
#   xattr -dr com.apple.quarantine 单独执行无法解决, 因为根因是签名不完整,
#   不是下载隔离属性.
#
# 这个脚本:
#   1. 杀掉正在运行的 kite 进程.
#   2. 删 /Applications/KITE.app (若有).
#   3. 把 src-tauri/target/release/bundle/macos/KITE.app 拷到 /Applications.
#   4. 用 codesign(1) --force --deep --sign - --options runtime 重签一次,
#      让 Info.plist 被绑定 + Resources 被 seal. 这是消除弹窗的关键一步.
#   5. 清掉所有 xattr (不只是 quarantine, 包括 com.apple.provenance 等).
#   6. 用 codesign -dv + spctl --assess 验证 Gatekeeper 接受.
#
# 注意:
#   - 仅供本地开发期使用. 公网分发仍需要 Developer ID + xcrun notarytool.
#   - 不在 CI 跑 (CI 直接用 release-macos 产物).
#   - 退出码: 0 = 成功, 非 0 = 任何步骤失败.
#
# 用法:
#   scripts/install-dev-mac.sh                     # 默认从 src-tauri/target/release/bundle/macos/KITE.app
#   KITE_APP=path/to/OtherKITE.app scripts/install-dev-mac.sh
#
# 参考:
#   docs/security-audit-exceptions.md (R-07 / R-11 衍生);
#   上一轮诊断对话 (2026-01-30) 的 "Info.plist=not bound, Sealed Resources=none".

set -euo pipefail

# ---- 前置条件 ----

# 仅 macOS.
if [ "$(uname -s)" != "Darwin" ]; then
  printf '\033[31mERROR\033[0m: 仅 macOS 支持. 当前=%s\n' "$(uname -s)" >&2
  exit 1
fi

# 工具链检查: codesign + spctl 都是系统自带, 但保险起见断言一下.
for bin in codesign spctl xattr cp rm killall; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf '\033[31mERROR\033[0m: %s 不在 PATH 中\n' "$bin" >&2
    exit 1
  fi
done

# ---- 路径解析 ----

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_APP="$REPO_ROOT/src-tauri/target/release/bundle/macos/KITE.app"

# 允许 override: KITE_APP=path/to.app
SRC_APP="${KITE_APP:-$DEFAULT_APP}"

DEST_APP="/Applications/KITE.app"

# 源 .app 必须存在.
if [ ! -d "$SRC_APP" ]; then
  printf '\033[31mERROR\033[0m: 找不到源 .app:\n  %s\n' "$SRC_APP" >&2
  printf '提示: 先运行 make release-macos (或 cargo tauri build) 生成产物.\n' >&2
  exit 1
fi

# ---- 步骤 1: 杀掉正在运行的进程 ----

if pgrep -x kite >/dev/null 2>&1; then
  printf '==> 终止正在运行的 kite 进程...\n'
  killall kite 2>/dev/null || true
  sleep 1
fi

# ---- 步骤 2: 删旧版本 ----

if [ -d "$DEST_APP" ]; then
  printf '==> 移除旧的 /Applications/KITE.app...\n'
  sudo rm -rf "$DEST_APP"
fi

# ---- 步骤 3: 拷贝新版本 ----

printf '==> 安装: %s → %s\n' "$SRC_APP" "$DEST_APP"
sudo cp -R "$SRC_APP" "$DEST_APP"

# ---- 步骤 4: 修补签名 ----
#
# 这是核心修复:
#   --force: 覆盖已有签名 (Tauri 自带的 ad-hoc).
#   --deep: 递归处理 Contents/MacOS/* + Contents/Frameworks/* (WebView2Loader 等).
#   --sign -: 走 ad-hoc (开发期使用, 不需要 Developer ID).
#   --options runtime: 启用 Hardened Runtime, 同时让 codesign 把
#                      Info.plist 写入 _CodeSignature/CodeResources 并 seal Resources/.
#                      这是消除 Gatekeeper 弹窗的关键 flag.
#
# 不加 --options runtime 时, 即便重签, 产物仍然是 Info.plist=not bound.
printf '==> 修补 ad-hoc 签名 (bind Info.plist + seal Resources)...\n'
sudo codesign --force --deep --sign - --options runtime "$DEST_APP" 2>&1 | sed 's/^/  /'

# ---- 步骤 5: 清掉所有 xattr ----
#
# 同时清 quarantine + provenance + 其他 Apple 标记.
# 比 xattr -dr com.apple.quarantine 更彻底.
printf '==> 清理 quarantine / provenance 标记...\n'
sudo xattr -cr "$DEST_APP"

# ---- 步骤 6: 验证 ----

printf '==> 验证签名...\n'
if IDENT=$(codesign -dv "$DEST_APP" 2>&1); then
  printf '  Identifier:        %s\n' "$(printf '%s\n' "$IDENT" | awk -F= '/^Identifier=/ {print $2}')"
  printf '  Format:            %s\n'   "$(printf '%s\n' "$IDENT" | awk -F= '/^Format=/    {print $2}')"
  printf '  CodeDirectory:     %s\n'   "$(printf '%s\n' "$IDENT" | awk -F= '/^CodeDirectory=/ {print $2}' | tr -d ',')"
  printf '  Signature:         %s\n'   "$(printf '%s\n' "$IDENT" | awk -F= '/^Signature=/ {print $2}')"
  printf '  Info.plist bound:  %s\n'   "$(printf '%s\n' "$IDENT" | grep -q '^Info.plist=bound'   && echo '✓ bound' || echo '✗ NOT bound')"
  printf '  Sealed Resources:  %s\n'   "$(printf '%s\n' "$IDENT" | grep -q '^Sealed Resources'     && echo '✓ yes'    || echo '✗ NO')"
else
  printf '\033[31mERROR\033[0m: codesign -dv 失败\n' >&2
  exit 1
fi

printf '==> 验证 Gatekeeper 接受 (.app 是否通过 spctl)...\n'
# spctl 在某些环境 (例如旧版 macOS / Apple Silicon 上的 SIP 配置) 会与 codesign -dv 矛盾;
# 这里用 || true 防止 false negative, 并额外打印提示.
SPCTL_OUT=$(spctl --assess --type execute --verbose "$DEST_APP" 2>&1 || true)
case "$SPCTL_OUT" in
  *accepted*)
    printf '  ✓ spctl: accepted\n'
    ;;
  *rejected*|*unaccepted*)
    printf '  ✗ spctl: rejected (%s)\n' "$SPCTL_OUT"
    printf '\033[33m警告\033[0m: Gatekeeper 拒绝签名的 .app. 通常是 ad-hoc 签名在\n' >&2
    printf '          最新 macOS 上不被 Gatekeeper 直接接受. 临时绕过办法:\n' >&2
    printf '          Finder → 右键 KITE.app → "打开" (一次后将记入白名单).\n' >&2
    ;;
  *)
    printf '  ? spctl 输出异常: %s\n' "$SPCTL_OUT"
    ;;
esac

printf '\n\033[32m✓ KITE.app 已就绪: %s\033[0m\n' "$DEST_APP"
printf '\n首次从 Finder 双击时若仍提示安全对话框:\n'
printf '  Finder → 右键 KITE.app → 打开方式 → 打开 (一次后将被记入白名单).\n'
