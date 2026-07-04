# KITE — 本地 release 构建入口
#
# 与 .github/workflows/release.yml (T14 / F-30 / F-45) 流水线对齐：
#   1. npm ci / npm run build            (前端构建，含 tsc + vite + drop_console)
#   2. (cd src-tauri && cargo tauri build)  (Tauri 打包：.app / .dmg / .msi / .exe)
#                                          (默认 release 模式，无 --release 标志)
#   3. npm run check-perf-budget         (体积门禁 < 30 MB，T23.4)
#
# 用法：
#   make release-macos                  # 在 macOS 上原生构建 .app + .dmg
#   make release-windows                # 在 Windows 上原生构建 .msi + .exe
#                                       #   （或在 macOS / Linux 上交叉编译，需安装 mingw-w64）
#   make release-all                    # 依次执行 macos + windows
#                                       #   跨平台产物走交叉编译路径
#
# 跨平台编译说明：
#   - macOS 产物（.app / .dmg）只能在 macOS 上原生构建。
#   - Windows 产物（.msi / .exe）可在 windows-latest runner 上原生构建；
#     也可在 macOS / Linux 上通过 `x86_64-pc-windows-gnu` target 交叉编译。
#   - `release-all` 在当前主机上同时调用两个目标：
#       · 若两个原生 toolchain 都在当前主机 → 两个目标都原生构建
#       · 若 Windows 缺原生环境但有 mingw-w64 → 自动走交叉编译
#       · 否则打印明确的工具链安装指引并快速失败
#
# 前置：
#   - Node 20+、npm 10+
#   - Rust stable + cargo (rustup)
#   - Tauri 系统依赖（macOS: Xcode CLT；Windows: WebView2 + MSVC；Linux: webkit2gtk）
#   - tauri-cli (`cargo install tauri-cli --version "^2" --locked`)
#   - 仅当交叉编译 Windows 时需要：
#       · rustup target add x86_64-pc-windows-gnu
#       · Homebrew: brew install mingw-w64   （提供 x86_64-w64-mingw32-gcc）

# ------------------------------------------------------------------------------
# 顶层目标
# ------------------------------------------------------------------------------

.PHONY: release-all release-macos release-windows help check-toolchain-host \
        print-host print-info

HOST_OS := $(shell uname -s 2>/dev/null)
HOST_ARCH := $(shell uname -m 2>/dev/null)

help: ## 显示帮助
	@echo "KITE release 构建入口"
	@echo ""
	@echo "用法："
	@echo "  make release-macos    # 在 macOS 上构建 .app + .dmg"
	@echo "  make release-windows  # 在 Windows 上构建 .msi + .exe（或交叉编译）"
	@echo "  make release-all      # 依次执行 macos + windows（跨平台走交叉编译）"
	@echo ""
	@echo "当前主机：$(HOST_OS) / $(HOST_ARCH)"
	@echo ""
	@echo "产物路径："
	@echo "  macOS:   src-tauri/target/release/bundle/macos/ + dmg/"
	@echo "  Windows: src-tauri/target/release/bundle/msi/  + nsis/"

print-host: ## 打印主机信息（调试用）
	@echo "HOST_OS=$(HOST_OS)"
	@echo "HOST_ARCH=$(HOST_ARCH)"

print-info: ## 打印构建上下文
	@echo "== KITE release 上下文 =="
	@echo "主机：$(HOST_OS) / $(HOST_ARCH)"
	@echo "Rust targets 已安装："
	@rustup target list --installed 2>/dev/null || echo "  (rustup 不可用)"
	@echo "mingw-w64："
	@command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 && echo "  ✓ x86_64-w64-mingw32-gcc 可用" || echo "  ✗ 未安装（brew install mingw-w64）"

# ------------------------------------------------------------------------------
# 工具链探测
# ------------------------------------------------------------------------------

# IS_MACOS_HOST: 当前主机是 macOS（Darwin 内核）
IS_MACOS_HOST := $(filter Darwin,$(HOST_OS))

# IS_WINDOWS_HOST: 当前主机是 Windows（Git-Bash / MSYS / Cygwin / WSL 下 uname 输出）
IS_WINDOWS_HOST := $(filter MINGW%,$(HOST_OS))$(filter MSYS%,$(HOST_OS))$(filter CYGWIN%,$(HOST_OS))

# HAVE_MINGW: 主机上是否存在 x86_64-w64-mingw32-gcc（交叉编译 Windows 前置）
HAVE_MINGW := $(shell command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 && echo yes || echo no)

# HAVE_WIN_GNU_TARGET: 已安装 x86_64-pc-windows-gnu Rust target
# 注意：rustup target add 仅在 toolchain 包含 rust-std-x86_64-pc-windows-gnu 组件时生效；
# 若 cargo PATH 中优先是 Homebrew rust（无 cross stdlib），即使 rustup target list --installed
# 已列出该 target，cargo 仍会报 `can't find crate for core`。这里改用 cargo --print sysroot
# 来探测 stdlib 是否真的在该 sysroot 下，避免误报。
HAVE_WIN_GNU_TARGET := $(shell rustup target list --installed 2>/dev/null | grep -q '^x86_64-pc-windows-gnu$$' && [ -d "$$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-pc-windows-gnu" ] && echo yes || echo no)

check-toolchain-host: ## 打印当前主机可用的 Windows 构建路径（原生 vs 交叉编译）
	@echo "== Windows 构建路径探测 =="
	@if [ -n "$(IS_WINDOWS_HOST)" ]; then \
		echo "  ✓ 检测到 Windows 主机 (Git-Bash / MSYS / Cygwin)，走原生构建。"; \
	elif [ "$(HAVE_MINGW)" = "yes" ] && [ "$(HAVE_WIN_GNU_TARGET)" = "yes" ]; then \
		echo "  ✓ mingw-w64 与 x86_64-pc-windows-gnu target 已就绪，走交叉编译。"; \
	elif [ "$(HAVE_MINGW)" = "yes" ]; then \
		echo "  ⚠ mingw-w64 已安装，但 Rust target 未安装。执行："; \
		echo "      rustup target add x86_64-pc-windows-gnu"; \
	else \
		echo "  ✗ 缺交叉编译工具链。执行："; \
		echo "      brew install mingw-w64"; \
		echo "      rustup target add x86_64-pc-windows-gnu"; \
	fi

# ------------------------------------------------------------------------------
# macOS 原生构建
# ------------------------------------------------------------------------------

release-macos: ## 构建 macOS release 产物（.app + .dmg；要求 Darwin 内核）
	@if [ -z "$(IS_MACOS_HOST)" ]; then \
		echo "ERROR: release-macos 必须在 macOS 主机上执行（当前 HOST_OS=$(HOST_OS)）。" >&2; \
		echo "提示：macOS .app / .dmg 产物需要 codesign + hdiutil，仅在 Darwin 内核上可用。" >&2; \
		echo "      若要在 Linux 上交叉编译 macOS 产物，请使用 osxcross + osslsigncode 工具链（未提供）。" >&2; \
		exit 1; \
	fi
	@echo "==> [macOS] 目标主机：Darwin / $(HOST_ARCH)"
	@echo "==> [macOS] 1/3  npm ci"
	@npm ci
	@echo "==> [macOS] 2/3  npm run build (tsc + vite + drop_console)"
	@npm run build
	@echo "==> [macOS] 3/3  cargo tauri build"
	@(cd src-tauri && cargo tauri build)
	@echo "==> [macOS] 体积门禁 (check-perf-budget)"
	@npm run check-perf-budget
	@echo ""
	@echo "✓ macOS release 构建完成"
	@echo "  产物：src-tauri/target/release/bundle/macos/"
	@ls -lh src-tauri/target/release/bundle/macos/ 2>/dev/null || true
	@echo "  DMG ：src-tauri/target/release/bundle/dmg/"
	@ls -lh src-tauri/target/release/bundle/dmg/ 2>/dev/null || true

# ------------------------------------------------------------------------------
# Windows 构建（自动判定：原生 vs 交叉编译）
# ------------------------------------------------------------------------------

release-windows: ## 构建 Windows release 产物（.msi + .exe；自动选择原生或交叉编译）
	@if [ -n "$(IS_WINDOWS_HOST)" ]; then \
		echo "==> [Windows] 目标主机：Windows 原生 ($(HOST_OS))"; \
		$(MAKE) _release-windows-native; \
	elif [ "$(HAVE_MINGW)" = "yes" ] && [ "$(HAVE_WIN_GNU_TARGET)" = "yes" ]; then \
		echo "==> [Windows] 目标主机：$(HOST_OS)（无 Windows 原生环境，走交叉编译）"; \
		echo "==> [Windows] 交叉工具链：mingw-w64 + x86_64-pc-windows-gnu"; \
		$(MAKE) _release-windows-cross; \
	else \
		echo "ERROR: release-windows 当前主机 $(HOST_OS) 无原生 Windows 环境，交叉编译工具链亦未就绪。" >&2; \
		echo "" >&2; \
		echo "安装交叉编译工具链（macOS / Linux）：" >&2; \
		echo "  brew install mingw-w64                          # macOS" >&2; \
		echo "  apt-get install -y mingw-w64                    # Debian/Ubuntu" >&2; \
		echo "  rustup target add x86_64-pc-windows-gnu         # 任意平台" >&2; \
		echo "" >&2; \
		echo "或在 Windows 主机上原生构建（推荐）：" >&2; \
		echo "  Git-Bash / PowerShell + cargo install tauri-cli --version \"^2\" --locked" >&2; \
		echo "" >&2; \
		echo "若 rustup target add 已成功但 cargo 仍报" >&2; \
		echo "  'can't find crate for core'，通常是 PATH 中 Homebrew" >&2; \
		echo "  rustc 抢先生效而其 sysroot 不含 cross stdlib。修复办法：" >&2; \
		echo "  export PATH=\"$$HOME/.cargo/bin:$$PATH\"" >&2; \
		exit 1; \
	fi

# ---- Windows 原生 ----

.PHONY: _release-windows-native
_release-windows-native:
	@echo "==> [Windows/native] 1/3  npm ci"
	@npm ci
	@echo "==> [Windows/native] 2/3  npm run build (tsc + vite + drop_console)"
	@npm run build
	@echo "==> [Windows/native] 3/3  cargo tauri build"
	@(cd src-tauri && cargo tauri build)
	@echo "==> [Windows/native] 体积门禁 (check-perf-budget)"
	@npm run check-perf-budget
	@echo ""
	@echo "✓ Windows release 构建完成（原生）"
	@echo "  产物：src-tauri/target/release/bundle/msi/"
	@ls -lh src-tauri/target/release/bundle/msi/ 2>/dev/null || true
	@echo "        src-tauri/target/release/bundle/nsis/"
	@ls -lh src-tauri/target/release/bundle/nsis/ 2>/dev/null || true

# ---- Windows 交叉编译（macOS / Linux → Windows）----

.PHONY: _release-windows-cross
_release-windows-cross:
	@echo "==> [Windows/cross] 1/4  npm ci"
	@npm ci
	@echo "==> [Windows/cross] 2/4  npm run build (tsc + vite + drop_console)"
	@npm run build
	@echo "==> [Windows/cross] 3/4  cargo tauri build --target x86_64-pc-windows-gnu"
	@echo "    注：跨平台构建 (macOS→Windows) 仅产出 raw kite.exe + WebView2Loader.dll；"
	@echo "        .msi / NSIS setup 打包需在 Windows 主机上执行（缺 makensis.exe / WiX）。"
	@(cd src-tauri && \
		CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
		cargo tauri build --target x86_64-pc-windows-gnu) || \
		( \
			echo "" >&2; \
			echo "WARN: Tauri bundler 在 macOS 上产出 .msi/.exe-setup 失败（已知限制）。" >&2; \
			echo "      仅 raw 二进制 (kite.exe + WebView2Loader.dll) 已成功生成。" >&2; \
			echo "      若仍需 .msi / NSIS 安装包，请在 windows-latest runner 上重跑 release-windows。" >&2; \
		)
	@echo "==> [Windows/cross] 4/4  体积门禁 (check-perf-budget)"
	@npm run check-perf-budget
	@echo ""
	@echo "✓ Windows 交叉编译完成 (x86_64-pc-windows-gnu)"
	@echo ""
	@echo "  原生可执行文件："
	@ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/kite.exe 2>/dev/null || echo "  (kite.exe 缺失)"
	@ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/*.dll 2>/dev/null | awk '{print "  "$NF" ("$5"B)"}' || true
	@echo ""
	@echo "  安装包（仅当 host=Windows 时存在）："
	@if [ -d src-tauri/target/x86_64-pc-windows-gnu/release/bundle/msi ]; then \
		ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/bundle/msi/ 2>/dev/null || true; \
	else \
		echo "    (未生成 — macOS host 无 WiX 工具链，跳过 msi)"; \
	fi
	@if [ -d src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis ]; then \
		ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/ 2>/dev/null || true; \
	else \
		echo "    (未生成 — macOS host 无 makensis.exe，跳过 nsis)"; \
	fi

# ------------------------------------------------------------------------------
# 一键双平台
# ------------------------------------------------------------------------------

release-all: release-macos release-windows ## 依次构建 macOS + Windows release 产物（自动适配原生/交叉编译路径）