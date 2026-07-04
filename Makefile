# KITE — 本地 release 构建入口
#
# 与 .github/workflows/release.yml (T14 / F-30 / F-45) 流水线对齐：
#   1. npm ci / npm run build            (前端构建，含 tsc + vite + drop_console)
#   2. (cd src-tauri && cargo tauri build --release)
#                                       (Tauri 打包：.app / .dmg / .msi / .exe)
#   3. npm run check-perf-budget         (体积门禁 < 30 MB，T23.4)
#
# 用法：
#   make release-macos       # 在 macOS 上构建 .app + .dmg
#   make release-windows     # 在 Windows / 交叉编译环境下构建 .msi + .exe
#   make release-all         # 依次执行 macos + windows（仅当同时满足两者前置条件）
#
# 跨平台说明：
#   - macOS 产物（.app / .dmg）只能在 macOS 上产出；签名需 codesign + productsign
#     （CI 由 release.yml step 15 完成；本机未配置 MACOS_CERT_P12 时跳过）。
#   - Windows 产物（.msi / .exe）最佳产出环境是 windows-latest；macOS 上交叉编译
#     需要额外安装 osslsigncode / mingw 工具链，本 Makefile 不承担。
#   - `release-all` 在当前主机上同时调用两个目标；若当前平台不满足某个目标的前置
#     条件（例如在 Linux 上跑 release-windows），该目标会快速失败并打印错误。
#
# 前置：
#   - Node 20+、npm 10+
#   - Rust stable + cargo (rustup)
#   - Tauri 系统依赖（macOS: Xcode CLT；Windows: WebView2 + MSVC；Linux: webkit2gtk）
#   - tauri-cli (`cargo install tauri-cli --version "^2" --locked`)

# ------------------------------------------------------------------------------
# 顶层目标
# ------------------------------------------------------------------------------

.PHONY: release-all release-macos release-windows help

help: ## 显示帮助
	@echo "KITE release 构建入口"
	@echo ""
	@echo "用法："
	@echo "  make release-macos    # 在 macOS 上构建 .app + .dmg"
	@echo "  make release-windows  # 在 Windows 上构建 .msi + .exe（或交叉编译）"
	@echo "  make release-all      # 依次执行 macos + windows"
	@echo ""
	@echo "产物路径："
	@echo "  macOS:   src-tauri/target/release/bundle/macos/ + dmg/"
	@echo "  Windows: src-tauri/target/release/bundle/msi/  + nsis/"

release-all: release-macos release-windows ## 依次构建 macOS + Windows release 产物

release-macos: ## 构建 macOS release 产物（.app + .dmg）
	@echo "==> [macOS] target host = $(shell uname -s 2>/dev/null || echo Windows)"
	@if [ "$(shell uname -s 2>/dev/null)" != "Darwin" ]; then \
		echo "ERROR: release-macos 必须在 macOS 主机上执行（当前非 Darwin 内核）" >&2; \
		echo "提示：macOS .app / .dmg 产物需要 codesign + hdiutil，仅在 macOS 上可用。" >&2; \
		exit 1; \
	fi
	@echo "==> [macOS] 1/3  npm ci"
	@npm ci
	@echo "==> [macOS] 2/3  npm run build (tsc + vite + drop_console)"
	@npm run build
	@echo "==> [macOS] 3/3  cargo tauri build --release"
	@(cd src-tauri && cargo tauri build --release)
	@echo "==> [macOS] 体积门禁 (check-perf-budget)"
	@npm run check-perf-budget
	@echo ""
	@echo "✓ macOS release 构建完成"
	@echo "  产物：src-tauri/target/release/bundle/macos/"
	@ls -lh src-tauri/target/release/bundle/macos/ 2>/dev/null || true
	@echo "  DMG ：src-tauri/target/release/bundle/dmg/"
	@ls -lh src-tauri/target/release/bundle/dmg/ 2>/dev/null || true

release-windows: ## 构建 Windows release 产物（.msi + .exe）
	@echo "==> [Windows] target host = $(shell uname -s 2>/dev/null || echo Windows)"
	@case "$(shell uname -s 2>/dev/null)" in \
		MINGW*|MSYS*|CYGWIN*) \
			echo "  在 Git-Bash / MSYS 环境检测到 Windows 主机，继续。" ;; \
		Darwin|Linux) \
			echo "ERROR: release-windows 当前主机为 $(shell uname -s)，未检测到 Windows 环境。" >&2; \
			echo "提示：交叉编译到 Windows 需要 mingw-w64 + osslsigncode 等额外工具链，" >&2; \
			echo "      建议在 windows-latest runner 上执行（与 release.yml matrix 一致）。" >&2; \
			exit 1; \
			;; \
		*) \
			echo "  主机内核未识别，假定继续（请确认已安装 WebView2 + MSVC）。" ;; \
	esac
	@echo "==> [Windows] 1/3  npm ci"
	@npm ci
	@echo "==> [Windows] 2/3  npm run build (tsc + vite + drop_console)"
	@npm run build
	@echo "==> [Windows] 3/3  cargo tauri build --release"
	@(cd src-tauri && cargo tauri build --release)
	@echo "==> [Windows] 体积门禁 (check-perf-budget)"
	@npm run check-perf-budget
	@echo ""
	@echo "✓ Windows release 构建完成"
	@echo "  产物：src-tauri/target/release/bundle/msi/"
	@ls -lh src-tauri/target/release/bundle/msi/ 2>/dev/null || true
	@echo "        src-tauri/target/release/bundle/nsis/"
	@ls -lh src-tauri/target/release/bundle/nsis/ 2>/dev/null || true