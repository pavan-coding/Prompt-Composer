# Testing Prompt Composer yourself

This guide is for trying the extension by hand in VS Code's **Extension Development Host** (the "debug extension window").
- The automated tests are listed at the end.
- Every case has an ID that matches [TEST-CASES.md](TEST-CASES.md).

## 1. Start it (once)

1. Open this repository folder in VS Code.
2. In a terminal, run:

   ```bash
   npm install
   ```

3. Start the test window, either way:
   - **From a terminal (recommended):**

     ```bash
     npm run dev
     ```

     This builds the extension and opens a VS Code window with it loaded on `sample-workspace/ws`. For another folder, run `npm run dev -- "D:\path\to\project"`.
   - **From VS Code:** open Run and Debug, pick **Run Extension (sample workspace)** and press **Ctrl+F5** (Run Without Debugging).
     - Plain **F5** (with the debugger) can make the new window close by itself about a second after it opens. That's a VS Code bug in the debugger's start-up ([microsoft/vscode#336233](https://github.com/microsoft/vscode/issues/336233), exit code 134), not this extension.
     - If you need breakpoints, press F5 again; the crash is intermittent.
   - **What happens:** the first run creates `sample-workspace/` and builds the extension. The new window's title starts with **[Extension Development Host]**. Do all the testing there.

**What's in the sample workspace:**
- an ordinary project (`src/`, `docs/`, `README.md`)
- `shared/` and `src/config/`: symlinked folders (junctions on Windows), pointing outside the workspace
- `src/loop/`: a link back to `src/` (a loop)
- `broken-link/`: a link to a folder that doesn't exist
- `docs/my notes.md`: a file with a space in its name

**To start again from scratch:**
1. Close the debug window.
2. Delete `sample-workspace/`.
3. Press F5.

**Useful in the debug window:**
- **View → Output → "Prompt Composer"**: the extension's log, including errors from the editor page.
- **Help → Toggle Developer Tools**: console errors from the webviews.
- After changing code in the main window, press **Ctrl+R** in the debug window to reload it. (`npm run watch` in a terminal rebuilds on save.)

---

## 2. The prompt library (panel)

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Click the **Prompt Composer** icon (a note) in the Activity Bar | The side bar titled "Prompt Composer", a search box, "No prompts yet." and a **New Prompt** button | PN-01 |
| 2 | Double-click empty space in the panel | A new tab **Untitled prompt** with the caret ready and the hint "Write your prompt… Type / for commands, @ to mention a file" | ED-01 |
| 3 | Type `# My first prompt` | The tab title changes to "My first prompt" as you type | ED-02 |
| 4 | Look at the tab and the panel | A filled dot as the tab's icon; in the panel, under **October 2026 → Today**, an italic row with a dot (not saved yet) | SV-01, PN-10 |
| 5 | Press **Ctrl+S** | The dot goes away. The Explorer still doesn't show `.prompt-composer/`: VS Code hides it, and nothing was added to your settings. Panel **⋯ → Reveal Prompts Folder in File Explorer** shows it on disk: `.gitignore` (containing `*`) and `2026-10/DD-HHmm-my-first-prompt.md` | ST-01, ST-04, ST-16, CP-05 |
| 6 | Change the heading to `# Renamed` and save | The tab shows "Renamed"; the file name doesn't change | ST-07 |
| 7 | Make two more prompts, then single-click one in the panel, then another | Single-clicks reuse one *preview* tab | PN-06 |
| 8 | Double-click a prompt row | It opens as a normal tab, caret inside | PN-06 |
| 9 | Type in the search box: a word from a prompt's body, or `@src/server` | "N prompts found", each prompt with its matching line highlighted. **Esc** clears; **Enter** opens the first | PN-05 |
| 10 | Right-click a prompt | VS Code's own menu: Open, Open to the Side, Copy as Prompt, Copy @Path for Claude, Pin, Duplicate, Reveal in File Explorer, Delete | PN-07 |
| 11 | Pin one | A **Pinned** group appears at the top (it still shows under its day too) | PN-07 |
| 12 | Duplicate one | A new prompt with the same text opens | ST-12 |
| 13 | Delete one (right-click → Delete) | A confirmation; the file goes to the Recycle Bin and disappears from the panel. If it had images no other prompt uses, you're offered to delete those too | ST-11, IM-07 |
| 14 | **⋯** in the panel title → **Show All Months** | Older months appear, folded, with counts (create an older one by copying a prompt file into a folder like `.prompt-composer/2026-08/`). **⋯ → Show Current Month Only** hides them again | PN-03, PN-04 |
| 15 | Click **Collapse All** in the panel title | Every group folds; folds are remembered after Ctrl+R | PN-08 |
| 16 | Click a row, then use ↑/↓, Enter, Delete | Keyboard navigation works | PN-12 |
| 17 | **Ctrl+P** and type part of a prompt's file name; **Ctrl+Shift+F** for a word in a prompt | Neither lists prompt files: VS Code leaves `.prompt-composer/` out of Quick Open and Search. The panel's search finds them | ST-16 |

## 3. Saving (left to you)

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Edit a saved prompt and close its tab (Ctrl+W) | "Do you want to save the changes you made to "…"?" with **Save** / **Don't Save** / **Cancel**. Save writes the file; Don't Save drops the changes; Cancel reopens the prompt with your edits | SV-06 |
| 2 | Make a new prompt and close it without typing | It just closes; no file is made | SV-07 |
| 3 | Edit two prompts and run **View → Close All Editors** (Ctrl+K W) | One question for both | SV-08 |
| 4 | Edit a prompt (don't save) and press **Ctrl+R** to reload the window | The tab comes back with your edits, still marked unsaved | SV-09 |
| 5 | Command Palette → **Prompt Composer: Revert Prompt** | Unsaved edits are thrown away | SV-11 |
| 6 | Settings → `files.autoSave` = `afterDelay` | Prompts save themselves after `files.autoSaveDelay` | SV-03 |
| 7 | `files.autoSave` = `onFocusChange`, edit, then click the panel's search box | Saved as soon as focus leaves the prompt | SV-04 |
| 8 | `files.autoSave` = `onWindowChange`, edit, then switch to another app (Alt+Tab) | Saved when the window loses focus (automated tests can't check this one, so please do) | SV-05 |
| 9 | Open a prompt and close it without editing | The file's modified time doesn't change | SV-12 |
| 10 | In a prompt tab, editor title → **Open as Text**, then open the **Timeline** view | Local History: the extension writes files directly, so the Timeline doesn't list these saves (a known limitation) | SV-14 |

## 4. Starting prompts from the tab bar

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Open any file, then double-click the **empty space to the right of the tabs** | A new prompt opens in that group. An "Untitled-1" tab may flash for a moment (about 170 ms in the tests) | UT-01, UT-09 |
| 2 | Close all editors and double-click the empty editor area | A new prompt opens | UT-02 |
| 3 | Press **Ctrl+N** | A normal "Untitled-1" text file, as before | UT-03 |
| 4 | Setting `promptComposer.untitledFiles` = `always`, then Ctrl+N | Ctrl+N makes a prompt too | UT-04 |
| 5 | Setting `promptComposer.untitledFiles` = `off`, then double-click the tab bar | A normal Untitled file stays | UT-05 |

## 5. The editor

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Type `## `, `- `, `1. `, `[ ] `, `> `, ```` ```ts ```` + space, `**bold**`, `` `code` `` | Each turns into a heading, list, numbered list, task, quote, code block, bold, inline code | ED-03 |
| 2 | Use the toolbar: heading and list dropdowns, quote, code block, bold, italic, strike, code, link, @, image | Each works; active buttons light up | ED-04 |
| 3 | Make the editor narrow (split it or shrink the window) | The toolbar wraps onto two lines instead of scrolling | ED-04 |
| 4 | Select some text | The bubble menu appears above it (not inside code blocks) | ED-05 |
| 5 | Type `/` on an empty line, then `h2`, `todo`, `code`, `img` | The command menu filters; Enter runs it and removes what you typed; Esc closes. `src/a` mid-word never opens it | ED-06 |
| 6 | Make a code block, click its language button (top right) | 22 languages; the choice is written into the file (```` ```python ````). Keywords in purple/blue like VS Code | ED-07 |
| 7 | Put the caret in a block and press **Alt+↑ / Alt+↓** | The block (or list item) moves | ED-08 |
| 8 | Hover a block | A ⋮⋮ grip in the left margin with no box behind it. Drag it to move the block; click it for Move up/down, Duplicate, Delete | ED-09 |
| 9 | Click around and type | The caret glides and blinks by shrinking to its middle (VS Code's "expand"). Setting `promptComposer.caret` = `native` gives the normal caret | ED-10 |
| 10 | Type a long paragraph that wraps | Line numbers count the lines you see (a wrapped paragraph takes several). `promptComposer.lineNumbers` turns them off | ED-11 |
| 11 | Select text, press **Ctrl+K** | VS Code's input box asks for the URL. Enter sets the link; an empty value removes it | ED-13 |
| 12 | **Ctrl+click** a link | Web links open in your browser; workspace paths (e.g. `README.md`) open in VS Code; no box is drawn around the block | ED-12 |
| 13 | Type, then **Ctrl+Z** / **Ctrl+Y** | Exactly one step per press (also Edit → Undo / Redo) | ED-14 |
| 14 | Press **Ctrl+B**, **Ctrl+E**, **Ctrl+Shift+S** in the editor | Bold, inline code, strikethrough. The side bar does **not** toggle, Quick Open does **not** open, and Save As does **not** appear | ED-14b |
| 15 | Settings: `promptComposer.mentions.style`, `editor.colors`, `editor.width`, `toolbar`, `caret`, `lineNumbers` | Each change applies to open editors immediately | ED-15 |
| 16 | Switch theme (Dark Modern ↔ Light Modern) | The editor, menus and code colours follow at once | ED-16 |
| 17 | Look closely at 125% scaling | Editor background `#1F1F1F`, code blocks `#2B2B2B`, inline code `#3C3C3C`. Toolbar and menus stand out from the page. Checkboxes are sharp, blue when ticked | ED-18 |
| 18 | Paste a Markdown table (or open a prompt that has one) | It shows as a dashed "Markdown" raw block, edited as text and saved exactly | ED-17 |
| 19 | Write `<instructions>` … `</instructions>` on their own lines | They stay plain text lines and are saved unescaped | MD-09 |
| 20 | Select all, Ctrl+C, paste into a terminal or text file | You get Markdown with `@paths` | MD-18 |
| 21 | Copy Markdown text from a text file and paste it into a prompt | It becomes headings, lists… | MD-19 |

## 6. `@` mentions

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Type `@` | A list of files and folders: each name, and under it the full path. `shared/` shows "→ its target"; `broken-link` shows a warning icon | MN-08, MN-01, MN-03 |
| 2 | Type `@auth` | `auth.ts` (`src/server/auth.ts`) first, matched letters highlighted. Enter inserts a chip showing only **auth.ts** with a file icon | MN-06, MN-09 |
| 3 | Type `@sr`, press **Tab** on `src` | The list now shows what's inside `src` | MN-06 |
| 4 | Type `@shared/` and pick `utils/date.ts` | Hovering the chip says it's inside the symlinked `shared` | MN-01 |
| 5 | Hover a chip | The full path and symlink info. **Ctrl+click** opens the file, or reveals a folder in the Explorer | MN-09 |
| 6 | Type `a@b.com` | No list appears; `(@` does open it | MN-13 |
| 7 | Mention a file, save, then delete that file in the Explorer and reopen the prompt | The chip is struck through in the warning colour. The status bar shows "1 broken"; clicking it selects the chip | MN-14 |
| 8 | Look at the status bar with a prompt open | Mentions count, images count and "N words · ~T tokens"; they hide when a normal file is active | CP-04 |
| 9 | Pick `docs/my notes.md` | Saved as `@"docs/my notes.md"` (quoted; Claude Code reads that) | MN-10 |
| 10 | Create a new file in `src/` and type `@` + its name | It's offered right away; deleted files disappear. Also works for files added inside the `shared` target folder | MN-11 |

## 7. Images

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | Take a screenshot (Win+Shift+S) and paste it into a prompt | It appears inline, and `.prompt-composer/images/YYYY-MM-DD-HHmmss.png` is created | IM-01, IM-04 |
| 2 | Drag an image file from Windows Explorer into the editor | Saved under its own name (`-1`, `-2` if taken) and shown | IM-02 |
| 3 | Command Palette → **Prompt Composer: Insert Image…** (or the toolbar image button) | A file picker; the chosen images are copied in and inserted | IM-03 |
| 4 | Hover an image; double-click it | Its path; then it opens in VS Code's image viewer | IM-05 |
| 5 | Editor title bar → **Copy as Prompt** (copy icon) | The clipboard has the Markdown with each image as `@.prompt-composer/images/…png` | IM-06, CP-01 |
| 6 | Paste an image into a *new* prompt, then close it and choose **Don't Save** | The pasted image file is removed | IM-08 |
| 7 | Hold **Shift** and drag a file from VS Code's Explorer into the editor | It's inserted as an `@` mention | IM-09 |

## 8. Prompt files and other commands

| # | Do this | You should see | ID |
|---|---|---|---|
| 1 | **File → Open File…** (Ctrl+O) and pick `.prompt-composer/2026-10/<a prompt>.md` | It opens in the composer (tab titled with the prompt's title), not as text | CE-01 |
| 2 | Open `README.md` | It opens as a normal text file | CE-02 |
| 3 | In a prompt tab, editor title → **Open as Text** | The `.md` opens beside it, read-only | CE-03 |
| 4 | Open a prompt that's already open | Its tab is focused; no second tab | CE-04 |
| 5 | Right-click a prompt → **Copy @Path for Claude** | `@.prompt-composer/2026-10/<file>.md` on the clipboard | CP-02 |
| 6 | Right-click → **Reveal in File Explorer**; panel **⋯** → **Reveal Prompts Folder in File Explorer** | Windows File Explorer opens with the prompt selected / inside `.prompt-composer/` on the newest month | CP-03, CP-05 |
| 7 | Run the debug window with **no folder open** (File → Close Folder) | The panel says "Open a folder to use Prompt Composer"; New Prompt asks you to open a folder | ST-14 |

---

## 9. Automated tests (what the AI ran)

| Command | What it runs | Last result |
|---|---|---|
| `npm run test:unit` | Vitest, in Node: Markdown round trips, naming, titles/search text, library model, fuzzy matching, speed | 84 passed |
| `npm run test:integration` | Mocha inside a real Extension Development Host on a copy of the fixture workspace | 52 passed |
| `npm run test:e2e` | Playwright driving a real VS Code window: typing, menus, dialogs, double-clicks, paste, reload, themes. Screenshots go to `test-results/e2e/<ID>/` | 40 passed, 1 skipped (SV-05: Playwright pretends the window always has focus, so section 3 row 8 is manual) |
| `npm run package` then `node test/e2e/vsix-smoke.mjs` | Installs the packaged `.vsix` into a throwaway profile and makes and saves a prompt with it | passed (441 KB package) |
| `npm test` | Unit, integration and end-to-end | |

- **Which VS Code they use:** the integration and end-to-end tests download the latest stable VS Code into `.vscode-test/` on first run. Set `CODE_EXE` to use an installed one instead:

  ```bash
  CODE_EXE="$LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe" npm run test:e2e
  ```

- **Running a subset:** `node test/e2e/run.mjs ED-14 SV` runs only the tests whose names contain those words.
- **Quick look:** `node test/e2e/smoke.mjs` opens VS Code, writes and saves a prompt, and leaves screenshots in `test-results/smoke/`.
- **While the end-to-end tests run,** a VS Code window opens and takes focus for a couple of minutes; leave the mouse and keyboard alone until it closes.
