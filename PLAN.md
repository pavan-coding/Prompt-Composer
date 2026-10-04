# Prompt Composer: plan

Status: approved for development · 2026-10-03. The build steps, test plan and test cases are in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) and [docs/TEST-CASES.md](docs/TEST-CASES.md).

## 1. What it is

Prompt Composer is a VS Code extension for writing prompts for Claude Code without leaving VS Code, and without managing files.

You never create or open a prompt file yourself.
- **Starting a prompt:** you click **New Prompt** or double-click the Prompt Composer panel (or empty space in the tab bar), and a rich (WYSIWYG) editor opens, ready to type.
- **Saving:** you save the way you save any file in VS Code (Ctrl+S, or VS Code's own Auto Save if you turned it on). The file name and folder are chosen for you: the prompt goes into the extension's own folder, `.prompt-composer/`, sorted by month and day.
- **Finding a prompt later:** the panel in the Primary Side Bar lists your prompts by month and day, and searches the text inside them.

The editor is built on Tiptap. It adds `@` mentions for files and folders (symlink-aware), `/` commands, images, code highlighting and VS Code-style editing. The prompt is plain Markdown underneath, so Claude Code can read it directly.

### Ground rules

- **Prompts only.** The extension stores what you write. It never captures AI conversations or agent output.
- **Only its own folder.** Prompt Composer reads and writes only inside `.prompt-composer/`. Nothing else in your project is touched.
- **Nobody else writes there.** No AI agent writes into `.prompt-composer/`. Prompt files are written only by Prompt Composer, which keeps saving and undo simple (§4, F4).

### Goals

- Start a prompt in one action, and never think about files or saving.
- Find any old prompt quickly: by date, or by searching its text.
- Write prompts as rendered Markdown, with `@` mentions for any workspace file or folder (including symlinks), images and code.
- Be fast: the editor opens instantly, and search and `@` results feel instant.

### Non-goals (keep it small)

These are out of scope:

- capturing AI chat or agent history
- vaults or notes systems; backlinks, graph view
- sync or publishing; PDF export
- a plugin system; its own themes
- AI chat inside the editor
- tables, math and diagrams (not in v1)

If a feature isn't needed to compose and find prompts, it's out.

---

## 2. How it fits into VS Code (platform decisions)

| Decision | Choice | Why |
|---|---|---|
| Where prompts live | `.prompt-composer/` in the folder VS Code is opened on (§4, F0) | VS Code is always opened on one project folder; multi-root workspaces aren't supported. The folder sits next to the code the prompts are about, so `@paths` and images resolve. It's created on first use. If no folder is open, the panel says "Open a folder to use Prompt Composer". |
| Keeping it out of git | Prompt Composer writes `.prompt-composer/.gitignore` containing `*` | That one file makes git ignore the whole folder, itself included. Your project's own `.gitignore` is never edited, so there's no diff and no merge conflict. A setting can switch this off for teams that want to commit prompts. |
| Keeping it out of sight in VS Code | The extension contributes a default `files.exclude` entry, `**/.prompt-composer` (`contributes.configurationDefaults`) | VS Code hides the folder in the Explorer, Search and Quick Open, and nothing is written to your `settings.json`. VS Code merges it with its own defaults and with any `files.exclude` you set yourself, and drops it when the extension is disabled or uninstalled. To see the folder anyway, set `"files.exclude": { "**/.prompt-composer": false }`. The panel is how you browse prompts. |
| The panel | Its own icon in the Activity Bar, opening a **webview view** in the Primary Side Bar | A webview gives an inline search box and grouped, rich rows. It's styled with VS Code's own colours and codicons, so it looks native. |
| Panel title buttons | New Prompt, Collapse All, More (native `view/title` menu) | These are standard VS Code view buttons. |
| Right-click menu in the panel | VS Code's real context menu, via the `webview/context` menu and `data-vscode-context` | Native menus, keyboard support and theming, without drawing our own. |
| The prompt editor | One **webview panel** per open prompt, not a custom text editor | **The tab shows the prompt's title** (a custom editor tab can only show the file name). **Undo is Tiptap's alone**, with no clash with VS Code's document undo. **Saving is left to the user**, the same as any VS Code file: Ctrl+S, plus VS Code's own `files.autoSave` setting when it's on (§4, F0 "Saving"). Webview panels have no built-in dirty state, so the extension supplies it: a dot on the tab, a save prompt when a changed prompt is closed, and unsaved changes that survive a reload. Open prompts come back after a restart (`registerWebviewPanelSerializer`). |
| Prompt file type | `.prompt`, with Markdown inside | Prompts don't end in `.md`, so anything set up for Markdown leaves them alone: a `*.md` editor association (such as a notes editor made the default for `.md`), Markdown linters and spell checkers, notes apps that collect `.md` files. Inside its own folder, Prompt Composer registers `.prompt` as Markdown, so **Open as text** still highlights it. Claude Code reads an `@….prompt` path like any text file. `.md` files in the folder aren't prompts. |
| Opening a prompt file directly | A custom editor registered only for `.prompt-composer/*/*.prompt` (month folders, one level) that hands the file to the prompt editor | Opening a prompt file any other way (a link, File → Open, the Explorer if you un-hide the folder) still opens the composer. Nothing else in your project is affected. |
| Look and feel | **Layout and type from Tiptap; colours from your VS Code theme.** Tiptap's Simple Editor gives the layout: DM Sans for text, Inter for menus, Lucide line icons, the 648px column and the spacing. Every colour comes from the active VS Code theme (`--vscode-*` variables), so with Dark Modern you get exactly Dark Modern. An optional setting switches to Tiptap's own palette. | It looks like the Tiptap you've seen online, but blends in with VS Code and any theme. Fonts and icons ship inside the extension (~125 KB of fonts), so it works offline and under the webview's strict security rules. |
| Floating surfaces | The toolbar, bubble menu, `/` menu, `@` picker and hover card are lifted off the page using only theme colours. Their fill is the theme's widget colour mixed 10% toward the text colour (Dark Modern: `#313131` on a `#1F1F1F` editor). They also get the theme's widget border (`rgba(204,204,204,0.2)`) and widget shadow. Light themes keep the light widget fill and rely on border and shadow. | Dark Modern's own widget colour (`#202020`) is almost identical to its editor (`#1F1F1F`), so a menu painted with it disappears. |
| Heading colours | A muted tint of the theme's link colour, fading toward the text colour by level: H1 55%, H2 40%, H3–H6 25% link colour (Dark Modern: `#86B9E6`, `#99BEDF`, `#ACC4D8`; Light Modern: `#1B4F80`, `#23496D`, `#2C445A`) | Headings stand out without the page getting colourful, and they follow any theme. With the `tiptap` colours setting, headings keep Tiptap's plain text colour. |
| Prefer native VS Code UI | Use title-bar buttons, status bar items, quick input, notifications, native context menus and native file pickers | Less webview UI means less to build, a smaller bundle and a familiar feel. |
| Where work runs | The extension host does the file index, symlinks, prompt storage, search and image saving. The webviews only render and edit. | Keeps webviews light. One index is shared by everything. |
| Platforms | Desktop VS Code on Windows, macOS and Linux, including Remote-SSH and WSL. Not vscode.dev in v1. | Symlink handling needs a real file system. |
| Distribution | VS Code Marketplace and Open VSX | Open VSX is needed for Cursor, Windsurf and VSCodium. |

---

## 3. Language and performance

**Recommendation: TypeScript everywhere, no UI framework in the webviews (plain TS plus Tiptap), bundled with esbuild.**

- VS Code runs only JavaScript, both in the extension host and in webviews, and Tiptap is JavaScript. TypeScript is the only native fit; anything else would need compiling to JS or running as a separate process.
- **A Rust or Go sidecar isn't worth it.** The heavy jobs are walking the file tree and searching prompt text, and both are limited by disk speed, where Node's `fs` is already close to native. A native binary also means shipping one build per OS and CPU.
- **WASM stays an option for one thing only:** the fuzzy matcher, if profiling on a huge repo shows it's slow.
- **What actually makes it fast:**
  - small webview bundles (no React)
  - activation only when the panel or a prompt opens
  - indexes built once and updated incrementally
  - sending only the results a view shows over `postMessage`
  - no disk writes while typing: the file is written only when you save (or when VS Code's Auto Save says so)

### Performance targets (tested against, not assumed)

| What | Target |
|---|---|
| New Prompt → ready to type | Under 200 ms |
| Open a 1,000-line prompt | Editor usable in under 300 ms |
| Panel search after a keystroke | Under 30 ms with 5,000 prompts |
| `@` results after a keystroke | Under 30 ms with 100k files indexed |
| First index of 50k files | Under 2 s, in the background, never blocks typing |
| Typing | No dropped frames; changes reach the extension host in batches, never one message per keystroke |
| Webview bundle | Size tracked on every build; no framework. Measured with the mockup's bundle (Tiptap, StarterKit, mention, image, task list, bubble menu, `/` commands, plus lowlight with 37 languages): **648 KB minified, 199 KB gzipped**. Highlighting accounts for about 55 KB gzipped of that. It loads from local disk, never the network. |

---

## 4. Features (v1)

### F0. The prompt library (the main workflow)

**Storage layout.** Everything lives in one folder inside the opened project folder, created automatically the first time you make a prompt. It is only **one level deep**: a `.gitignore`, one flat `images/` folder, and one folder per month.

```
my-app/                                   ← the folder VS Code is opened on
  .prompt-composer/
    .gitignore                            ← contains "*": git ignores this whole folder
    images/
      2026-10-03-141602.png               ← pasted image: full date and time in the name (the folder is flat)
      login-bug.png                       ← dropped file keeps its name
    2026-10/
      03-1415-refactor-auth-token-refresh.prompt
      03-0902-add-rate-limit-to-login.prompt
      01-1120-explain-the-config-loading-order.prompt
    2026-09/
      …
```

- **Processing reads one level only.** The extension lists `.prompt-composer/`, then the `.prompt` files directly inside each `YYYY-MM` folder, and nothing deeper.
  - Anything placed deeper, or folders not named `YYYY-MM`, are ignored.
  - The file watcher uses the same shape (`.prompt-composer/*/*.prompt`), so it stays cheap.
- **Month folders** keep any single folder small, even after years of prompts.
- **File names** are `DD-HHmm-<title>.prompt`, so they sort by day and time on their own.
  - A new prompt has **no file** until its first save. `DD-HHmm` is when you created the prompt, and the month folder is that month.
  - The first save names it `DD-HHmm-<title-slug>.prompt`. It's never renamed after that: the tab shows the live title, so the file name doesn't need to keep up.
  - The slug keeps letters and digits from any language, in lower case, with `-` between words, up to 48 characters.
  - Two prompts in the same minute with the same title get `-2`, `-3`…; nothing is ever overwritten.
- **The title** is the prompt's first heading or first line, and "Untitled prompt" while it's empty.

**Creating a prompt** (all of these open the editor with the caret ready):

- Double-click empty space in the Prompt Composer panel.
- The **New Prompt** button in the panel's title bar.
- "Prompt Composer: New Prompt" in the Command Palette. There is **no default keyboard shortcut**; you can assign one in Keyboard Shortcuts.
- **Double-click empty space in the tab bar, or in an empty editor area.** This uses a workaround, because VS Code doesn't let extensions change that double-click directly:
  - **What VS Code does:** the double-click doesn't run a command. VS Code opens an empty "Untitled" text file and forces the plain text editor, so no setting, keybinding or editor association can change it. (Checked in VS Code's source: `multiEditorTabsControl.ts` and `editorGroupView.ts`.)
  - **What we do:** the extension watches for a brand-new, empty, plain-text Untitled tab (`window.tabGroups.onDidChangeTabs`). It closes that tab and opens a new prompt in the same editor group. Closing an empty Untitled file never asks to save, so the user just sees a prompt appear.
  - **The catch:** extensions can't tell that double-click apart from Ctrl+N or File → New Text File, because all three make the same empty Untitled file. So the extension also takes over the **Ctrl+N** shortcut: it marks the next Untitled file as a real text file, then runs VS Code's normal New Text File.
  - **Result:**
    - Double-click (tab bar or empty editor area) gives a new prompt.
    - Ctrl+N still gives a text file.
    - File → New Text File from the menu bar also turns into a prompt, because the extension can't wrap VS Code's own menu items.
  - **Setting** `promptComposer.untitledFiles`:
    - `"doubleClick"` (default): as above.
    - `"always"`: every new empty Untitled file becomes a prompt, including Ctrl+N.
    - `"off"`: leave VS Code alone.
  - Untitled files that already have content, a language, or come from other extensions are never touched.

**Saving (left to the user, like any VS Code file):**

- **Ctrl+S** (Cmd+S on macOS) saves the prompt. "Prompt Composer: Save Prompt" in the Command Palette does the same.
- **VS Code's own Auto Save is honoured.** If `files.autoSave` is on, prompts follow it exactly as text files do. That includes folder and `[markdown]` overrides.
  - `afterDelay`: saves `files.autoSaveDelay` ms after the last change.
  - `onFocusChange`: saves when focus leaves the prompt.
  - `onWindowChange`: saves when the VS Code window loses focus.
  - `off` (VS Code's default): nothing is written until you save.
  - Unlike VS Code's Untitled files, a new prompt *is* auto-saved, because it already knows its file name.
- **Unsaved changes are visible.** The tab shows a filled dot as its icon, and the prompt's row in the panel shows a dot. Webview tabs can't show VS Code's own dot in the close button, so the icon takes its place.
- **Closing a changed prompt asks first:** "Do you want to save the changes you made to "Title"?" with **Save** and **Don't Save**. Cancelling (Esc) reopens the prompt with your changes.
  - VS Code gives extensions no way to stop a webview tab from closing, so the question comes right after the tab closes. The changes are kept in memory until you answer.
  - Closing several changed prompts at once (Close All) asks once for all of them.
- **A new prompt that's still empty when closed is discarded silently**, so empty files never pile up.
- **Unsaved changes survive a reload or restart.** The open tab comes back still marked as changed, like VS Code's hot exit. They are also backed up in the extension's workspace storage, so they aren't lost even if the tab isn't restored. A backed-up prompt shows in the panel with its dot.
- **Revert:** "Prompt Composer: Revert Prompt" throws away unsaved changes and reloads the file.
- Deleting a prompt moves it to the OS Recycle Bin / Trash (`workspace.fs.delete` with `useTrash`), so it can be restored.

**The panel** (Primary Side Bar):

- **Search box at the top.** It searches titles *and* the text inside prompts, including `@paths`; for example, searching `routes.ts` finds every prompt that mentions it. Results show:
  - the number of prompts found
  - each matching prompt
  - under it, the matching line with the match highlighted, like VS Code's Search view
  - Enter opens the first result; Esc clears the search.
- **By default the panel shows only two things:**
  - **Pinned**, a separate group at the top, for prompts you keep coming back to (from any month).
  - **Today**: today's prompts as one group, newest first, each showing its title and time.
- **You choose how far back the panel lists**, in its **⋯** menu (setting `promptComposer.panel.show`):
  - **Show Today Only** (`today`, the default): Pinned and Today.
  - **Show This Month** (`month`): the current month by day: Today, Yesterday, then "Wed, Oct 1".
  - **Show All Months** (`all`): every month (October 2026, September 2026…), each with a count badge. Older months start folded.
  - Extensions can't put a check mark on menu items, so the menu lists the two choices not in use.
  - When prompts are left out, a quiet line at the bottom says so ("Earlier prompts are hidden. Search finds every prompt.") with **Show this month** / **Show all months** links.
- **Search always covers every month**, whatever the panel shows. Results appear grouped under their month.
- Collapse All is in the title bar, and fold state is remembered.
- Until you write a prompt today (or this month, when showing months), a quiet row says "No prompts yet today" / "No prompts yet this month".
- **The open prompt is highlighted**, with a dot while it has unsaved changes. A new prompt that hasn't been saved yet shows under Today with its dot.
- **Click** opens a prompt as a *preview*, like VS Code's single-click in the Explorer. Clicking another prompt replaces the preview, so browsing doesn't pile up tabs. Typing in it, or double-clicking its row, makes it a normal tab. **Double-click** also puts the caret in it.
- **Each prompt opens in one tab.** Opening a prompt that's already open focuses its tab.
- **Pins** are stored in VS Code's workspace storage for this folder, so `.prompt-composer/` holds only prompts and images.
- **Right-click** gives VS Code's native menu:
  - Open, Open to the Side
  - Copy as Prompt, Copy @Path for Claude
  - Pin / Unpin, Duplicate, Reveal in File Explorer (Reveal in Finder on macOS). VS Code's own Explorer can't show the folder, so this opens your system's file manager with the file selected.
  - Delete
- **When there are no prompts yet**, a welcome message and a New Prompt button show.

**VS Code doesn't show `.prompt-composer/`** in the Explorer, Search or Quick Open (§2, "Keeping it out of sight"). The `@` picker never offers files from it. The panel's ⋯ menu has **Reveal Prompts Folder in File Explorer**, which opens your system's file manager inside the folder.

**Free extras from VS Code:**

- **Version history (limitation):** VS Code's **Local History** only records saves made through VS Code's own editors. Prompt Composer writes files directly (atomically), so the Timeline doesn't list prompt saves (`SV-14`).
- **VS Code's Search** leaves the folder out (it follows `files.exclude`), so prompts don't clutter code searches. The panel's search is the place to find them.

### F1. Markdown editing (Tiptap)

**Supported blocks and formatting:**

- headings 1 to 3 and paragraphs
- bold, italic, strikethrough, inline code and links
- bullet, numbered and task lists, including nested lists
  - Task checkboxes are rounded squares with a transparent fill. When checked, they turn solid strong blue with a white tick.
  - They stay sharp at Windows display scaling (125%, 150%), because their size and border are set in whole physical pixels:
    - The box is 16px, which is a whole number of screen pixels at 100/125/150/200%.
    - The border is exactly 2 screen pixels, recalculated when the scale changes, in a solid (not see-through) colour.
    - The tick fills the whole box, so it never sits between pixels.
    - Same rule for any other thin-lined control we draw.
- blockquotes
- code blocks with syntax highlighting and a language picker (see below)
- horizontal rules, images and line breaks

**Colours follow the VS Code theme.** These are the values in Dark Modern, matching VS Code's own Markdown preview. They were checked against the real thing: vscode.dev running Dark Modern, reading the `--vscode-*` values it applies (2026-10-03). For example, the suggest, hover and widget borders are `rgba(204,204,204,0.2)`, menus `#454545`, line numbers `#6E7681` (active `#CCCCCC`), quick input `#222222`.

| Element | Theme variable | Dark Modern value |
|---|---|---|
| Page | `editor.background` / `editor.foreground` | `#1F1F1F` / `#CCCCCC` |
| Code block | `textCodeBlock.background`, with a `widget.border` border | `#2B2B2B`, border `#313131` |
| Inline code | `textPreformat.background` / `textPreformat.foreground` | `#3C3C3C` / `#D0D0D0` |
| Quote | `textBlockQuote.background` and `textBlockQuote.border` | `#2B2B2B`, bar `#616161` |
| Links and mentions | `textLink.foreground` | `#4daafc` |
| Checkboxes | `button.background` | `#0078D4` |
| Scrollbars | `scrollbarSlider.background` / `.hoverBackground` / `.activeBackground` | rounded pill thumbs inset in a transparent track (page, menus, wide code blocks). VS Code's own panels keep VS Code's square scrollbars, which extensions can't restyle. |

**Spacing.** Headings use a compact line height (1.3× their text). There's a clear gap above a heading and the heading sits close to what it introduces:

| Between | Gap |
|---|---|
| Heading → content under it | 6px |
| Content → next heading (H1, H2) | 24px (H3: 18px) |
| Paragraph → paragraph (pressing Enter) | 2px, so a new line reads like the next line, not a new section |
| List, image, code block, quote → neighbours | 12px |
| Around a divider | 36px |

More space is the user's choice: press Enter again. Empty lines are kept in the file (rule 3 under "Rules for the file on disk").

**Syntax highlighting in code blocks.** I compared four libraries, measured by bundling each one:

| Option | Engine | Added size (gzipped) | Notes |
|---|---|---|---|
| **`@tiptap/extension-code-block-lowlight` + lowlight** (chosen) | highlight.js | ~9 KB extension + 53 KB for 37 common languages (16 KB for a hand-picked 14) | Official Tiptap extension. Synchronous, so there's no flash of uncoloured code. It colours by CSS class, so colours come from our stylesheet and follow the theme. |
| Shiki (community `tiptap-extension-code-block-shiki`) | VS Code's own TextMate grammars | 35 KB core + ~107 KB for 14 languages and 2 themes (142 KB total) | Pixel-identical to VS Code, but 2–3× bigger and asynchronous (code shows briefly uncoloured while grammars load). It needs its JS regex engine, because the WASM engine requires loosening the webview's security policy. It's also not an official Tiptap extension. |
| `prosemirror-highlight` | adapter for Shiki, lowlight, Prism or Lezer | depends on engine | Generic ProseMirror plugin; useful only if we switch engines later. |
| sugar-high | tiny tokenizer | 11 KB | JS/TS-like languages only; Python, Bash and others come out poorly. |

- **Colours** use VS Code's Dark+ / Light+ token colours, which Dark Modern and Light Modern inherit. Keywords are `#569CD6`, flow-control words (`if`, `return`, `await`, `import`…) `#C586C0`, strings `#CE9178`, comments `#6A9955`, numbers `#B5CEA8`, functions `#DCDCAA`, types `#4EC9B0`, variables `#9CDCFE`. highlight.js doesn't separate flow-control words from other keywords, so we tag those ourselves to match.
- **No auto-detection.** A block without a language is plain text. Auto-detecting is slow on every keystroke and often wrong.
- **Language picker** in the block's top-right corner. It lists 22 common languages and writes the chosen one into the code fence (e.g. ` ```python `). Short names like `ts`, `sh` and `py` are understood.
- If you later want exact VS Code highlighting, Shiki can replace lowlight behind the same code-block node, at the size cost above.

**Moving lines and blocks up and down:**

- **Alt+↑ / Alt+↓** moves the current block up or down, the same keys as VS Code's "Move Line Up/Down". A block is a paragraph, heading, code block, quote or image; inside a list it's the list item. The caret moves with it.
- **Drag handle (⋮⋮)**: a dotted grip appears in the left margin next to whatever block the mouse is over. It has no background box; only the dots brighten on hover. Drag it to move the block anywhere; a drop line shows where it will land.
- **Click the grip** for a small menu: Move up, Move down, Duplicate, Delete.
- **Why not Tiptap's official drag handle?** `@tiptap/extension-drag-handle` is MIT-licensed, but it requires Tiptap's collaboration and Yjs packages, which we don't use. A small custom handle using ProseMirror's built-in block dragging avoids that weight.

**Typing:**

- Markdown shortcuts work as you type: `# `, `- `, `1. `, `[ ] `, a code fence, `> `, `**bold**`, `` `code` ``.
- **Toolbar**, styled like Tiptap's Simple Editor and pinned to the top. By default it's a centered, rounded bar about as wide as its buttons ("mid"); a full-width strip is the alternative. When the editor is narrow, buttons wrap onto a second line instead of showing a scrollbar. The toolbar has:
  - a heading dropdown and a list dropdown; each button shows the current block type
  - quote and code block
  - bold, italic, strike, inline code and link
  - `@` mention and add image
  - Tiptap features that Markdown can't save (underline, highlight, text alignment, superscript, subscript) are left out on purpose.
  - There are no undo/redo buttons: Ctrl+Z and Ctrl+Y (Cmd on macOS) do that.
- **Bubble menu** (Tiptap `BubbleMenu`): appears above selected text.
  - Bold, italic, strike, inline code, link.
  - Turn into heading, turn into list, clear formatting.
  - Hidden inside code blocks.
- **`/` commands** (built on Tiptap's `Suggestion` plugin, the same engine as `@`). Type `/` at the start of a line or after a space.
  - It lists: text, headings 1 to 3, bullet, numbered and task lists, quote, code block, divider, file/folder (switches to the `@` picker) and image.
  - Typing filters by name or keyword (`/h2`, `/todo`, `/code`, `/img`). ↑↓ moves, Enter or Tab runs, Esc closes.
  - The typed `/query` is removed when a command runs.
  - It doesn't trigger inside code blocks, or mid-word (so paths like `src/a` are safe).
  - Each item shows its Markdown shortcut, so the menu also teaches the shortcuts.
- **No `+` button and no per-line hint.** Empty lines stay clean. A hint ("Type / for commands, @ to mention a file") shows only when the whole document is empty.
- **No highlight while typing `@` or `/`.** What you type looks like normal text until a chip is inserted.
- **Smooth caret**, like VS Code's "Smooth Caret Animation" with "expand" blinking:
  - The browser's caret is hidden and a drawn one is used instead.
  - It glides to each new position (click, arrow keys, typing) over about 100 ms with an ease-out curve.
  - It eases its height when moving between a heading and body text.
  - It stays solid while you type. Then it blinks by shrinking from top and bottom into its middle and growing back out (VS Code's `editor.cursorBlinking: "expand"`) instead of switching on and off.
  - The extension reads your `editor.cursorBlinking` setting (blink, smooth, phase, expand, solid) and uses expand when it's unset.
  - Width is 2 physical pixels and colour is the theme's `editorCursor.foreground` (`#AEAFAD` in Dark Modern). It snaps to whole pixels, so it's crisp at 125% scaling.
  - On by default through the `promptComposer.caret` setting (`"smooth"`); `"native"` gives the normal browser caret.
  - It deliberately ignores the OS "reduce motion" hint. Windows sets that whenever Animation effects is off, which would silently disable a feature you turned on.
- **Line numbers**, toggled with the `promptComposer.lineNumbers` setting (on by default):
  - The gutter simply counts the lines you see, 1, 2, 3… with no gaps.
  - A paragraph that wraps onto two lines takes two numbers. Empty lines count, each code line counts, and an image or divider counts as one.
  - Numbers re-flow when the column width changes, like a word processor's line numbering.
  - These are display line counts, not the file's line numbers ("Open as text" shows those).
  - The current line's number is highlighted (`editorLineNumber.activeForeground`); the others use `editorLineNumber.foreground`.
  - The column widens to make room for the gutter, and the drag handle sits between the numbers and the text.
- The toolbar can be turned off (`promptComposer.toolbar`: `"mid"`, `"full"`, `"off"`); the bubble menu and `/` commands are always there.
- **Copying from the editor gives Markdown.** Selected text copies as Markdown, with `@paths`, as plain text, so pasting into the Claude Code terminal keeps the structure. Pasting Markdown text into the editor turns it into formatted content.
- Link URLs are entered in VS Code's native quick input.
- **Ctrl/Cmd+click follows, like VS Code.**
  - Web links open in the browser (`vscode.env.openExternal`). Links to workspace files open in a VS Code tab.
  - Chips open their file, or reveal their folder in the Explorer.
  - Hovering a link shows its URL and "Follow link (Ctrl + click)".
  - ProseMirror's own Ctrl+click behaviour (select the whole block and draw a box around it) is turned off.

**Unknown syntax is never lost.**
- Front matter, tables, link definitions and footnotes stay byte-for-byte as an editable "raw" block.
- HTML and XML-style blocks (`<instructions>` … `</instructions>`, common in prompts) are plain text lines, edited and saved exactly as typed.
- Line breaks inside a paragraph are written as plain new lines, not backslashes.
- Escaping is added only when a line would otherwise read back differently, so prompts stay readable for Claude.

**Rules for the file on disk:**

1. Opening a prompt never changes its file. Only real edits write.
2. Output is deterministic: the same document always produces the same text.
3. **Any number of blank lines is kept.** Blocks are separated by one blank line, and every empty line you add becomes one more blank line in the file. Reading the file back turns N blank lines into N−1 empty lines, so spacing survives save and reopen. Only empty lines at the very end of the document aren't written.
4. Writes are atomic (write to a temporary file, then rename), so a crash mid-save can't leave half a prompt.

### F2. `@` mentions (files and folders, symlink-aware)

**Opening the picker.** Typing `@` at the start of a line, or after a space or `(`, opens the picker. Email addresses like `a@b.com` don't trigger it.

**What it lists.** Every file and folder in every workspace folder, including:

- symlinked files
- symlinked folders
- everything inside symlinked folders

It excludes `.git`, `node_modules`, VS Code's `files.exclude`, and Prompt Composer's own `.prompt-composer/` folder. The exclude list is a setting.

**Each row shows:**

- an icon for file, folder, symlinked file or symlinked folder
- the name on the first line, with matched letters highlighted
- on the second line, dimmed: the item's **full workspace path**, exactly what will be saved, e.g. `src/server/index.ts`
- for a symlink, its target after an arrow, e.g. `src/config/ → ../../infra/config`; anything inside a symlinked folder gets a small link icon

**Ranking:**

- An empty query shows recently opened files first.
- Otherwise it fuzzy-matches the name first, then the full path.

**Keys:**

- ↑↓ move through the list.
- Enter inserts the selected item.
- Tab on a folder drills into it, so `@src/` lists what's inside `src`.
- Esc closes the picker.

**In the editor (preview):**

- A chip shows **only the file or folder name**: `auth.ts`, `config`. There's no path, no parent folder and no trailing slash, even when two files share a name.
- Style: a pill in the theme's link colour with the file or folder **icon + name** (default). The `promptComposer.mentions.style` setting also offers `"at"` (an `@name` pill) and `"plain"` (`@name` text with no pill).
- Pills are inline text boxes that fit inside the line, so chips on stacked lines never touch, and a line with chips is the same height as one without.
- The full path appears in three places only: the `@` suggestion list (while choosing), the file on disk, and the hover card.

**Interacting with a chip:**

- Hovering shows the full path, the symlink target if any, and an "open" hint.
- Ctrl/Cmd+click opens the file, or reveals a folder in the Explorer.

**On disk:** the full workspace-relative path, e.g. `@src/server/auth.ts` or `@src/config/`. This is the syntax Claude Code already uses, so the prompt works as-is.

**Symlinks:** the stored path is the link's path as it appears in the workspace, never the resolved target, because that's what Claude Code sees.

**Reading a prompt back:**

- `@path` tokens that match the index become chips.
- Tokens that look like paths but don't exist become **broken** chips, shown in warning style.
- Other tokens, like `@team`, stay plain text.
- Nothing inside code spans or code blocks is converted.

**How the index works (extension host):**

- **Walking:** it walks each workspace folder, using `lstat` and `readlink` for symlinks, and follows symlinked folders.
- **Cycles:** it skips any folder whose real path is already on the current branch of the walk.
- **Broken symlinks:** they're still listed, but marked as broken.
- **When it's built:** the first time a prompt opens, never at VS Code startup. One index is shared by all prompt tabs.
- **Updates:** file watchers keep it current. VS Code's recursive watcher doesn't follow symlinked folders, so we add one watcher per symlink target.
- **Size cap:** a hard limit, e.g. 200k entries, with a warning. That way a symlink to `/` can't hang anything.
- **Search:** the webview sends the query, and the host returns the top 50 results. It's one fast round trip per keystroke, and the webview never holds the whole tree.

### F3. Images

- **Adding images:**
  - paste from the clipboard
  - drag and drop
  - an "Insert image…" command that opens the native file picker
- **Where they're saved:** the one flat `.prompt-composer/images/` folder.
  - Pasted images are named `YYYY-MM-DD-HHmmss.png`. The full date is in the name because the folder has no month subfolders.
  - Dropped files keep their own name.
  - Nothing is ever overwritten; we add `-1`, `-2` and so on.
- **On disk:** a standard Markdown image, relative to the prompt file: `![alt](../images/2026-10-03-141602.png)`.
- **"Copy as prompt"** turns each image into a workspace path Claude Code can attach: `@.prompt-composer/images/2026-10-03-141602.png`.
- **In the editor:**
  - Images render inline, at most the width of the column.
  - Hovering shows the image's path.
  - Clicking selects the image, and Delete removes it from the prompt.
  - Double-clicking opens it full size in VS Code's image viewer.
- **Cleanup:** deleting a prompt offers to also delete images that no other prompt uses.
- **Security:** the webview may only load files from allowed roots: the workspace folders, the symlink targets and `.prompt-composer/`.
- **No resizing in v1.** Markdown can't store an image size without raw HTML.

### F4. Living with the files

Only Prompt Composer writes into `.prompt-composer/`, which keeps this simple:

- **No live sync with outside edits** is needed for prompts: no agent or other tool edits them.
- **Undo/redo belongs to Tiptap** inside the prompt editor. With no VS Code text document in between, there's one undo stack and nothing to reconcile.
- **"Open as text"** (editor-title button) opens the prompt's `.prompt` file in VS Code's normal text editor, read-only and highlighted as Markdown, so there are never two writers. Prompt files are read-only in text editors through a contributed `files.readonlyInclude` default for `**/.prompt-composer/**`; the extension's own saves aren't affected.
- **A small file watcher on `.prompt-composer/`** only notices files deleted or moved by hand in the Explorer, and updates the panel.
- **One tab per prompt.** Opening a prompt that's already open focuses its tab, and "Open to the Side" moves that tab to the side group. Two live copies of one prompt would need a sync engine for little gain.

---

## 5. Suggested extras (my ideas, you decide)

| # | Feature | Why | My take |
|---|---|---|---|
| S1 | **Copy as prompt** (editor-title button and right-click in the panel) | Copies the Markdown ready to paste into Claude Code, with images turned into `@paths` so Claude Code attaches them | v1 |
| S2 | **Broken-mention warnings** | Flags `@paths` that no longer exist; the count shows in the status bar and clicking it jumps to the first one | v1 (the index already exists) |
| S3 | **Image preview on hover** | Hovering an `@screenshot.png` mention shows a thumbnail | v1 (cheap) |
| S4 | **New prompt** command and panel | | **Done: now F0** |
| S5 | **Add selection to prompt** | Right-click in any code editor to insert `@file#L10-20` into the open prompt | v1.1; confirm Claude Code's exact line-range syntax first |
| S6 | **Rename-aware mentions** | When you rename or move a file in VS Code, `@paths` in saved prompts update too | v1.1 |
| S7 | **Token estimate** in the status bar | A rough size of the prompt (words and ~tokens = characters ÷ 4) | v1 (cheap, already in the mockup) |
| S8 | **Send to Claude Code terminal** | Pastes the prompt into a running `claude` terminal | Later; needs a test of multi-line paste first |
| S9 | `/` block menu | | **Done: now part of F1** |
| S10 | **Use as template** | Right-click a pinned prompt → "New from this", which starts a new prompt with its content (the idea behind PromptDock's presets) | v1.1 (small) |
| S11 | **"Copied" marker** | Prompts you've copied out get a small check and the time, so you can see which drafts you actually used | v1.1 (small) |
| S12 | **Search by file** | Searching `@auth.ts` lists every prompt that mentions that file | v1 (search already covers it; this just documents it) |
| S13 | **Storage outside the project** | A setting to keep prompts in VS Code's per-workspace storage instead of `.prompt-composer/`, for repos where you can't add any folder | Later |

---

## 6. Risks to prove early (spikes before building for real)

1. **Markdown round-trip.** Our serializer must write the same Markdown it reads.
   - Test: open real prompts, edit one word, save. The diff must be exactly one line.
   - If Tiptap's Markdown support can't pass this, we write our own serializer for the small set of nodes we support.
2. **Webview panel lifecycle.** Prove that saves are never lost. Check closing a tab, closing VS Code, a crash right after typing, and restoring open prompts after restart (`registerWebviewPanelSerializer`).
3. **Symlink watching.** Confirm that changes inside symlinked folders reach us. Test on Windows (both symlinks and junctions) and on macOS.
4. **Drag from Explorer into a webview.** VS Code normally intercepts the drop and opens the file; holding Shift passes it to the webview.
   - Verify this, then show a hint while dragging. The mockup simulates it.
5. **Keyboard shortcuts inside the webview.** Confirm that VS Code doesn't take Alt+↑/↓, Ctrl+Z/Y, Ctrl+B/I/K, Ctrl+S or Tab while the composer has focus.
6. **Claude Code and git-ignored files.** Confirm Claude Code reads a file given as `@.prompt-composer/images/…` even though the folder is git-ignored. Its own `@` file suggestions skip ignored files, but explicit paths should still work.
7. **Swapping a double-click "Untitled" for a prompt.**
   - Measure whether the Untitled tab flashes before the prompt replaces it (target: no visible flash, or under one frame).
   - Confirm the prompt lands in the same editor group.
   - Confirm the Ctrl+N takeover keeps normal text files working.
   - Confirm restored Untitled files from a previous session are never swapped.
8. **Big repos and big libraries.** Test 100k+ files and symlinks into large shared trees, plus 5,000 prompts in the panel, against the targets in §3.

---

## 7. Decisions and settings

1. **Mention paths:** workspace-relative, `@src/a.ts`.
2. **Paths with spaces** are written quoted, `@"docs/my notes.md"`, and read back the same way.
3. **`.gitignore`d files in `@`:** included. Symlinked folders are often gitignored, so hiding ignored files would hide exactly what you need. `.git`, `node_modules`, `files.exclude` and `.prompt-composer/` are still excluded.
4. **New Prompt keybinding:** none by default.
5. **Saving:** left to the user: Ctrl+S, plus VS Code's Auto Save setting when it's on. No timer of our own.
6. **Single folder:** VS Code is always opened on one folder (no multi-root; if a multi-root workspace is opened anyway, the first folder is used). `.prompt-composer/` is one level deep (month folders + a flat `images/`).

### Settings

The defaults are the choices made in the mockup's control bar.

| Setting | Values | Default | Mockup control |
|---|---|---|---|
| `promptComposer.editor.colors` | `"theme"` (your VS Code theme), `"tiptap"` (Tiptap's palette) | `"theme"` | Editor colors |
| `promptComposer.mentions.style` | `"icon"` (icon + name pill), `"at"` (`@name` pill), `"plain"` (`@name` text) | `"icon"` | Mentions |
| `promptComposer.toolbar` | `"mid"`, `"full"`, `"off"` | `"mid"` | Toolbar |
| `promptComposer.editor.width` | `"full"` (whole editor width), `"readable"` (648px column) | `"full"` | Width |
| `promptComposer.caret` | `"smooth"`, `"native"` | `"smooth"` | Caret |
| `promptComposer.lineNumbers` | on / off | on | Line numbers |
| `promptComposer.panel.show` | `today` / `month` / `all` | `today` | Panel ⋯ menu, or the links in the panel's footer |
| `promptComposer.untitledFiles` | `"doubleClick"`, `"always"`, `"off"` | `"doubleClick"` | (tab-bar double-click) |
| `promptComposer.gitignore` | on / off: write `.prompt-composer/.gitignore` | on | n/a |
| `promptComposer.mentions.exclude` | glob list, added to `files.exclude` | `["**/.git", "**/node_modules"]` | n/a |
| `promptComposer.mentions.maxEntries` | number | `200000` | n/a |

Theme follows VS Code (Dark Modern, Light Modern or any other). The mockup's "Side bar" and "File on disk" controls are mockup-only: the panel is a normal side-bar view, and the file on disk is one click away with "Open as Text". Saving has no setting of its own; it follows `files.autoSave`.

---

## 8. Milestones

| Milestone | Scope |
|---|---|
| **M0: UI validation** (done) | Clickable mockup in `mockup/composer-ui.html`, reviewed; its control-bar choices are the default settings (§7, Settings). |
| **M1: Library + editor** | Activity Bar panel, `.prompt-composer/` with its `.gitignore`, New Prompt (button, panel double-click, tab-bar/empty-editor double-click swap), user-controlled saving with `files.autoSave` support, discard-empty, month/day grouping, search, right-click menu. Prompt editor as a webview panel with Tiptap, Markdown round-trip, code highlighting, moving blocks. Spikes 1, 2, 5 and 7. |
| **M2: `@` mentions** | Index with symlinks and watchers, picker, chips, hover, Ctrl+click, broken detection. Spikes 3, 6 and 8. |
| **M3: Images** | Paste, drop and file picker; saving into the flat `images/` folder; rendering; resource roots; cleanup on delete. Spike 4. |
| **M4: Polish and ship** | Extras chosen from §5, a performance pass against the targets, packaging for the Marketplace and Open VSX. |

---

## 9. UI mockup (M0)

Open `mockup/composer-ui.html` directly in a browser. It works offline: Tiptap, fonts and icons are bundled in `mockup/vendor/`.

- **It's real Tiptap**, so typing, `@`, `/`, paste and the bubble menu behave the way the extension will.
- **The Prompt Composer panel is open in the side bar.** It shows Pinned and the current month; the sample also has prompts from the two months before, hidden until you turn on ⋯ → Show All Months or search. The Activity Bar's note icon switches between it and the Explorer.
- **The bar at the very top is mockup-only.** It switches theme, colours, mention style, toolbar, column width, caret, line numbers, side bar and the file-on-disk panel.
- **The file-on-disk panel shows the exact Markdown** that would be saved for the open prompt.
- **The Explorer is fake but realistic.** It has `.prompt-composer/` (dimmed, git-ignored), symlinked folders (`shared`, `src/config`), a symlinked file (`CLAUDE.md`) and duplicate names (`index.ts`).

**Things to try:**

- Double-click empty space in the panel or in the tab bar, type a title, and press Ctrl+S to save it under its file name. (The mockup still auto-saves; the extension saves when you do.)
- Create a new prompt and click away without typing: it's discarded.
- Search the panel for `routes` (finds a prompt from two months ago), `auth` or `@src/config`.
- Open the panel's ⋯ menu and toggle Show All Months.
- Right-click a prompt: Pin, Duplicate, Reveal in Explorer, Delete.
- Type `@` and then `date`, `index` or `src/`, and press Tab on a folder.
- Paste a screenshot: it's saved under `.prompt-composer/images/`.
- Type `/` on a new line, then `/todo` or `/code`, and press Enter.
- Hover a block and drag the ⋮⋮ grip, or press Alt+↑ / Alt+↓.
