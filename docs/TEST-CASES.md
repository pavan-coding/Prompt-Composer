# Prompt Composer: test cases

Every behaviour in [PLAN.md](../PLAN.md) has a case here.

**Layer** is how the case is checked:
- **U**: unit test (Vitest)
- **I**: integration test inside a real Extension Development Host
- **E**: end-to-end UI test (Playwright driving VS Code)
- **M**: manual, in the Extension Development Host; steps are in [TESTING.md](TESTING.md)

Automated tests include the case ID in their name.

**Result** is filled in by the last full run (2026-10-03, Windows 11, VS Code 1.140): ✅ pass, ❌ fail, ⚠️ works but misses a target, 👤 manual only.

Totals: 84 unit tests, 50 integration tests, 39 end-to-end tests passed, 1 end-to-end test skipped (SV-05, see its row).

## ST: storage on disk

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| ST-01 | First save in a folder with no `.prompt-composer/` | Creates `.prompt-composer/`, `.prompt-composer/.gitignore` containing `*`, and the month folder `YYYY-MM/`. Nothing is created before the first save. | I | ✅ |
| ST-02 | `.gitignore` already exists (edited by the user) | Left untouched | I | ✅ |
| ST-03 | `promptComposer.gitignore` off | No `.gitignore` is written | I | ✅ |
| ST-04 | File name of a saved prompt | `DD-HHmm-<slug>.md`, where `DD-HHmm` is when the prompt was created and the month folder is that month | U, I | ✅ |
| ST-05 | Slug rules | Lower case; letters and digits of any script kept; everything else becomes `-`; trimmed; at most 48 characters; empty → `untitled` | U | ✅ |
| ST-06 | Two prompts, same minute, same title | Second file gets `-2`, third `-3`; nothing overwritten | U, I | ✅ |
| ST-07 | Title changed after the first save | File name stays the same; the tab shows the new title | I | ✅ |
| ST-08 | Atomic write | Content written via a temporary file then renamed; no `.tmp` file left behind; a temporary file is never listed as a prompt | U, I | ✅ |
| ST-09 | Listing is one level deep | Only `.prompt-composer/YYYY-MM/*.md` are prompts. Deeper files, non-month folders, `images/` and non-`.md` files are ignored | U, I | ✅ |
| ST-10 | Created time | Taken from `YYYY-MM` + `DD-HHmm`; files without that pattern fall back to their modified time | U | ✅ |
| ST-11 | Delete | Moves the file to the Recycle Bin / Trash; it disappears from the panel | I | ✅ |
| ST-12 | Duplicate | New file named from now and the same title, same content; opens it | I | ✅ |
| ST-13 | Pins | Kept across reloads; dropped when the prompt is deleted | I | ✅ |
| ST-14 | No folder open | Panel shows "Open a folder to use Prompt Composer"; New Prompt explains why it can't start | I | ✅ |
| ST-15 | File deleted outside (Explorer) | Disappears from the panel; if it's open, the tab stays with its content and saving recreates it | I | ✅ |

## MD: Markdown round trip

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| MD-01 | Headings | `#`–`###` become headings 1–3; `####`–`######` are kept as headings too and written back unchanged | U | ✅ |
| MD-02 | Inline formatting | Bold, italic, strike, inline code, links and their combinations round-trip | U | ✅ |
| MD-03 | Lists | Bullet, ordered (with start number) and task lists, nested two levels, round-trip; `- [x]` keeps its check | U | ✅ |
| MD-04 | Quotes | Multi-paragraph quotes and lists inside quotes round-trip | U | ✅ |
| MD-05 | Code blocks | Language kept; no language = plain; code containing ```` ``` ```` uses a longer fence; `~~~` fences read | U | ✅ |
| MD-06 | Divider and images | `---` and `![alt](../images/x.png)` round-trip | U | ✅ |
| MD-07 | Line breaks | Soft, backslash and two-space breaks are all read as line breaks and written as plain new lines (lines that would start a list or heading are escaped) | U | ✅ |
| MD-08 | Blank lines | N blank lines between blocks → N−1 empty lines in the editor → N blank lines on save; trailing empty lines aren't written | U | ✅ |
| MD-09 | Unknown syntax | Front matter, HTML blocks, tables and footnote definitions are kept byte-for-byte as editable raw blocks | U | ✅ |
| MD-10 | Minimal diffs | Editing one paragraph changes only that paragraph's lines in the file | U | ✅ |
| MD-11 | Escaping | Text with `*`, `_`, `` ` ``, `[`, `#` or `1.` at line start, `>` at line start, `|` survives save and reopen as the same text | U | ✅ |
| MD-12 | Mentions read | `@src/a.ts` → chip; `@src/config/` → folder chip; `@"docs/my notes.md"` → chip; `@team` → text; `a@b.com` → text; `(@src/a.ts)` → chip; trailing `.`/`,` not part of the path; nothing converted in code | U | ✅ |
| MD-13 | Broken mentions | Path-like token that doesn't exist → broken chip, written back unchanged | U | ✅ |
| MD-14 | Deterministic | serialize(parse(serialize(doc))) equals serialize(doc) for every fixture | U | ✅ |
| MD-15 | Empty document | Saves as an empty file; an empty never-saved prompt writes nothing | U, I | ✅ |
| MD-16 | Title | First heading or first non-empty line; Markdown syntax stripped; at most 80 characters; "Untitled prompt" when empty | U | ✅ |
| MD-17 | Search text | Includes headings, body, list items, code and `@paths` | U | ✅ |
| MD-18 | Copy as Markdown | Copying a selection puts Markdown (with `@paths`) on the clipboard as plain text | E | ✅ |
| MD-19 | Paste Markdown | Pasting Markdown text produces formatted content | E | ✅ |

## PN: the side-bar panel

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| PN-01 | No prompts yet | Welcome text and a New Prompt button | E | ✅ |
| PN-02 | Default view | Pinned group, then the current month by day (Today, Yesterday, "Wed, Oct 1"), newest first, each row with title and time | U, E | ✅ |
| PN-03 | Older months hidden | Not listed; a quiet line says they're hidden and search finds them | U, E | ✅ |
| PN-04 | Show All Months | ⋯ menu toggles the setting; older months appear folded with counts; turning it off hides them again | I, E | ✅ |
| PN-05 | Search | Matches title, body and `@paths` across all months; shows a count, each prompt, and its matching line with the match highlighted; Esc clears; Enter opens the first result | U, E | ✅ |
| PN-06 | Click and double-click | Click opens a preview tab (reused by the next click); double-click opens a normal tab with the caret in it; double-click on empty space starts a new prompt | E | ✅ |
| PN-07 | Context menu | Open, Open to the Side, Copy as Prompt, Copy @Path for Claude, Pin/Unpin, Duplicate, Reveal in Explorer, Delete, all working | I, E | ✅ |
| PN-08 | Collapse All and fold state | Title-bar button folds every group; folds are remembered after a reload | E | ✅ |
| PN-09 | Open and dirty markers | The open prompt is highlighted; a prompt with unsaved changes shows a dot | E | ✅ |
| PN-10 | Unsaved new prompt | Appears under Today with a dot once it has content | I, E | ✅ |
| PN-11 | New month | "No prompts yet this month" until one is saved | U | ✅ |
| PN-12 | Keyboard | ↑/↓ moves, Enter opens, Delete deletes (with confirmation) | E | ✅ |
| PN-13 | Search speed | Under 30 ms with 5,000 prompts | U | ✅ 12 ms |

## ED: the editor

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| ED-01 | New prompt | Tab "Untitled prompt", caret ready, hint "Type / for commands, @ to mention a file" | E | ✅ |
| ED-02 | Live title | Typing a first line updates the tab title | E | ✅ |
| ED-03 | Markdown shortcuts | `# `, `- `, `1. `, `[ ] `, ```` ``` ````, `> `, `**b**`, `` `c` `` convert as typed | E | ✅ |
| ED-04 | Toolbar | Mid (default), full or off by setting; wraps instead of scrolling when narrow; dropdowns and active states work | E | ✅ |
| ED-05 | Bubble menu | Shows on a text selection; hidden in code blocks; buttons apply | E | ✅ |
| ED-06 | `/` commands | Opens at line start or after a space; filters (`/h2`, `/todo`, `/code`); Enter/Tab runs and removes the typed `/query`; Esc closes; not in code or mid-word | E | ✅ |
| ED-07 | Code blocks | Highlighted with Dark+ colours; the language picker writes the fence language | E | ✅ |
| ED-08 | Move blocks | Alt+↑/↓ moves the block or list item; the caret follows | E | ✅ |
| ED-09 | Drag handle | Appears beside the hovered block with no background box; dragging moves the block; menu has Move up/down, Duplicate, Delete | E, M | ✅ (dragging: 👤) |
| ED-10 | Smooth caret | Drawn caret glides and expand-blinks; `"native"` setting gives the browser caret | E, M | ✅ (glide feel: 👤) |
| ED-11 | Line numbers | Count visual lines 1, 2, 3…; wrapped paragraphs take one number per line; active line highlighted; setting turns them off | E | ✅ |
| ED-12 | Ctrl+click | Opens web links in the browser and workspace links in VS Code; no selection box appears | E | ✅ |
| ED-13 | Link input | Ctrl+K opens VS Code's input box; Enter sets the link, empty removes it | E | ✅ |
| ED-14 | Undo/redo | Ctrl+Z / Ctrl+Y undo and redo exactly one step per press | E | ✅ |
| ED-15 | Live settings | Changing colours, mention style, toolbar, width, caret or line numbers updates open editors at once | E | ✅ |
| ED-16 | Theme | Switching Dark Modern ↔ Light Modern recolours editor, menus and code at once | E | ✅ |
| ED-17 | Raw blocks | Unknown Markdown shows as an editable raw block and is saved as typed | E | ✅ |
| ED-18 | Look | Colours match Dark Modern (editor `#1F1F1F`, code block `#2B2B2B`, inline code `#3C3C3C`); floating menus stand apart; checkbox sharp at 125% | E, M | ✅ (sharpness at 125%: 👤) |

## SV: saving

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| SV-01 | Dirty and Ctrl+S | An edit shows the dirty icon on the tab and a dot in the panel; Ctrl+S writes the file and clears both | I, E | ✅ |
| SV-02 | New prompt not written early | No file until the first save; saving an empty new prompt writes nothing | I | ✅ |
| SV-03 | Auto Save `afterDelay` | Saves `files.autoSaveDelay` ms after the last change | I | ✅ |
| SV-04 | Auto Save `onFocusChange` | Saves when focus leaves the prompt | I, E | ✅ |
| SV-05 | Auto Save `onWindowChange` | Saves when the window loses focus | I | ✅ integration; 👤 real window switch (Playwright emulates focus) |
| SV-06 | Close a changed prompt | Asks Save / Don't Save. Save writes; Don't Save drops; Cancel reopens the prompt with its changes | I, E | ✅ |
| SV-07 | Close an empty new prompt | Discarded silently; no file | I | ✅ |
| SV-08 | Close several changed prompts at once | One combined question | I | ✅ |
| SV-09 | Reload with unsaved changes | The tab comes back with the changes, still dirty | E | ✅ |
| SV-10 | Drafts backup | Unsaved changes whose tab didn't come back show in the panel with a dot and reopen with the draft | I | ✅ |
| SV-11 | Revert | Drops unsaved changes and reloads the file | I | ✅ |
| SV-12 | Opening doesn't write | Opening and closing a prompt without edits leaves the file's bytes and modified time unchanged | I | ✅ |
| SV-13 | Undo back to saved | Undoing all edits makes the prompt clean again | I | ✅ |
| SV-14 | Local History | Records whether VS Code's Timeline shows prompt saves (informational) | M | 👤 not recorded: writes go straight to disk (known limitation) |

## UT: double-click "Untitled" swap

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| UT-01 | Double-click empty tab bar | A new prompt opens in that group; no Untitled tab remains | E | ✅ |
| UT-02 | Double-click an empty editor group | Same as UT-01 | E | ✅ |
| UT-03 | Ctrl+N (`doubleClick` mode) | A normal Untitled text file opens and stays | I, E | ✅ |
| UT-04 | `always` mode | A new empty Untitled file (any source) becomes a prompt | I | ✅ |
| UT-05 | `off` mode | Nothing is swapped | I | ✅ |
| UT-06 | Untitled with content | Never swapped | I | ✅ |
| UT-07 | Untitled with another language | Never swapped | I | ✅ |
| UT-08 | Untitled tabs restored at startup | Never swapped | M | 👤 manual (restore an Untitled file across a restart) |
| UT-09 | Flash | The Untitled tab is replaced within one frame or close to it; screenshots record what's visible | E | ✅ Untitled tab visible ~170 ms |

## CE: opening prompt files directly

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| CE-01 | Open `.prompt-composer/YYYY-MM/x.md` from the Explorer | Opens the composer tab (titled with the prompt title) instead of a text editor | I, E | ✅ |
| CE-02 | Any other `.md` | Opens normally | I | ✅ |
| CE-03 | Open as Text | Opens the file in VS Code's text editor, read-only | I | ✅ |
| CE-04 | Open an already-open prompt | Focuses its tab; no second tab | I | ✅ |
| CE-05 | Restart with a prompt open | Comes back in the composer | E | ✅ |

## MN: `@` mentions and the file index

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| MN-01 | Index contents | Files and folders, a symlinked file, a symlinked folder (a junction on Windows) and everything inside it | I | ✅ |
| MN-02 | Cycles | A link back to an ancestor is listed once and not walked again | I | ✅ |
| MN-03 | Broken link | Listed and marked broken | I | ✅ |
| MN-04 | Excludes | `.git`, `node_modules`, `files.exclude`, `.prompt-composer/` and the custom exclude setting | I | ✅ |
| MN-05 | Cap | Stops at `promptComposer.mentions.maxEntries` with one warning | U | ✅ |
| MN-06 | Ranking | Name matches first, then path; letters must be consecutive or start a word; `src/` lists inside `src` | U | ✅ |
| MN-07 | Empty query | Recently opened files first | U | ✅ |
| MN-08 | Picker | Each row shows name, full path and symlink target; ↑/↓, Enter inserts, Tab drills into folders, Esc closes | E | ✅ |
| MN-09 | Chip | Shows only the name (icon + name by default); hover shows full path and symlink info; Ctrl+click opens the file or reveals the folder | E | ✅ |
| MN-10 | Saved form | `@src/a.ts`, folders `@src/config/`, quoted when the path has spaces | U | ✅ |
| MN-11 | Index updates | Creating and deleting files (also inside a symlinked folder) updates `@` results | I | ✅ |
| MN-12 | Speed | Search under 30 ms with 100k entries | U | ✅ 7–21 ms |
| MN-13 | Triggers | `@` at line start, after a space or `(` opens the picker; `a@b` doesn't | E | ✅ |
| MN-14 | Broken count | Status bar shows the broken count; clicking it selects the first broken chip | E | ✅ |

## IM: images

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| IM-01 | Paste an image | Saved as `.prompt-composer/images/YYYY-MM-DD-HHmmss.png`, shown inline, written as `![…](../images/…)` | I, E | ✅ |
| IM-02 | Drop an image file | Keeps its name; `-1`, `-2` if taken | I | ✅ |
| IM-03 | Insert Image… | Native file picker; chosen files copied in and inserted | M | 👤 manual (native file picker) |
| IM-04 | Display | Images render (CSP allows them), at most column width | E | ✅ |
| IM-05 | Hover and double-click | Hover shows the path; double-click opens the image in VS Code | E | ✅ |
| IM-06 | Copy as Prompt | Images become `@.prompt-composer/images/x.png` | U, I | ✅ |
| IM-07 | Delete a prompt with images | Offers to delete images no other prompt uses | I | ✅ |
| IM-08 | Discard a new prompt with pasted images | Images added in that session that nothing references are removed | I | ✅ |
| IM-09 | Shift+drag a file from the Explorer | Inserts an `@` mention | M | 👤 manual (Shift+drag from the Explorer) |

## CP: copy, status bar, commands

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| CP-01 | Copy as Prompt | Editor-title button and panel menu copy the Markdown | I | ✅ |
| CP-02 | Copy @Path for Claude | `@.prompt-composer/YYYY-MM/<file>.md` | I | ✅ |
| CP-03 | Reveal in Explorer | Selects the file in the Explorer | M | 👤 manual (Explorer selection) |
| CP-04 | Status bar | Mentions, images and "N words · ~T tokens" for the active prompt; hidden otherwise | E | ✅ |
| CP-05 | Reveal Prompts Folder | ⋯ menu reveals `.prompt-composer/` in the Explorer | M | 👤 manual (Explorer selection) |

## PF: performance

| ID | Case | Expected | Layer | Result |
|---|---|---|---|---|
| PF-01 | New Prompt → ready to type | Under 200 ms | E | ⚠️ 288 ms measured (target 200 ms; webview start-up) |
| PF-02 | Open a 1,000-line prompt | Editor usable in under 300 ms | E | ✅ 392 ms |
| PF-03 | Index 50k files | Under 2 s, in the background | U | ✅ 51,746 entries in 246 ms |
| PF-04 | Bundle size | Reported by the build | U | ✅ reported by every build |
