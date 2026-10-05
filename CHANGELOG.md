# Changelog

## 0.2.0 (2026-10-05)

### Claude Code's Ctrl+G opens in Prompt Composer

- With the new helper [`claude-code/claude-prompt-composer`](claude-code/claude-prompt-composer) set as Claude Code's `VISUAL`, **Ctrl+G** in Claude Code opens the prompt you're typing in the composer. **Close the tab** and the text is back in Claude's input. **Esc** or **Ctrl+C** in the terminal cancels. Set-up: [README](README.md#claude-code-ctrlg-opens-the-prompt-here).
- It opens in the VS Code window that has Claude's folder (or a folder above it) open, else in the window you used last, else in a new window on Claude's folder.
- Claude's prompt stays in Claude's temp folder. It isn't saved in `.prompt-composer/`, isn't listed in the panel and never asks to be saved. Every edit is written straight back.
- `@paths` are rewritten for the folder Claude runs in when VS Code is open on another one. Images become `@paths`, as with Copy as Prompt. An untouched prompt comes back exactly as Claude wrote it.
- Revert Prompt goes back to Claude's text. The editor shortcuts (Ctrl+B, Ctrl+K, Ctrl+S…) work in that tab like in any prompt.
- Your own prompts work exactly as before.

## 0.1.0 (2026-10-04)

First release.

### Prompt library

- A **Prompt Composer** panel in the Activity Bar. By default it lists Pinned and today's prompts. The **⋯** menu switches to this month or all months.
- Search covers every month and shows each matching line, highlighted.
- Click a prompt to preview it, double-click to open it. Right-click for Open to the Side, Copy as Prompt, Copy @Path for Claude, Pin, Duplicate, Reveal in File Explorer and Delete.
- Start a prompt with the **New Prompt** button, by double-clicking empty space in the panel, or by double-clicking the empty tab bar or editor area.

### Editor

- A rich Markdown editor (Tiptap) supporting:
  - headings, in a muted blue that follows your theme;
  - bullet, numbered and task lists, and quotes;
  - code blocks with syntax highlighting and a language picker;
  - links, dividers and images.
- `@` mentions of files and folders, symlinked folders included, with fuzzy search. Mentions of missing files are flagged.
- `/` commands, a bubble menu for formatting, and a drag handle (or Alt+↑/↓) to move blocks.
- Line numbers and a smooth caret.
- Paste or drop screenshots. **Click an image to zoom**: − / +, the scroll wheel, drag to move, Esc to close.
- Colours follow your VS Code theme.

### Storage

- Prompts are saved as `.prompt` files with Markdown inside, in `.prompt-composer/YYYY-MM/` in your project. Images go in `.prompt-composer/images/`.
- The folder is git-ignored. It's hidden from VS Code's Explorer, Search and Quick Open through contributed defaults, so nothing is written to your `settings.json`.
- Saving works like any file: Ctrl+S, or VS Code's Auto Save. Unsaved changes survive a window reload.
- **Copy as Prompt** turns images into `@paths` Claude Code can read.

### Requirements

VS Code 1.95 or later, with a folder open.
