# Prompt Composer

Write prompts for Claude Code in VS Code, in a rich Markdown editor, and never manage prompt files yourself.

- **New prompt in one action:** double-click the Prompt Composer panel, or empty space in the tab bar, or click **New Prompt**.
- **A Tiptap editor with everything a prompt needs:**
  - headings, lists, task lists, quotes
  - highlighted code blocks
  - `@` mentions of any file or folder, symlinks included
  - pasted screenshots
  - `/` commands, a bubble menu, moving blocks with Alt+↑/↓
- **A searchable library:** prompts are saved in `.prompt-composer/YYYY-MM/` in your project, git-ignored and hidden from VS Code's Explorer, Search and Quick Open automatically. The panel lists Pinned prompts and this month by day, and its search covers every month.
- **Plain Markdown on disk**, in `.prompt` files (their own extension, so Markdown editors and `*.md` settings leave them alone), with `@path` mentions Claude Code understands, and **Copy as Prompt** turns pasted images into `@paths` too.
- **Saving works like any VS Code file:** Ctrl+S, or VS Code's own Auto Save.
- **Claude Code's Ctrl+G opens here:** with the helper below, pressing Ctrl+G in Claude Code opens the prompt you're typing in this editor; close the tab and the text is back in Claude.

## Install

Each release is kept in [`releases/`](releases/), one folder per version, with its `.vsix` and release notes. To install v0.2.0:

```bash
code --install-extension releases/v0.2.0/prompt-composer-0.2.0.vsix
```

Or in VS Code: Extensions view → **⋯** → **Install from VSIX…** and pick the file. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Claude Code: Ctrl+G opens the prompt here

Claude Code's Ctrl+G opens the prompt you're typing in your editor (`$VISUAL`, else `$EDITOR`). With the helper [`claude-code/claude-prompt-composer`](claude-code/claude-prompt-composer) as that editor, it opens in Prompt Composer instead, and the text goes back to Claude when you close the tab.

**Set up (Linux and macOS, once):**

1. Copy the helper onto your `PATH` and make it executable:

   ```bash
   install -m 755 claude-code/claude-prompt-composer ~/.local/bin/
   ```

2. Make it Claude Code's editor in `~/.claude/settings.json`, then start Claude again:

   ```json
   { "env": { "VISUAL": "/home/<you>/.local/bin/claude-prompt-composer" } }
   ```

**Using it:**
- Press **Ctrl+G** in Claude Code. The prompt opens in VS Code, in the window open on Claude's folder (or a folder above it). If no window has it, it opens in the window you used last; with no window at all, in a new one on Claude's folder.
- Edit it like any prompt: `@` mentions, images, formatting. Every change is written straight back; there's nothing to save.
- **Close the tab** and the text is back in Claude's input, ready to send.
- **Esc** or **Ctrl+C** in the terminal cancels: Claude keeps the prompt it had.

**What it doesn't touch:**
- Claude's prompt stays in Claude's temp folder as `claude-prompt-<id>/Claude - <folder>.prompt`. It isn't saved in `.prompt-composer/`, isn't listed in the panel and never asks to be saved. Your own prompts work exactly as before.
- Any other file sent to `$VISUAL` (a git commit message, say) still goes to `$EDITOR`.

**Details:**
- `@paths` are written relative to the folder Claude runs in. When VS Code is open on another folder, they're rewritten for Claude: relative when the file is inside Claude's folder, absolute otherwise. Images become `@paths` too, as with Copy as Prompt.
- An untouched prompt comes back exactly as Claude wrote it.
- Each VS Code window lists its folder in `~/.cache/prompt-composer/windows/` (one small file per window, removed when it closes); that's how the helper finds the right window.

## Develop and test

```bash
npm install
```

Then run `npm run dev` (or Ctrl+F5 on **Run Extension (sample workspace)**) to open the Extension Development Host on a sample workspace. Plain F5 can hit a VS Code debugger bug ([microsoft/vscode#336233](https://github.com/microsoft/vscode/issues/336233)) that closes the window right away.

- [docs/TESTING.md](docs/TESTING.md): step-by-step manual checks, and how to run the automated suites.
- [docs/TEST-CASES.md](docs/TEST-CASES.md): every test case and its last result.
- [PLAN.md](PLAN.md): what the extension does and why.
- [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md): how it's built.

| Script | |
|---|---|
| `npm run dev` | Build and open VS Code with the extension on the sample workspace (no debugger) |
| `npm run build` / `npm run watch` | Build the extension and webviews |
| `npm run typecheck` | TypeScript, host and webviews |
| `npm run test:unit` | Vitest |
| `npm run test:integration` | Mocha in a real Extension Development Host |
| `npm run test:e2e` | Playwright driving a real VS Code window, with screenshots |
| `npm run package` | Build a `.vsix` |

## Settings

| Setting | Default | |
|---|---|---|
| `promptComposer.editor.colors` | `theme` | Your VS Code theme's colours, or `tiptap` |
| `promptComposer.mentions.style` | `icon` | Chip with icon + name, `at` (@name pill) or `plain` |
| `promptComposer.toolbar` | `mid` | `mid`, `full` or `off` |
| `promptComposer.editor.width` | `full` | `full` or `readable` (648px column) |
| `promptComposer.caret` | `smooth` | Gliding caret with VS Code's expand blink, or `native` |
| `promptComposer.lineNumbers` | on | Visual line numbers |
| `promptComposer.panel.show` | `today` | What the panel lists: `today`, `month` (this month by day) or `all` months. Also in the panel's ⋯ menu; search always covers every month |
| `promptComposer.untitledFiles` | `doubleClick` | Turn a tab-bar double-click's Untitled file into a prompt (`always`, `off`) |
| `promptComposer.gitignore` | on | Write `.prompt-composer/.gitignore` |
| `promptComposer.mentions.exclude` | `.git`, `node_modules` | Left out of `@` suggestions, besides `files.exclude` |
| `promptComposer.mentions.maxEntries` | 200000 | Size cap for the `@` index |

Prompt Composer also changes two VS Code **defaults**. Nothing is written to your `settings.json`, and both go away when the extension is disabled:

- `files.exclude` gets `**/.prompt-composer`, which hides the folder. To see it, add `"files.exclude": { "**/.prompt-composer": false }` to your settings.
- `files.readonlyInclude` gets `**/.prompt-composer/**`, so **Open as Text** shows a prompt read-only.
