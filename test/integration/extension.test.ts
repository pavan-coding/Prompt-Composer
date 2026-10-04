// Integration tests: run inside a real Extension Development Host on a copy of test/fixtures/workspace.
// Each test name starts with its case ID from docs/TEST-CASES.md.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PromptComposerApi } from '../../src/extension';
import type { PromptDoc } from '../../src/editor/editorManager';

let api: PromptComposerApi;
const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const store = () => path.join(ws(), '.prompt-composer');
const monthDirs = () => (fs.existsSync(store()) ? fs.readdirSync(store()).filter((d) => /^\d{4}-\d{2}$/.test(d)) : []);
const promptFiles = () => monthDirs().flatMap((m) => fs.readdirSync(path.join(store(), m)).map((f) => `${m}/${f}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | Promise<T>, what: string, timeout = 10_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) { last = e; }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last}` : ''}`);
}

/** Put Markdown into a prompt's editor as if typed (the webview reports it; the host sees it as unsaved). */
async function setContent(doc: PromptDoc, markdown: string): Promise<void> {
  api.editors.post(doc, { type: 'reload', markdown, mentions: {} });
  await waitFor(() => doc.current === markdown, 'editor content');
}

async function newDoc(markdown?: string): Promise<PromptDoc> {
  const doc = api.editors.newPrompt();
  await waitFor(() => doc.loaded, 'editor to load', 15_000);
  if (markdown !== undefined) await setContent(doc, markdown);
  return doc;
}

/** Answer the next modal questions with `choice` and record what was asked. */
function answer(choice: string | undefined) {
  const asked: { message: string; detail?: string; items: string[] }[] = [];
  api.editors.dialogs.warn = async (message, options, ...items) => {
    asked.push({ message, detail: options.detail, items });
    return choice;
  };
  return asked;
}

async function closeAll(): Promise<void> {
  answer("Don't Save");
  for (const doc of api.editors.allDocs()) doc.panel?.dispose();
  await sleep(150);
  await api.editors.closing;
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(100);
}

async function saveNew(markdown: string): Promise<PromptDoc> {
  const doc = await newDoc(markdown);
  assert.ok(await api.editors.save(doc));
  return doc;
}

async function config(section: string, key: string, value: unknown) {
  await vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global);
  await sleep(100);
}

suiteSetup(async () => {
  const ext = vscode.extensions.getExtension<PromptComposerApi>('pavan-coding.prompt-composer');
  assert.ok(ext, 'extension is installed');
  api = await ext.activate();
  assert.ok(api, 'test API is returned in test mode');
});

suite('Storage', () => {
  teardown(closeAll);

  test('ST-01 first save creates the store, .gitignore and month folder (nothing before)', async () => {
    assert.equal(fs.existsSync(store()), false);
    const doc = await newDoc('# First prompt\n\nHello\n');
    assert.equal(fs.existsSync(store()), false, 'nothing is written before saving');
    assert.ok(await api.editors.save(doc));
    assert.equal(fs.readFileSync(path.join(store(), '.gitignore'), 'utf8'), '*\n');
    assert.ok(doc.rel);
    assert.match(doc.rel!, /^\d{4}-\d{2}\/\d{2}-\d{4}-first-prompt\.prompt$/);
    assert.equal(fs.readFileSync(path.join(store(), ...doc.rel!.split('/')), 'utf8'), '# First prompt\n\nHello\n');
  });

  test('ST-02 an existing .gitignore is left alone', async () => {
    fs.writeFileSync(path.join(store(), '.gitignore'), 'custom\n');
    await saveNew('# Second\n');
    assert.equal(fs.readFileSync(path.join(store(), '.gitignore'), 'utf8'), 'custom\n');
    fs.writeFileSync(path.join(store(), '.gitignore'), '*\n');
  });

  test('ST-03 no .gitignore when the setting is off', async () => {
    fs.rmSync(path.join(store(), '.gitignore'));
    await config('promptComposer', 'gitignore', false);
    try {
      await saveNew('# Third\n');
      assert.equal(fs.existsSync(path.join(store(), '.gitignore')), false);
    } finally {
      await config('promptComposer', 'gitignore', undefined);
      fs.writeFileSync(path.join(store(), '.gitignore'), '*\n');
    }
  });

  test('ST-04 ST-06 file name from creation time and title; same minute and title get -2', async () => {
    const a = await newDoc('# Same title\n');
    const b = await newDoc('# Same title\n');
    b.created.setTime(a.created.getTime());
    assert.ok(await api.editors.save(a));
    assert.ok(await api.editors.save(b));
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = a.created;
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}/${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-same-title`;
    assert.equal(a.rel, `${base}.prompt`);
    assert.equal(b.rel, `${base}-2.prompt`);
  });

  test('ST-07 changing the title after the first save keeps the file name', async () => {
    const doc = await saveNew('# Original title\n');
    const rel = doc.rel;
    await setContent(doc, '# A completely new title\n');
    assert.ok(await api.editors.save(doc));
    assert.equal(doc.rel, rel);
    assert.equal(doc.panel?.title, 'A completely new title');
  });

  test('ST-08 atomic writes leave no temporary files', async () => {
    await saveNew('# Atomic\n');
    const leftovers = monthDirs().flatMap((m) => fs.readdirSync(path.join(store(), m))).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  test('ST-09 ST-17 the library reads one level deep only, and only .prompt files', async () => {
    const month = monthDirs()[0];
    fs.mkdirSync(path.join(store(), month, 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(store(), month, 'deeper', 'x.prompt'), '# deeper\n');
    fs.mkdirSync(path.join(store(), 'notes'), { recursive: true });
    fs.writeFileSync(path.join(store(), 'notes', 'y.prompt'), '# not a month\n');
    fs.writeFileSync(path.join(store(), month, 'z.txt'), 'not markdown');
    fs.writeFileSync(path.join(store(), month, '01-0000-old.md'), '# an old .md file is not a prompt\n');
    const files = await api.store.list();
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => /^\d{4}-\d{2}\/[^/]+\.prompt$/.test(f.rel)), JSON.stringify(files.map((f) => f.rel)));
    fs.rmSync(path.join(store(), month, 'deeper'), { recursive: true });
    fs.rmSync(path.join(store(), 'notes'), { recursive: true });
    fs.rmSync(path.join(store(), month, 'z.txt'));
    fs.rmSync(path.join(store(), month, '01-0000-old.md'));
  });

  test('ST-11 ST-13 delete moves the file away and drops its pin', async () => {
    const doc = await saveNew('# To delete\n');
    const rel = doc.rel!;
    await api.library.setPinned(rel, true);
    assert.ok(api.library.isPinned(rel));
    await api.deletePrompt(rel, { confirm: false });
    assert.equal(fs.existsSync(path.join(store(), ...rel.split('/'))), false);
    assert.equal(api.library.get(rel), undefined);
    assert.equal(api.library.isPinned(rel), false);
  });

  test('ST-15 resync catches changes the watcher missed', async () => {
    const doc = await saveNew('# Resync target\n');
    const rel = doc.rel!;
    await api.library.ensureLoaded();
    fs.rmSync(path.join(store(), ...rel.split('/')));
    await api.library.resync();
    assert.equal(api.library.get(rel), undefined);
  });

  test('ST-12 duplicate makes a new file with the same content and opens it', async () => {
    const doc = await saveNew('# Dup source\n\nbody\n');
    const before = new Set(promptFiles());
    await vscode.commands.executeCommand('promptComposer.duplicate', { promptId: doc.rel });
    const added = await waitFor(() => promptFiles().filter((f) => !before.has(f)), 'duplicate file');
    assert.equal(added.length, 1);
    assert.equal(fs.readFileSync(path.join(store(), ...added[0].split('/')), 'utf8'), '# Dup source\n\nbody\n');
    assert.ok(api.editors.docByRel(added[0])?.panel, 'the duplicate is open');
  });

  test('ST-15 a file deleted outside disappears from the panel; saving the open tab recreates it', async () => {
    const doc = await saveNew('# Deleted outside\n');
    const rel = doc.rel!;
    await api.library.ensureLoaded();
    await sleep(1000); // a create and a delete within a few ms are merged away by VS Code's watcher
    fs.rmSync(path.join(store(), ...rel.split('/')));
    await waitFor(() => !api.library.get(rel), 'library to notice the delete');
    await setContent(doc, '# Deleted outside\n\nstill here\n');
    assert.ok(await api.editors.save(doc));
    assert.equal(fs.readFileSync(path.join(store(), ...rel.split('/')), 'utf8'), '# Deleted outside\n\nstill here\n');
  });

  test('ST-16 the prompts folder is hidden in VS Code without writing settings; the panel still sees changes in it', async () => {
    const files = vscode.workspace.getConfiguration('files');
    const exclude = files.inspect<Record<string, boolean>>('exclude')!;
    assert.equal(exclude.defaultValue?.['**/.prompt-composer'], true, 'contributed default');
    assert.equal(exclude.defaultValue?.['**/.git'], true, "VS Code's own defaults are kept");
    assert.equal(exclude.globalValue?.['**/.prompt-composer'], undefined, 'nothing in user settings');
    assert.equal(exclude.workspaceValue?.['**/.prompt-composer'], undefined, 'nothing in workspace settings');
    assert.equal(files.get<Record<string, boolean>>('exclude')?.['**/.prompt-composer'], true, 'in effect');

    const doc = await saveNew('# Hidden folder\n');
    const found = await vscode.workspace.findFiles('**/*.md');
    assert.ok(found.some((u) => u.fsPath.endsWith('README.md')), 'other Markdown files are found');
    assert.ok(!found.some((u) => u.fsPath.includes(`${path.sep}.prompt-composer${path.sep}`)), 'search and Quick Open leave prompts out');

    // VS Code still reports changes inside the hidden folder
    await api.library.ensureLoaded();
    const rel = `${doc.rel!.split('/')[0]}/01-0000-written-outside.prompt`;
    fs.writeFileSync(path.join(store(), ...rel.split('/')), '# Written outside\n');
    await waitFor(() => api.library.get(rel), 'library to notice the new file');
  });
});

suite('Saving', () => {
  teardown(closeAll);

  test('SV-01 edits make the prompt dirty; saving cleans it', async () => {
    const doc = await saveNew('# Dirty test\n');
    assert.equal(doc.dirty, false);
    await setContent(doc, '# Dirty test\n\nchanged\n');
    assert.equal(doc.dirty, true);
    const row = await waitFor(() => api.libraryView.model().months.flatMap((m) => m.days.flatMap((d) => d.prompts)).find((p) => p.id === doc.rel && p.dirty), 'dirty row in the panel');
    assert.ok(row);
    await vscode.commands.executeCommand('promptComposer.save');
    await waitFor(() => !doc.dirty, 'clean after save');
  });

  test('SV-02 MD-15 a new prompt is not written until saved; an empty one never is', async () => {
    const before = promptFiles().length;
    const doc = await newDoc();
    assert.ok(await api.editors.save(doc));
    assert.equal(doc.rel, undefined);
    assert.equal(promptFiles().length, before);
  });

  test('SV-03 Auto Save afterDelay saves on its own', async () => {
    await config('files', 'autoSaveDelay', 200);
    await config('files', 'autoSave', 'afterDelay');
    try {
      const doc = await newDoc('# Auto saved\n');
      await waitFor(() => doc.rel && !doc.dirty, 'auto save', 5000);
      assert.equal(fs.readFileSync(path.join(store(), ...doc.rel!.split('/')), 'utf8'), '# Auto saved\n');
    } finally {
      await config('files', 'autoSave', undefined);
      await config('files', 'autoSaveDelay', undefined);
    }
  });

  test('SV-05 Auto Save onWindowChange saves when VS Code loses focus', async () => {
    await config('files', 'autoSave', 'onWindowChange');
    try {
      const doc = await newDoc('# Window change\n');
      assert.equal(doc.rel, undefined);
      api.editors.windowFocusChanged(false); // what VS Code reports when you switch to another app
      await waitFor(() => doc.rel && !doc.dirty, 'saved on window change');
    } finally {
      await config('files', 'autoSave', undefined);
    }
  });

  test('SV-06 closing a changed prompt asks; Save writes it', async () => {
    const doc = await saveNew('# Ask on close\n');
    await setContent(doc, '# Ask on close\n\nnew text\n');
    const asked = answer('Save');
    doc.panel!.dispose();
    await waitFor(() => asked.length === 1, 'the question');
    await api.editors.closing;
    assert.match(asked[0].message, /Do you want to save the changes you made to "Ask on close"\?/);
    assert.deepEqual(asked[0].items, ['Save', "Don't Save"]);
    await waitFor(() => fs.readFileSync(path.join(store(), ...doc.rel!.split('/')), 'utf8') === '# Ask on close\n\nnew text\n', 'saved on close');
  });

  test("SV-06 Don't Save drops the changes", async () => {
    const doc = await saveNew('# Drop on close\n');
    await setContent(doc, '# Drop on close\n\nthrown away\n');
    const asked = answer("Don't Save");
    doc.panel!.dispose();
    await waitFor(() => asked.length === 1, 'the question');
    await api.editors.closing;
    assert.equal(fs.readFileSync(path.join(store(), ...doc.rel!.split('/')), 'utf8'), '# Drop on close\n');
    assert.equal(api.editors.docByRel(doc.rel!), undefined);
  });

  test('SV-06 Cancel reopens the prompt with its changes', async () => {
    const doc = await saveNew('# Cancel close\n');
    await setContent(doc, '# Cancel close\n\nkeep me\n');
    answer(undefined);
    doc.panel!.dispose();
    await waitFor(() => doc.panel, 'the prompt to reopen');
    await waitFor(() => doc.loaded, 'reopened editor');
    assert.equal(doc.current, '# Cancel close\n\nkeep me\n');
    assert.equal(doc.dirty, true);
  });

  test('SV-07 an empty new prompt closes without a question and leaves no file', async () => {
    const before = promptFiles().length;
    const doc = await newDoc();
    const asked = answer('Save');
    doc.panel!.dispose();
    await sleep(300);
    assert.equal(asked.length, 0);
    assert.equal(promptFiles().length, before);
    assert.equal(api.editors.allDocs().includes(doc), false);
  });

  test('SV-08 closing several changed prompts asks once', async () => {
    const a = await newDoc('# First of two\n');
    const b = await newDoc('# Second of two\n');
    const asked = answer("Don't Save");
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => asked.length >= 1, 'the question');
    await sleep(300);
    await api.editors.closing;
    assert.equal(asked.length, 1);
    assert.match(asked[0].message, /following 2 prompts/);
    assert.match(asked[0].detail ?? '', /First of two/);
    assert.match(asked[0].detail ?? '', /Second of two/);
    assert.equal(api.editors.allDocs().includes(a) || api.editors.allDocs().includes(b), false);
  });

  test('SV-10 unsaved changes are backed up in workspace storage', async () => {
    const doc = await newDoc('# Backed up draft\n');
    api.editors.writeDraftsNow();
    await waitFor(() => api.editors.drafts()[doc.id]?.markdown === '# Backed up draft\n', 'draft backup');
    const item = api.editors.libraryItems().find((i) => i.id === `doc:${doc.id}`);
    assert.ok(item?.dirty && !item.saved);
  });

  test('SV-11 Revert reloads the saved file', async () => {
    const doc = await saveNew('# Revert me\n');
    await setContent(doc, '# Revert me\n\nunsaved\n');
    await vscode.commands.executeCommand('promptComposer.revert');
    await waitFor(() => !doc.dirty && doc.current === '# Revert me\n', 'reverted');
  });

  test('SV-12 opening and closing a prompt never writes it', async () => {
    const doc = await saveNew('# Untouched\n\n\n\nodd   spacing  *kept*\n');
    const rel = doc.rel!;
    const file = path.join(store(), ...rel.split('/'));
    // a hand-made variation the serializer would format differently
    fs.writeFileSync(file, '#   Untouched   \n\n\n\nodd   spacing  _kept_\r\n');
    await closeAll();
    const before = fs.statSync(file).mtimeMs;
    const opened = await api.editors.open(rel, { focus: true });
    assert.ok(opened);
    await waitFor(() => opened.loaded, 'loaded');
    await sleep(300);
    assert.equal(opened.dirty, false, `not dirty: ${JSON.stringify(opened.current)}`);
    opened.panel!.dispose();
    await sleep(300);
    assert.equal(fs.statSync(file).mtimeMs, before);
    assert.equal(fs.readFileSync(file, 'utf8'), '#   Untouched   \n\n\n\nodd   spacing  _kept_\r\n');
  });

  test('SV-13 undoing back to the saved text makes it clean again', async () => {
    const doc = await saveNew('# Undo to clean\n');
    await setContent(doc, '# Undo to clean\n\nx\n');
    assert.equal(doc.dirty, true);
    await setContent(doc, '# Undo to clean\n');
    assert.equal(doc.dirty, false);
  });
});

suite('Untitled swap', () => {
  teardown(async () => {
    await config('promptComposer', 'untitledFiles', undefined);
    await closeAll();
  });

  const untitledTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.scheme === 'untitled');

  test('UT-01 a new empty Untitled file (what a tab-bar double-click opens) becomes a prompt', async () => {
    const swaps = api.untitled.swaps;
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    await waitFor(() => api.untitled.swaps === swaps + 1, 'swap');
    await waitFor(() => untitledTabs().length === 0, 'Untitled tab to close');
    assert.ok(api.editors.allDocs().some((d) => d.panel && !d.rel));
  });

  test('UT-03 Ctrl+N (the wrapper) still makes a text file', async () => {
    const swaps = api.untitled.swaps;
    await vscode.commands.executeCommand('promptComposer.newTextFile');
    await sleep(600);
    assert.equal(api.untitled.swaps, swaps);
    assert.equal(untitledTabs().length, 1);
  });

  test('UT-04 "always" swaps Ctrl+N too', async () => {
    await config('promptComposer', 'untitledFiles', 'always');
    const swaps = api.untitled.swaps;
    await vscode.commands.executeCommand('promptComposer.newTextFile');
    await waitFor(() => api.untitled.swaps === swaps + 1, 'swap');
  });

  test('UT-05 "off" never swaps', async () => {
    await config('promptComposer', 'untitledFiles', 'off');
    const swaps = api.untitled.swaps;
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    await sleep(600);
    assert.equal(api.untitled.swaps, swaps);
    assert.equal(untitledTabs().length, 1);
  });

  test('UT-06 an Untitled file with content is never swapped', async () => {
    const swaps = api.untitled.swaps;
    const doc = await vscode.workspace.openTextDocument({ content: 'some text' });
    await vscode.window.showTextDocument(doc);
    await sleep(600);
    assert.equal(api.untitled.swaps, swaps);
  });

  test('UT-07 an Untitled file in another language is never swapped', async () => {
    const swaps = api.untitled.swaps;
    const doc = await vscode.workspace.openTextDocument({ language: 'python', content: '' });
    await vscode.window.showTextDocument(doc);
    await sleep(600);
    assert.equal(api.untitled.swaps, swaps);
  });
});

suite('Opening prompt files', () => {
  teardown(closeAll);

  test('CE-01 CE-04 ST-17 a prompt file opens in the composer, once, whatever *.md is associated with', async () => {
    // like a notes editor set as the default for .md: it must not claim prompts
    await config('workbench', 'editorAssociations', { '*.md': 'default' });
    const doc = await saveNew('# Opened from Explorer\n');
    const rel = doc.rel!;
    await closeAll();
    const uri = vscode.Uri.file(path.join(store(), ...rel.split('/')));
    await vscode.commands.executeCommand('vscode.open', uri);
    const opened = await waitFor(() => api.editors.docByRel(rel)?.panel && api.editors.docByRel(rel), 'composer tab');
    await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).every((t) => !(t.input instanceof vscode.TabInputCustom)), 'redirect tab to close');
    assert.equal(opened.panel!.title, 'Opened from Explorer');
    await vscode.commands.executeCommand('vscode.open', uri);
    await sleep(800);
    const panels = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && (t.input as vscode.TabInputWebview).viewType.endsWith('promptComposer.editor'));
    assert.equal(panels.length, 1);
    await config('workbench', 'editorAssociations', undefined);
  });

  test('CE-02 other Markdown files open normally', async () => {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(ws(), 'README.md')));
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('README.md'), 'text editor');
  });

  test('CE-03 Open as Text shows the file in a text editor', async () => {
    const doc = await saveNew('# As text\n');
    doc.panel!.reveal();
    await waitFor(() => api.editors.activeDoc === doc, 'active prompt');
    await vscode.commands.executeCommand('promptComposer.openAsText');
    const ed = await waitFor(() => (vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(doc.rel!.split('/')[1]) ? vscode.window.activeTextEditor : undefined), 'text editor');
    // read-only in this session: typing into it changes nothing
    await sleep(300);
    await vscode.commands.executeCommand('type', { text: 'typed into the text view' });
    await sleep(200);
    assert.equal(ed.document.languageId, 'markdown', 'shown as Markdown');
    assert.equal(ed.document.getText(), '# As text\n');
    assert.equal(ed.document.isDirty, false);
  });
});

suite('Panel', () => {
  teardown(closeAll);
  const rows = () => {
    const m = api.libraryView.model();
    return [...m.pinned, ...m.months.flatMap((x) => x.days.flatMap((d) => d.prompts))];
  };

  test('PN-03 PN-04 the panel shows today by default; Show This Month / All Months / Today Only switch it', async () => {
    const show = () => vscode.workspace.getConfiguration('promptComposer').inspect<string>('panel.show')!;
    assert.equal(show().defaultValue, 'today');
    assert.equal(api.libraryView.model().show, 'today');
    for (const [command, value] of [['showThisMonth', 'month'], ['showAllMonths', 'all'], ['showToday', 'today']]) {
      await vscode.commands.executeCommand(`promptComposer.${command}`);
      assert.equal(show().globalValue, value, command);
      assert.equal(show().workspaceValue, undefined, 'not written to the workspace');
      await waitFor(() => api.libraryView.lastModel?.show === value, `panel re-rendered for ${value}`);
    }
    await config('promptComposer', 'panel.show', undefined);
  });

  test('PN-07 right-click commands: pin, unpin, open to the side', async () => {
    const doc = await saveNew('# Context menu target\n');
    const id = doc.rel!;
    await vscode.commands.executeCommand('promptComposer.pin', { promptId: id });
    assert.ok(api.library.isPinned(id));
    await waitFor(() => api.libraryView.model().pinned.some((p) => p.id === id), 'pinned row');
    await vscode.commands.executeCommand('promptComposer.unpin', { promptId: id });
    assert.equal(api.library.isPinned(id), false);
    await closeAll();
    // something open in the first group, as when you right-click a prompt while editing another
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(ws(), 'README.md')));
    await vscode.commands.executeCommand('promptComposer.openToSide', { promptId: id });
    const opened = await waitFor(() => api.editors.docByRel(id)?.panel, 'opened');
    await waitFor(() => opened.viewColumn === vscode.ViewColumn.Two, 'opened beside')
      .catch((e) => { throw new Error(`${e.message} (viewColumn ${opened.viewColumn}, groups ${vscode.window.tabGroups.all.map((g) => `${g.viewColumn}:${g.tabs.length}`).join(',')})`); });
  });

  test('PN-10 an unsaved new prompt shows under Today with a dot', async () => {
    const doc = await newDoc('# Not saved yet\n');
    const row = await waitFor(() => rows().find((r) => r.id === `doc:${doc.id}`), 'row');
    assert.equal(row.saved, false);
    assert.equal(row.dirty, true);
    assert.equal(row.title, 'Not saved yet');
  });

  test('PN-05 search finds text and @paths in the body', async () => {
    await saveNew('# Search target\n\nPlease update @src/server/routes.ts carefully\n');
    await api.library.ensureLoaded();
    api.libraryView.setQuery('routes.ts');
    const m = api.libraryView.lastModel!;
    api.libraryView.setQuery('');
    assert.ok(m.found >= 1);
    const hit = m.months.flatMap((x) => x.days.flatMap((d) => d.prompts)).find((p) => p.title === 'Search target');
    assert.ok(hit?.snippet?.[1].toLowerCase() === 'routes.ts');
  });
});

suite('Copy commands', () => {
  teardown(closeAll);

  test('CP-01 IM-06 Copy as Prompt turns images into @paths', async () => {
    const doc = await saveNew('# Copy me\n\n![shot](../images/a.png)\n');
    await vscode.commands.executeCommand('promptComposer.copyAsPrompt', { promptId: doc.rel });
    assert.equal(await vscode.env.clipboard.readText(), '# Copy me\n\n@.prompt-composer/images/a.png\n');
  });

  test('CP-02 Copy @Path for Claude', async () => {
    const doc = await saveNew('# Path me\n');
    await vscode.commands.executeCommand('promptComposer.copyPath', { promptId: doc.rel });
    assert.equal(await vscode.env.clipboard.readText(), `@.prompt-composer/${doc.rel}`);
  });

  test('CP-03 CP-05 Reveal shows the prompt, or the newest month of the folder, in the OS file manager', async () => {
    const doc = await saveNew('# Reveal me\n');
    const shown: string[] = [];
    const real = api.shell.reveal;
    api.shell.reveal = async (uri) => { shown.push(uri.fsPath); };
    try {
      for (const id of ['revealInOS', 'revealInFinder']) await vscode.commands.executeCommand(`promptComposer.${id}`, { promptId: doc.rel });
      for (const id of ['revealFolder', 'revealFolderInFinder']) await vscode.commands.executeCommand(`promptComposer.${id}`);
    } finally {
      api.shell.reveal = real;
    }
    const file = path.join(store(), ...doc.rel!.split('/'));
    const month = path.join(store(), monthDirs().sort().at(-1)!);
    assert.deepEqual(shown, [file, file, month, month]);
  });
});

suite('Images', () => {
  teardown(closeAll);
  const images = () => path.join(store(), 'images');

  test('IM-01 IM-02 pasted images are named by time; dropped files keep their name with -1', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const pasted = await api.images.saveBytes(bytes, 'image/png', undefined, 'paste', new Date(2026, 9, 3, 14, 16, 2));
    assert.equal(pasted, '2026-10-03-141602.png');
    const again = await api.images.saveBytes(bytes, 'image/png', undefined, 'paste', new Date(2026, 9, 3, 14, 16, 2));
    assert.equal(again, '2026-10-03-141602-1.png');
    const d1 = await api.images.saveBytes(bytes, 'image/png', 'Login Bug.png', 'drop');
    const d2 = await api.images.saveBytes(bytes, 'image/png', 'Login Bug.png', 'drop');
    assert.deepEqual([d1, d2], ['Login-Bug.png', 'Login-Bug-1.png']);
    assert.ok(fs.existsSync(path.join(images(), d2)));
  });

  test('IM-07 deleting a prompt can delete images only it used', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const own = await api.images.saveBytes(bytes, 'image/png', 'own.png', 'drop');
    const shared = await api.images.saveBytes(bytes, 'image/png', 'shared.png', 'drop');
    await saveNew(`# Keeps shared\n\n![s](../images/${shared})\n`);
    const doc = await saveNew(`# Has images\n\n![o](../images/${own})\n\n![s](../images/${shared})\n`);
    await api.library.ensureLoaded();
    await api.deletePrompt(doc.rel!, { confirm: false, deleteImages: true });
    assert.equal(fs.existsSync(path.join(images(), own)), false, 'own image deleted');
    assert.ok(fs.existsSync(path.join(images(), shared)), 'shared image kept');
  });

  test("IM-08 Don't Save on a new prompt removes images pasted into it", async () => {
    const doc = await newDoc('# Pasted then discarded\n');
    await (api.editors as unknown as { onMessage(d: PromptDoc, m: unknown): Promise<void> })
      .onMessage(doc, { type: 'saveImage', requestId: 1, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), origin: 'paste' });
    const name = [...doc.sessionImages][0].split('/').pop()!;
    assert.ok(fs.existsSync(path.join(images(), name)));
    answer("Don't Save");
    doc.panel!.dispose();
    await sleep(200);
    await api.editors.closing;
    await waitFor(() => !fs.existsSync(path.join(images(), name)), 'image removed');
  });
});

suite('Mentions index', () => {
  const entry = (p: string) => api.index.get(p);

  suiteSetup(async () => {
    fs.mkdirSync(path.join(ws(), 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(ws(), 'node_modules', 'pkg', 'index.js'), '');
    await api.index.ensureBuilt();
  });

  test('MN-01 files, folders, symlinked folders (junctions) and what is inside them', () => {
    assert.equal(entry('src/server/auth.ts')?.kind, 'file');
    assert.equal(entry('src/server')?.kind, 'dir');
    assert.equal(entry('shared')?.kind, 'dir');
    assert.ok(entry('shared')?.link, 'shared is a link');
    assert.equal(entry('shared/utils/date.ts')?.kind, 'file');
    assert.equal(entry('shared/utils/date.ts')?.via?.name, 'shared');
    assert.equal(entry('src/config/env.ts')?.kind, 'file');
    const info = JSON.parse(fs.readFileSync(path.join(ws(), '..', 'info.json'), 'utf8'));
    if (info.fileSymlinks) assert.ok(entry('CLAUDE.md')?.link);
  });

  test('MN-02 a link back to an ancestor is listed but not walked', () => {
    assert.ok(entry('src/loop'));
    assert.equal(entry('src/loop/server'), undefined);
  });

  test('MN-03 a broken link is listed and marked broken', () => {
    assert.equal(entry('broken-link')?.broken, true);
  });

  test('MN-04 .git, node_modules, .prompt-composer and files.exclude are left out', async () => {
    assert.equal(entry('node_modules'), undefined);
    assert.equal(entry('.prompt-composer'), undefined);
    await config('files', 'exclude', { '**/architecture.md': true });
    try {
      await waitFor(() => !entry('docs/architecture.md') && entry('docs/my notes.md'), 'exclude applied');
    } finally {
      await config('files', 'exclude', undefined);
    }
    await waitFor(() => entry('docs/architecture.md'), 'exclude removed');
  });

  test('MN-11 creating and deleting files updates the index, also inside a symlinked folder', async () => {
    fs.writeFileSync(path.join(ws(), 'src', 'new-file.ts'), '');
    await waitFor(() => entry('src/new-file.ts'), 'created file', 8000);
    fs.rmSync(path.join(ws(), 'src', 'new-file.ts'));
    await waitFor(() => !entry('src/new-file.ts'), 'deleted file', 8000);
    const info = JSON.parse(fs.readFileSync(path.join(ws(), '..', 'info.json'), 'utf8'));
    fs.writeFileSync(path.join(info.outside, 'shared-libs', 'common', 'linked-new.ts'), '');
    await waitFor(() => entry('shared/linked-new.ts'), 'file created in the link target', 8000);
  });

  test('MN-06 picker search ranks names first and drills into folders', () => {
    const hits = api.index.search('auth');
    assert.equal(hits[0].path, 'src/server/auth.ts');
    const inside = api.index.search('src/');
    assert.ok(inside.every((h) => h.path.startsWith('src/') && !h.path.slice(4).includes('/')));
    assert.ok(inside.some((h) => h.path === 'src/server' && h.kind === 'dir'));
  });
});
