# Prompt Composer v0.1.0

First release (2026-10-04). Write prompts for Claude Code in a rich Markdown editor, kept in a searchable library inside your project.

## Install

Download `prompt-composer-0.1.0.vsix`, then:

```bash
code --install-extension prompt-composer-0.1.0.vsix
```

Or in VS Code: Extensions view → **⋯** → **Install from VSIX…**. Needs VS Code 1.95 or later, with a folder open.

SHA-256: `0c17f66012d134e202976218ba74d5a0284658e3b29f0643cbd87d4d67ee13c8`

## What's in it

**Prompt library**
- A **Prompt Composer** panel in the Activity Bar. By default it lists Pinned and today's prompts. The **⋯** menu switches to this month or all months.
- Search covers every month and shows each matching line, highlighted.
- Click a prompt to preview it, double-click to open it. Right-click for Open to the Side, Copy as Prompt, Copy @Path for Claude, Pin, Duplicate, Reveal in File Explorer and Delete.
- Start a prompt with the **New Prompt** button, by double-clicking empty space in the panel, or by double-clicking the empty tab bar or editor area.

**Editor**
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

**Storage**
- Prompts are saved as `.prompt` files with Markdown inside, in `.prompt-composer/YYYY-MM/` in your project. Images go in `.prompt-composer/images/`.
- The folder is git-ignored. It's hidden from VS Code's Explorer, Search and Quick Open through contributed defaults, so nothing is written to your `settings.json`.
- Saving works like any file: Ctrl+S, or VS Code's Auto Save. Unsaved changes survive a window reload.
- **Copy as Prompt** turns images into `@paths` Claude Code can read.

## Tested

- 89 unit, 52 integration and 40 end-to-end tests pass in real VS Code 1.140 on Windows 11. One end-to-end test is skipped: Auto Save when the window loses focus, which the integration tests cover and is checked by hand.
- The packaged `.vsix` was installed into a clean VS Code profile and used to write and save a prompt.
