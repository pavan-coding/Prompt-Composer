# Prompt Composer: implementation plan

This is how the extension described in [PLAN.md](../PLAN.md) is built and tested.
- **What it does:** see PLAN.md.
- **Every test case:** see [TEST-CASES.md](TEST-CASES.md).
- **Trying it yourself in the Extension Development Host:** see [TESTING.md](TESTING.md).

## 1. Decisions taken for development

| Topic | Decision |
|---|---|
| Saving | **Left to the user.** Ctrl+S saves. VS Code's `files.autoSave` (`afterDelay`, `onFocusChange`, `onWindowChange`) is honoured, with folder and `[markdown]` overrides. There's no timer of our own. Unsaved changes show a dot, survive reloads, and closing a changed prompt asks to save. |
| New Prompt shortcut | None by default (the command is in the Command Palette, the panel title bar, and on double-click). |
| Settings | The mockup control-bar choices are the defaults (PLAN §7, Settings). |
| One tab per prompt | Opening an open prompt focuses its tab. A single click in the panel opens a reusable *preview* tab. |
| Pins | Stored in `workspaceState`, not in `.prompt-composer/`. |
| Language | TypeScript, no UI framework. esbuild builds one bundle for the extension host (CommonJS, Node) and one IIFE per webview. |
| Markdown | `marked` lexer → Tiptap JSON. The serializer is our own. Untouched top-level blocks are written back from their original source text, so editing one block changes only that block in the file. |
| Git | Commits go straight to `main` on `github.com/pavan-coding/Prompt-Composer`, one per step, each pushed. |

## 2. Repository layout

```
package.json              extension manifest: commands, menus, views, settings, keybindings
esbuild.mjs               builds dist/extension.js, dist/editor.js, dist/library.js (+ css)
tsconfig.json             strict TypeScript
media/                    fonts (DM Sans, Inter), codicon font + css, Lucide icon css, panel/tab icons
src/
  extension.ts            activate(): wires everything; returns a test API in test mode
  common/
    protocol.ts           message types between host and webviews (shared, type-only)
    markdownText.ts       host-side helpers: title, search text, @tokens, image links, copy-as-prompt
    slug.ts               slugify, file naming, month folder names (pure)
  store/
    promptStore.ts        .prompt-composer/ on disk: list, read, atomic write, trash, .gitignore, watcher
    library.ts            in-memory library (metadata + text of every prompt), search, grouping, pins
  editor/
    promptDocument.ts     one prompt: uri?, created, saved text, draft, dirty, title
    editorManager.ts      webview panels, preview tab, save/close/revert, auto-save modes, drafts backup
    redirectEditor.ts     custom editor for .prompt-composer/*/*.prompt → opens the composer instead
    html.ts               webview HTML with CSP, nonce, asset URIs
  claude/
    claudeEditor.ts       custom editor for Claude Code's Ctrl+G prompt (claude-prompt-*/*.prompt), in its own tab
    claudePaths.ts        rewrites @paths for the folder Claude runs in (pure)
    windowRegistry.ts     ~/.cache/prompt-composer/windows/<pid>: which window is open on which folder
  library/
    libraryView.ts        WebviewViewProvider for the side-bar panel
  untitled/
    untitledSwap.ts       swaps a double-click "Untitled-1" for a new prompt; Ctrl+N wrapper
  mentions/
    fileIndex.ts          workspace walk with symlinks and junctions, watchers, cap
    fuzzy.ts              Quick Open-style matcher and ranking (pure)
    resolve.ts            stat-based lookup of @tokens for a prompt being opened
  images/
    imageStore.ts         paste/drop/pick → .prompt-composer/images/, unique names, cleanup
  status/
    statusBar.ts          mentions / broken / images / words · tokens for the active prompt
  webview/
    editor/               the Tiptap editor (ported from the mockup)
      main.ts, markdown.ts (parse + serialize), extensions/*.ts, ui/*.ts, editor.css
    library/
      main.ts, library.css
test/
  unit/                   Vitest: pure modules (slug, markdown, fuzzy, library search, text helpers)
  integration/            @vscode/test-cli + Mocha inside a real Extension Development Host
  e2e/                    Playwright driving the real VS Code window (Electron), including webviews
  fixtures/               sample workspace (with symlinks/junctions created at setup time)
docs/
  IMPLEMENTATION-PLAN.md  this file
  TEST-CASES.md           every test case, how it's checked, and its result
  TESTING.md              manual test guide for the Extension Development Host (F5)
```

## 3. How the pieces talk

```
                       ┌──────────────────────── extension host (Node) ────────────────────────┐
 Activity Bar ──────►  │ LibraryView ◄──► Library ◄──► PromptStore ◄──► disk: .prompt-composer/ │
 (webview view)        │      ▲              ▲                                                  │
                       │      │              │                                                  │
 Prompt tabs ───────►  │ EditorManager ──► PromptDocument (saved text, draft, dirty)             │
 (webview panels)      │      │                                                                 │
                       │      ├──► FileIndex / resolve (@ picker, chips)                        │
                       │      ├──► ImageStore (.prompt-composer/images/)                        │
                       │      └──► StatusBar                                                    │
                       │ UntitledSwap (tabGroups) ──► EditorManager.newPrompt(group)            │
                       │ RedirectEditor (custom editor) ──► EditorManager.open(uri)             │
                       └────────────────────────────────────────────────────────────────────────┘
```

- **The webview owns the document while it's open.** It parses Markdown into Tiptap and serializes back.
  - It sends `changed` (with the Markdown and title) at most every 150 ms while you type, and at once when the host asks for a `flush`.
  - The host never re-parses Markdown into the editor except on open and revert.
- **The host owns files.** Only the host writes to disk, and only on save: Ctrl+S, auto-save, or Save in the close prompt.
- **Messages are typed** in `src/common/protocol.ts`, so both sides compile against the same shapes.

## 4. Key flows

### New prompt

1. `EditorManager.newPrompt({ viewColumn })` creates a `PromptDocument`:
   - `id`: random
   - `created`: now
   - `uri`: undefined
2. It opens a webview panel titled "Untitled prompt". The webview starts empty, with the caret placed.
3. No file is created. The library adds the unsaved prompt under Today with a dot once it has content.

### Save (Ctrl+S, command, auto-save, close prompt)

1. The host sends `flush`; the webview replies with `{ markdown, title }`. This guarantees the latest keystrokes are included.
2. Where to write:
   - If the document has no `uri` and the Markdown is empty, nothing is written.
   - If it has no `uri` yet, `PromptStore.allocate(created, title)` picks `.prompt-composer/YYYY-MM/DD-HHmm-<slug>.prompt`, unique (`-2`, `-3`…). The first save also creates `.prompt-composer/`, `.gitignore` (when the setting is on) and the month folder.
3. **Atomic write:** write `.<name>.<random>.tmp` in the same folder, then rename it over the target.
4. Then the document records `savedText`, `dirty = false`, the tab icon goes back to the prompt icon, and the library refreshes that entry.

### Dirty state and auto-save

- The first `changed` whose Markdown differs from `savedText` marks the document dirty: tab icon → dot, library row → dot, draft backed up.
- If the Markdown matches `savedText` again (for example after undo), it's clean again.
- `files.autoSave` is read with `workspace.getConfiguration('files', { uri, languageId: 'markdown' })` and re-read on change:
  - `afterDelay`: timer of `files.autoSaveDelay` ms after each change.
  - `onFocusChange`: save when the panel stops being active, or the webview reports `blur`.
  - `onWindowChange`: save when `window.onDidChangeWindowState` reports unfocused (also applies under `onFocusChange`).

### Closing

- `panel.onDidDispose`: if the document is dirty, the host keeps it and queues it for a close prompt.
- A 50 ms window batches several closes (Close All) into one modal:
  - **Save:** saves all queued prompts.
  - **Don't Save:** drops the changes; for never-saved prompts, deletes images added in this session that no saved prompt uses.
  - **Cancel:** reopens each queued prompt with its draft, still dirty.
- An empty never-saved prompt is dropped without asking.
- **Shutdown:** VS Code tears the extension host down without disposing panels the normal way. Drafts survive two ways: in the webview state (restored by the serializer) and in `workspaceState` (`drafts`).

### Restore after reload

- `registerWebviewPanelSerializer('promptComposer.editor')` receives `{ docId, uri, created, draft, dirty }` and rebuilds the document.
- Drafts in `workspaceState` that no panel restored show in the library under their day (or Today) with a dot. Opening one restores the draft.

### Untitled swap (double-click on the tab bar or an empty editor group)

- `workspace.onDidOpenTextDocument` remembers untitled documents opened in the last 1 s.
- `window.tabGroups.onDidChangeTabs` (opened tabs) swaps a tab when all of these hold:
  - the tab is a `TabInputText` with the `untitled` scheme, opened in the last 1 s;
  - the document is empty and not dirty;
  - its language is `plaintext` or `files.defaultLanguage`;
  - the Ctrl+N wrapper didn't flag it;
  - the setting allows it (`doubleClick` or `always`).
- **The swap:** `newPrompt({ viewColumn: tab.group.viewColumn })` first, so the group survives, then `tabGroups.close(tab)`.
- **The Ctrl+N wrapper:** a `ctrl+n` / `cmd+n` keybinding, active when `config.promptComposer.untitledFiles == 'doubleClick'`. It sets `skipNextUntitledUntil = now + 1500` and runs `workbench.action.files.newUntitledFile`.
- Tabs that existed before activation (restored Untitled files) are never looked at.

### Opening a prompt file from the Explorer

- A `CustomReadonlyEditorProvider` (`promptComposer.redirect`), priority `default`, selector `**/.prompt-composer/*/*.prompt`. Prompt files have their own extension so `*.md` editor associations never compete with it; `contributes.languages` maps the same pattern to `markdown` for the read-only text view.
- `resolveCustomEditor` calls `EditorManager.open(uri, { viewColumn })`, then disposes its own panel.
- "Open as Text" uses `vscode.openWith(uri, 'default')`, then `workbench.action.files.setActiveEditorReadonlyInSession`.

### Claude Code's Ctrl+G (v0.2)

```
Claude Code ──Ctrl+G──► claude-prompt-composer <tmp>/claude-prompt-<id>.md        (claude-code/, bash)
                          ├─ copies it to claude-prompt-<id>/Claude - <folder>.prompt, writes .cwd
                          ├─ picks a window from ~/.cache/prompt-composer/windows/
                          └─ code --wait <window folder> <prompt>  ─────►  ClaudeEditorProvider (promptComposer.claude)
                                                                            └─ EditorManager.openClaude(panel)
                                 every `changed` ─► claudeText() ─► write the .prompt
                                 tab closed      ─► last write, then .done
                       ◄── code --wait returns; wait for .done; copy the .prompt back to the .md; exit 0
```

- `ClaudeEditorProvider` is a `CustomReadonlyEditorProvider`, priority `default`, selector `**/claude-prompt-*/*.prompt`. Unlike the redirect it keeps its panel: `EditorManager.openClaude` attaches the prompt to the custom editor's own webview panel, so the tab stays bound to the file and `code --wait` returns when it closes. It's pinned at once (`workbench.action.keepEditor`), because a preview tab would be replaced, and so closed, by the next single-clicked file.
- The prompt is a `PromptDoc` with `claude` set: `dirty` is always false (no dot, no close question, no draft), it's left out of `libraryItems()`, Ctrl+S just writes, Revert goes back to Claude's text (kept in `savedText`), and its images are never cleaned up on close.
- `claudeText()` returns Claude's original text until the editor's Markdown differs from its first report (the baseline), so an untouched prompt round-trips exactly. After that it's `toPromptText()` (images → `@paths`), then `rebaseMentions()` when `.cwd` differs from the workspace folder. Writes are chained so they land in order; a missing folder (helper cancelled) is ignored.
- Without a folder the provider shows a short note instead; closing it leaves Claude's prompt as it was.
- `WindowRegistry` writes `<folder>\n<what code opens>\n` on activation and whenever the window gains focus, and removes it on dispose. It isn't started in test mode.
- The keybindings and editor-title menus that used `activeWebviewPanelId == 'promptComposer.editor'` also accept `activeCustomEditorId == 'promptComposer.claude'`.

### `@` mentions

- **Opening a prompt:** the host extracts the `@tokens` (regex shared with the webview), `lstat`s each one under the workspace folder, and sends `{ token → { kind, exists, link?, via? } }` with the Markdown. The parser uses it:
  - existing paths become chips;
  - path-like tokens that are missing become broken chips;
  - anything else stays text.
- **Picker:** the webview sends `mentionQuery { q, seq }`; the host searches `FileIndex` and returns the top 50 `{ path, name, kind, link?, via? }`.
- **When the index is built:** in the background the first time a prompt opens, then kept current by file watchers. There's one extra watcher per symlinked folder target, because VS Code's recursive watcher doesn't follow links.

### Images

- **Paste and drop:** the webview reads the file bytes and posts `saveImage { name?, bytes, mime, origin }`.
  - The host writes `.prompt-composer/images/<YYYY-MM-DD-HHmmss | original-name>[-n].<ext>` and replies with the relative path `../images/…`.
  - The webview inserts the node at the position recorded when you pasted.
- **Insert Image…:** the host shows `window.showOpenDialog` (image filters) and copies the files in.
- **Display:** webview URIs are built from `asWebviewUri(<prompt dir>)`; the month folder is known even before the first save.
- **Copy as Prompt** rewrites `![alt](../images/x.png)` to `@.prompt-composer/images/x.png`.
- **Delete prompt** offers to delete images that no other prompt references.

## 5. Webview security

- CSP: `default-src 'none'; img-src ${cspSource} data: blob: https:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-…'`.
- `localResourceRoots`:
  - the extension's `dist/` and `media/`
  - the workspace folder (for images and `@` image thumbnails)
- No network access, no `eval`. All assets ship in the extension.

## 6. Testing strategy

The goal: everything that can be checked by a machine is, and the rest is in the manual guide.

| Layer | Tool | What it covers | Command |
|---|---|---|---|
| Unit | Vitest (Node; jsdom where a DOM is needed) | slug and file names, Markdown parse/serialize round trips, title/search text, `@token` extraction, fuzzy ranking and benchmarks, library search/grouping, image naming | `npm run test:unit` |
| Integration | `@vscode/test-cli` + `@vscode/test-electron` (Mocha inside a real Extension Development Host) | commands, storage on disk, save/dirty/auto-save logic, close prompt, drafts, untitled swap via real `newUntitledFile`, redirect editor, index with junctions, image store, Copy as Prompt. The extension returns a test API from `activate()` (only when `ExtensionMode.Test`) so tests can drive webview messages and read state. | `npm run test:integration` |
| End-to-end (UI) | Playwright's Electron driver launching VS Code with `--extensionDevelopmentPath`, the way VS Code's own smoke tests drive it | real clicks and typing inside the webviews (`iframe.webview` → `#active-frame`): new prompt by double-click on the tab bar, typing, `/` and `@` menus, Ctrl+S, close prompt, panel search, context menu, settings applied live, undo/redo, screenshots for visual checks | `npm run test:e2e` |
| Manual | [TESTING.md](TESTING.md) in the Extension Development Host (F5) | look-and-feel judgements, OS clipboard and drag/drop from the OS, Windows scaling | by hand |

**How the AI debugs the extension automatically:** the end-to-end runner launches a real VS Code with the extension loaded, on a temporary copy of the fixture workspace with a fresh user-data folder.
- It drives the window through Playwright and saves a screenshot at every important step to `test-results/`.
- It collects the webview console and the extension host log.
- The AI reads the screenshots and logs, fixes what's wrong and reruns. This replaces pressing F5 and clicking around.

**Test-case bookkeeping:** every case in [TEST-CASES.md](TEST-CASES.md) has an ID (e.g. `SV-06`), the layer that checks it, and a result column. Automated tests carry the ID in their name, so a failure points straight at the case.

## 7. Build order (one commit each, pushed to main)

1. **docs:** updated plan, implementation plan, test cases; the mockup as the UI reference.
2. **scaffold:** `package.json` manifest, esbuild, TypeScript, Vitest, launch configs, media assets, an empty panel and editor that load.
3. **storage:** slug and naming, `PromptStore` (list, atomic write, `.gitignore`, trash, watcher), unit tests.
4. **markdown:** parser and serializer with the source-preserving round trip, unit tests.
5. **editor:** the Tiptap editor ported from the mockup (toolbar, bubble menu, `/`, code blocks, move blocks, drag handle, caret, line numbers, hover, Ctrl+click), with settings applied live.
6. **documents and saving:** `EditorManager`, dirty state, Ctrl+S, auto-save modes, close prompt, drafts, serializer restore, revert.
7. **library panel:** grouping, search, months setting, pins, context menu, preview tab, welcome.
8. **untitled swap and redirect editor**, plus Open as Text.
9. **mentions:** file index with symlinks and junctions, watchers, picker, chips, resolve on open, broken count in the status bar.
10. **images:** paste, drop, picker, display, Copy as Prompt, cleanup.
11. **integration tests** for everything above.
12. **end-to-end tests** with screenshots, plus fixes from what they find.
13. **docs:** TESTING.md, README, final TEST-CASES results.
14. **package:** `.vsix` build check (`vsce package`).

## 8. Definition of done

- `npm run build`, `npm run test:unit`, `npm run test:integration` and `npm run test:e2e` all pass on Windows.
- Every test case in TEST-CASES.md is marked with its result. Anything manual-only says so.
- `npm run package` produces a `.vsix` that installs and runs.
- TESTING.md lets you check every feature by hand in the Extension Development Host.
