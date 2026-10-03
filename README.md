# Prompt Composer

Write prompts for Claude Code in VS Code, in a rich Markdown editor, and never manage prompt files yourself.

- **New prompt in one action:** double-click the Prompt Composer panel, or empty space in the tab bar, or click **New Prompt**.
- **A Tiptap editor with everything a prompt needs:**
  - headings, lists, task lists, quotes
  - highlighted code blocks
  - `@` mentions of any file or folder, symlinks included
  - pasted screenshots
  - `/` commands, a bubble menu, moving blocks with Alt+↑/↓
- **A searchable library:** prompts are saved in `.prompt-composer/YYYY-MM/` in your project (git-ignored automatically). The panel lists Pinned prompts and this month by day, and its search covers every month.
- **Plain Markdown on disk**, with `@path` mentions Claude Code understands, and **Copy as Prompt** turns pasted images into `@paths` too.
- **Saving works like any VS Code file:** Ctrl+S, or VS Code's own Auto Save.

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
| `promptComposer.panel.showAllMonths` | off | List older months in the panel (search always covers them) |
| `promptComposer.untitledFiles` | `doubleClick` | Turn a tab-bar double-click's Untitled file into a prompt (`always`, `off`) |
| `promptComposer.gitignore` | on | Write `.prompt-composer/.gitignore` |
| `promptComposer.mentions.exclude` | `.git`, `node_modules` | Left out of `@` suggestions, besides `files.exclude` |
| `promptComposer.mentions.maxEntries` | 200000 | Size cap for the `@` index |
