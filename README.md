<div align="center">
  <img src="src/assets/kite_logo.png" alt="KITE — a markdown reader" width="320" />
</div>

<br />

# KITE

**KITE** is a lightweight Markdown reader built on [Tauri](https://tauri.app/) 2. It's a single-window desktop app that opens local `.md` files and renders them safely — no editor, no plugins, no server, no telemetry. Just a fast reader for the documents you already have.

- **Local first** — every file stays on your disk. Open via menu, drag & drop, or file association.
- **Safe rendering** — strict CSP, sandboxed IPC, no remote scripts; HTML/mermaid/math are sanitized before display.
- **Three themes** — light / dark / follow system, with WCAG AA contrast in both modes.
- **Bilingual UI** — Simplified Chinese and English, switchable from the settings panel.
- **Keyboard-first** — 16 built-in shortcuts for navigation, zoom, theme, history, and reload.

## Keyboard shortcuts

`⌘` on macOS, `Ctrl` on Windows / Linux. Every shortcut is registered centrally in `src/lib/shortcuts.ts`.

| Shortcut                     | Action                          |
| ---------------------------- | ------------------------------- |
| `⌘ / Ctrl + O`               | Open Markdown file              |
| `⌘ / Ctrl + F`               | Find in page                    |
| `⌘ / Ctrl + =`               | Increase font size              |
| `⌘ / Ctrl + -`               | Decrease font size              |
| `⌘ / Ctrl + 0`               | Reset font size                 |
| `⌘ / Ctrl + Shift + L`       | Cycle theme (light / dark / system) |
| `⌘ / Ctrl + Shift + P`       | Recent files drawer             |
| `⌘ / Ctrl + T`               | Toggle directory tree           |
| `⌘ / Ctrl + [`               | Back (history)                  |
| `⌘ / Ctrl + ]`               | Forward (history)               |
| `⌘ / Ctrl + E`               | Open current file in external editor |
| `⌘ / Ctrl + R`               | Reload current document         |
| `Home`                       | Scroll to top                   |
| `End`                        | Scroll to bottom                |
| `Esc`                        | Close top-most overlay          |

A reminder overlay appears on first launch. Dismiss it once or tick "don't show again" in the settings menu.
