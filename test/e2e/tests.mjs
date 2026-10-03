// The end-to-end tests (see run.mjs). Each one drives the real VS Code UI.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixtures = resolve(import.meta.dirname, '..', 'fixtures');
const pad = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ helpers

async function activeDoc(vsc) {
  const s = await vsc.state();
  return s.docs.find((d) => d.id === s.active);
}
async function waitMd(vsc, pred, what = 'markdown') {
  let last;
  return vsc.waitFor(async () => {
    const d = await activeDoc(vsc);
    last = d?.current;
    return d && pred(d.current, d) ? d : null;
  }, 8000, what).catch((e) => { throw new Error(`${e.message}; markdown was ${JSON.stringify(last)}`); });
}
async function newPrompt(vsc) {
  await vsc.command('promptComposer.newPrompt');
  await vsc.waitFor(async () => (await activeDoc(vsc)) && (await vsc.editorFrame().locator('.ProseMirror').count()) > 0, 15_000, 'new prompt editor');
  return vsc.focusEditor();
}
async function savePrompt(vsc, markdown) {
  const pm = await newPrompt(vsc);
  await pm.evaluate(() => 0);
  return { pm };
}
/** Write a prompt file directly and open it. */
async function openFile(vsc, rel, text) {
  const abs = join(vsc.ws, '.prompt-composer', ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
  await vsc.call('POST', '/open', { rel });
  await vsc.waitFor(async () => (await activeDoc(vsc))?.rel === rel, 15_000, `open ${rel}`);
  await vsc.waitFor(async () => (await vsc.editorFrame().locator('.ProseMirror').innerText()).length > 0 || !text.trim(), 10_000, 'content');
  return vsc.focusEditor();
}
const tabLabel = (vsc) => vsc.page.locator('.tabs-container .tab.active.selected .label-name').first().innerText({ timeout: 2000 });
async function waitTab(vsc, label, timeout = 6000) {
  let last = '';
  // VS Code may show a file's name without its extension in the tab
  await vsc.waitFor(async () => [label, label.replace(/\.[^.]+$/, '')].includes(last = await tabLabel(vsc).catch(() => '')), timeout, `tab "${label}"`)
    .catch((e) => { throw new Error(`${e.message} (active tab: "${last}")`); });
}
const openTextFile = (vsc, rel) => vsc.call('POST', '/openFile', { path: join(vsc.ws, ...rel.split('/')) });
async function caretToEnd(vsc) {
  await vsc.call('POST', '/focus', { at: 'end' });
  await sleep(150);
}
/** Select the first word of the first line with the keyboard. */
async function selectFirstWord(vsc) {
  await vsc.press('Control+Home');
  await vsc.press('Control+Shift+ArrowRight');
  await sleep(150);
}
const editor = (vsc) => vsc.editorFrame();
const lib = (vsc) => vsc.libraryFrame();
const css = (loc, prop, pseudo) => loc.evaluate((el, [p, ps]) => getComputedStyle(el, ps || null).getPropertyValue(p), [prop, pseudo]);
const today = new Date();
const monthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;

async function setting(vsc, section, key, value) {
  await vsc.config(section, key, value);
  await sleep(400);
}

async function contextMenu(vsc, rowLocator, item) {
  await rowLocator.click({ button: 'right' });
  const menu = vsc.page.locator('.context-view .monaco-menu');
  await menu.waitFor({ timeout: 5000 });
  const labels = (await menu.locator('.action-label').allInnerTexts()).map((l) => l.trim()).filter(Boolean);
  if (item) {
    const i = labels.indexOf(item);
    assert.ok(i >= 0, `menu has ${item}: ${labels}`);
    for (let k = 0; k <= i; k++) await vsc.page.keyboard.press('ArrowDown');
    await vsc.page.keyboard.press('Enter');
  }
  return labels;
}

// ------------------------------------------------------------------ tests

export const tests = [
  {
    name: 'PN-01 empty panel shows a welcome and a New Prompt button',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      const welcome = lib(vsc).locator('.lib-welcome');
      await welcome.waitFor();
      assert.match(await welcome.innerText(), /No prompts yet/);
      await shot('welcome');
      await lib(vsc).locator('#welcomeNew').click();
      await vsc.waitFor(async () => (await activeDoc(vsc)) && !(await activeDoc(vsc)).rel, 10_000, 'new prompt from welcome');
    },
  },
  {
    name: 'ED-01 PF-01 New Prompt opens an empty, focused editor quickly',
    async fn({ vsc, note, shot }) {
      const t0 = Date.now();
      await vsc.command('promptComposer.newPrompt');
      const pm = editor(vsc).locator('.ProseMirror');
      await pm.waitFor({ timeout: 15_000 });
      await vsc.waitFor(() => pm.evaluate((el) => el.contains(document.activeElement)), 10_000, 'caret in the editor');
      const ms = Date.now() - t0;
      note(`ready to type in ${ms} ms`);
      assert.equal(await tabLabel(vsc), 'Untitled prompt');
      assert.equal(await editor(vsc).locator('p.is-editor-empty').getAttribute('data-placeholder'), 'Write your prompt… Type / for commands, @ to mention a file');
      assert.ok(ms < 1500, `took ${ms} ms`);
      await shot('new');
    },
  },
  {
    name: 'ED-02 the tab shows the live title',
    async fn({ vsc }) {
      await newPrompt(vsc);
      await vsc.type('# Hello world');
      await vsc.waitFor(async () => (await tabLabel(vsc)) === 'Hello world', 5000, 'tab title');
    },
  },
  {
    name: 'ED-03 Markdown shortcuts convert as you type',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('## Sub');
      await vsc.press('Enter');
      await vsc.type('- item');
      await vsc.press('Enter Enter');
      await vsc.type('1. one');
      await vsc.press('Enter Enter');
      await vsc.type('[ ] task');
      await vsc.press('Enter Enter');
      await vsc.type('> quote');
      await vsc.press('Enter Enter');
      await vsc.type('text **bold** and `code` ');
      await vsc.press('Enter');
      await vsc.type('```ts ');
      await vsc.type('const a = 1;');
      const d = await waitMd(vsc, (m) => m.includes('const a = 1;'));
      await shot('shortcuts');
      assert.equal(d.current, '## Sub\n\n- item\n\n1. one\n\n- [ ] task\n\n> quote\n\ntext **bold** and `code`\n\n```ts\nconst a = 1;\n```\n');
    },
  },
  {
    name: 'ED-04 toolbar: mid by default, full, off; wraps instead of scrolling',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      const body = editor(vsc).locator('body');
      assert.match(await body.getAttribute('class'), /tb-mid/);
      const bar = editor(vsc).locator('.tt-bar');
      const r = await bar.evaluate((el) => el.getBoundingClientRect().height);
      await setting(vsc, 'promptComposer', 'toolbar', 'full');
      assert.match(await body.getAttribute('class'), /tb-full/);
      await setting(vsc, 'promptComposer', 'toolbar', 'off');
      assert.equal(await editor(vsc).locator('.tt-toolbar').isVisible(), false);
      await setting(vsc, 'promptComposer', 'toolbar', undefined);
      // narrow: put the side bar wide and the editor narrow by splitting twice
      await vsc.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900));
      await sleep(700);
      const h = await bar.evaluate((el) => el.getBoundingClientRect().height);
      const overflow = await editor(vsc).locator('.tt-toolbar').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      await shot('narrow');
      await vsc.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
      await sleep(500);
      assert.ok(h > r + 10, `wraps to more lines (${r} → ${h})`);
      assert.equal(overflow, false, 'no horizontal scrolling');
    },
  },
  {
    name: 'ED-05 bubble menu formats a selection',
    async fn({ vsc, shot }) {
      const pm = await newPrompt(vsc);
      await vsc.type('make this bold');
      void pm;
      await selectFirstWord(vsc);
      const bubble = editor(vsc).locator('#bubble');
      await vsc.waitFor(async () => (await css(bubble, 'visibility')) === 'visible' && (await bubble.isVisible()), 5000, 'bubble menu');
      await shot('bubble');
      await bubble.locator('[data-cmd="bold"]').click();
      await waitMd(vsc, (m) => m === '**make** this bold\n', 'bold applied');
    },
  },
  {
    name: 'ED-06 / commands: filter, run, remove the typed text; not mid-word',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('/');
      const slash = editor(vsc).locator('#slash');
      await slash.waitFor({ state: 'visible' });
      await vsc.type('h2');
      assert.equal((await slash.locator('button.sel .lbl').innerText()).trim(), 'Heading 2');
      await shot('slash');
      await vsc.press('Enter');
      await vsc.type('Title');
      await waitMd(vsc, (m) => m === '## Title\n', 'heading from /h2');
      await vsc.press('Enter');
      await vsc.type('src/a');
      await sleep(300);
      assert.equal(await slash.isVisible(), false, 'no menu after a word');
      await vsc.type(' /todo');
      await slash.waitFor({ state: 'visible' });
      await vsc.press('Escape');
      await sleep(200);
      assert.equal(await slash.isVisible(), false, 'Esc closes');
    },
  },
  {
    name: 'ED-07 code blocks are highlighted and the language picker writes the fence',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('```ts ');
      await vsc.type('if (x) { return "s"; }');
      const pre = editor(vsc).locator('pre').first();
      await vsc.waitFor(async () => (await pre.locator('.hljs-keyword').count()) > 0, 5000, 'highlighting');
      assert.equal(await css(pre.locator('.hljs-keyword.hljs-control').first(), 'color'), 'rgb(197, 134, 192)');
      assert.equal(await css(pre.locator('.hljs-string').first(), 'color'), 'rgb(206, 145, 120)');
      assert.match(await pre.locator('.cb-lang').innerText(), /TypeScript/);
      await pre.locator('.cb-lang').click();
      await editor(vsc).locator('#menu-lang').waitFor({ state: 'visible' });
      await shot('lang-menu');
      await editor(vsc).locator('#menu-lang [data-lang="python"]').click();
      await waitMd(vsc, (m) => m.startsWith('```python\n'), 'python fence');
    },
  },
  {
    name: 'ED-08 Alt+Up / Alt+Down move the current block',
    async fn({ vsc }) {
      await newPrompt(vsc);
      await vsc.type('first');
      await vsc.press('Enter');
      await vsc.type('second');
      await vsc.press('Alt+ArrowUp');
      await waitMd(vsc, (m) => m === 'second\nfirst\n' || m === 'second\n\nfirst\n', 'moved up');
      await vsc.press('Alt+ArrowDown');
      await waitMd(vsc, (m) => m.startsWith('first'), 'moved down');
    },
  },
  {
    name: 'ED-09 drag handle appears without a box and its menu duplicates a block',
    async fn({ vsc, shot }) {
      const pm = await newPrompt(vsc);
      await vsc.type('# Heading block');
      await vsc.press('Enter');
      await vsc.type('a paragraph');
      await pm.locator('h1').hover();
      const handle = editor(vsc).locator('#dragHandle');
      await handle.waitFor({ state: 'visible' });
      await handle.hover();
      await shot('handle-hover');
      assert.equal(await css(handle, 'background-color'), 'rgba(0, 0, 0, 0)');
      await handle.click();
      await editor(vsc).locator('#menu-block').waitFor({ state: 'visible' });
      await editor(vsc).locator('#menu-block [data-bcmd="duplicate"]').click();
      await waitMd(vsc, (m) => m === '# Heading block\n\n# Heading block\n\na paragraph\n', 'duplicated');
    },
  },
  {
    name: 'ED-10 smooth caret glides and expand-blinks; "native" turns it off',
    async fn({ vsc }) {
      await newPrompt(vsc);
      await vsc.type('abc');
      const caret = editor(vsc).locator('.pc-caret');
      await vsc.waitFor(async () => /\bshow\b/.test(await caret.getAttribute('class')), 3000, 'drawn caret');
      await vsc.waitFor(async () => /blink-expand/.test(await caret.getAttribute('class')), 3000, 'expand blink');
      assert.equal(await css(editor(vsc).locator('.ProseMirror'), 'caret-color'), 'rgba(0, 0, 0, 0)');
      await setting(vsc, 'promptComposer', 'caret', 'native');
      assert.doesNotMatch(await editor(vsc).locator('body').getAttribute('class'), /smooth-caret/);
      await setting(vsc, 'promptComposer', 'caret', undefined);
    },
  },
  {
    name: 'ED-11 line numbers count visual lines and can be turned off',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('short line');
      await vsc.press('Enter');
      await vsc.type('word '.repeat(80));
      await vsc.press('Enter');
      await vsc.press('Enter');
      await vsc.type('last');
      await sleep(400);
      const nums = await editor(vsc).locator('#lnGutter .ln').allInnerTexts();
      await shot('lines');
      assert.ok(nums.length >= 5, `visual lines numbered: ${nums.length}`);
      assert.deepEqual(nums, nums.map((_, i) => String(i + 1)));
      assert.equal(await editor(vsc).locator('#lnGutter .ln.on').innerText(), String(nums.length));
      await setting(vsc, 'promptComposer', 'lineNumbers', false);
      assert.equal(await editor(vsc).locator('#lnGutter .ln').count(), 0);
      await setting(vsc, 'promptComposer', 'lineNumbers', undefined);
    },
  },
  {
    name: 'ED-12 Ctrl+click follows a workspace link without selecting the block',
    async fn({ vsc }) {
      await openFile(vsc, `${monthKey}/01-0900-links.md`, 'See [the readme](README.md) now\n');
      await editor(vsc).locator('a').first().click({ modifiers: ['Control'] });
      await waitTab(vsc, 'README.md');
      await vsc.command('workbench.action.previousEditor');
      await sleep(300);
      assert.equal(await editor(vsc).locator('.ProseMirror-selectednode').count(), 0, 'no selection box');
    },
  },
  {
    name: 'ED-13 Ctrl+K asks for a link in VS Code\'s input box',
    async fn({ vsc, shot }) {
      const pm = await newPrompt(vsc);
      await vsc.type('docs here');
      void pm;
      await selectFirstWord(vsc);
      await vsc.press('Control+k');
      const input = vsc.page.locator('.quick-input-widget input');
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await shot('link-input');
      await vsc.page.keyboard.type('https://example.com/docs');
      await vsc.press('Enter');
      await waitMd(vsc, (m) => m === '[docs](https://example.com/docs) here\n', 'link set');
    },
  },
  {
    name: 'ED-14 Ctrl+Z / Ctrl+Y undo and redo exactly one step',
    async fn({ vsc }) {
      await newPrompt(vsc);
      await vsc.type('one');
      await sleep(700);
      await vsc.type(' two');
      await sleep(700);
      await vsc.type(' three');
      await waitMd(vsc, (m) => m === 'one two three\n');
      await sleep(700);
      await vsc.press('Control+z');
      await waitMd(vsc, (m) => m === 'one two\n', 'one undo step');
      await sleep(400);
      const d = await activeDoc(vsc);
      assert.equal(d.current, 'one two\n', 'not undone twice');
      await vsc.press('Control+y');
      await waitMd(vsc, (m) => m === 'one two three\n', 'redo');
      await vsc.press('Control+Shift+z');
      await sleep(300);
      assert.equal((await activeDoc(vsc)).current, 'one two three\n');
    },
  },
  {
    name: 'ED-14b editor shortcuts do not trigger VS Code commands (Ctrl+B, Ctrl+E, Ctrl+Shift+S)',
    async fn({ vsc }) {
      await newPrompt(vsc);
      const sidebarVisible = () => vsc.page.locator('#workbench\\.parts\\.sidebar').isVisible();
      const before = await sidebarVisible();
      await vsc.press('Control+b');
      await vsc.type('bold');
      await vsc.press('Control+b');
      await vsc.type(' plain ');
      await vsc.press('Control+e');
      await vsc.type('code');
      await vsc.press('Control+e');
      await sleep(400);
      assert.equal(await sidebarVisible(), before, 'side bar unchanged by Ctrl+B');
      assert.equal(await vsc.page.locator('.quick-input-widget').isVisible(), false, 'no Quick Open from Ctrl+E');
      await waitMd(vsc, (m) => m === '**bold** plain `code`\n', 'formatting applied');
      await vsc.press('Control+Shift+s');
      await sleep(500);
      assert.equal(await vsc.page.locator('.monaco-dialog-box, .quick-input-widget:visible').count(), 0, 'no Save As');
    },
  },
  {
    name: 'ED-15 settings apply to open editors at once',
    async fn({ vsc }) {
      await openFile(vsc, `${monthKey}/01-0901-settings.md`, 'Mention @src/server/auth.ts here\n');
      const body = editor(vsc).locator('body');
      const app = editor(vsc).locator('#app');
      assert.match(await body.getAttribute('class'), /m-icon/);
      await setting(vsc, 'promptComposer', 'mentions.style', 'at');
      assert.match(await body.getAttribute('class'), /m-at/);
      await setting(vsc, 'promptComposer', 'editor.colors', 'tiptap');
      assert.equal(await app.getAttribute('data-look'), 'tiptap');
      await setting(vsc, 'promptComposer', 'editor.width', 'readable');
      assert.doesNotMatch(await body.getAttribute('class'), /\bwide\b/);
      for (const k of ['mentions.style', 'editor.colors', 'editor.width']) await setting(vsc, 'promptComposer', k, undefined);
      assert.equal(await app.getAttribute('data-look'), 'theme');
    },
  },
  {
    name: 'ED-16 ED-18 colours follow the theme (Dark Modern values, then Light Modern)',
    async fn({ vsc, shot }) {
      await openFile(vsc, `${monthKey}/01-0902-colours.md`, '# Colours\n\nSome `inline` code and a task:\n\n- [x] done\n\n```js\nlet a = 1;\n```\n');
      const f = editor(vsc);
      assert.equal(await css(f.locator('#app'), 'background-color'), 'rgb(31, 31, 31)');
      assert.equal(await css(f.locator('pre').first(), 'background-color'), 'rgb(43, 43, 43)');
      assert.equal(await css(f.locator('p code').first(), 'background-color'), 'rgb(60, 60, 60)');
      assert.equal(await css(f.locator('.ProseMirror'), 'color'), 'rgb(204, 204, 204)');
      const box = f.locator('input[type="checkbox"]').first();
      assert.equal(await css(box, 'width'), '16px');
      assert.equal(await css(box, 'background-color'), 'rgb(0, 120, 212)');
      const border = parseFloat(await css(box, 'border-top-width'));
      const dpr = await f.locator('body').evaluate(() => window.devicePixelRatio);
      assert.ok(Math.abs(border * dpr - 2) < 0.01, `checkbox border is 2 device pixels (${border} css px at ${dpr})`);
      // floating toolbar stands apart from the page (widget colour lifted toward the text colour)
      assert.notEqual(await css(f.locator('.tt-bar'), 'background-color'), 'rgb(31, 31, 31)');
      await shot('dark');
      await setting(vsc, 'workbench', 'colorTheme', 'Default Light Modern');
      await vsc.waitFor(async () => (await css(f.locator('#app'), 'background-color')) === 'rgb(255, 255, 255)', 5000, 'light background');
      await shot('light');
      await setting(vsc, 'workbench', 'colorTheme', 'Default Dark Modern');
      await vsc.waitFor(async () => (await css(f.locator('#app'), 'background-color')) === 'rgb(31, 31, 31)', 5000, 'dark again');
    },
  },
  {
    name: 'ED-17 raw blocks show and save as typed',
    async fn({ vsc }) {
      const rel = `${monthKey}/01-0903-raw.md`;
      await openFile(vsc, rel, '| a | b |\n|---|---|\n| 1 | 2 |\n\nafter\n');
      const raw = editor(vsc).locator('pre.raw-block');
      await raw.waitFor();
      assert.match(await raw.innerText(), /\| a \| b \|/);
      await raw.click();
      await vsc.press('End');
      await vsc.type(' x');
      await vsc.press('Control+s');
      await vsc.waitFor(() => /^\|.*\| x$/m.test(readFileSync(join(vsc.ws, '.prompt-composer', ...rel.split('/')), 'utf8')), 5000, 'saved raw edit');
    },
  },
  {
    name: 'SV-01 PN-09 unsaved changes show a dot on the tab and in the panel; Ctrl+S saves',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      await newPrompt(vsc);
      await vsc.type('# Dirty marker test');
      await vsc.waitFor(async () => (await activeDoc(vsc))?.dirty, 5000, 'dirty');
      const tabIcon = await vsc.page.locator('.tabs-container .tab.active.selected .monaco-icon-label-iconpath').evaluate((el) => el.style.backgroundImage);
      assert.match(tabIcon, /tab-dirty/);
      await lib(vsc).locator('.lrow.prompt.dirty').first().waitFor();
      await shot('dirty');
      await vsc.press('Control+s');
      await vsc.waitFor(async () => !(await activeDoc(vsc)).dirty, 5000, 'saved');
      await vsc.waitFor(async () => (await lib(vsc).locator('.lrow.prompt.dirty').count()) === 0, 5000, 'panel dot cleared');
      const icon2 = await vsc.page.locator('.tabs-container .tab.active.selected .monaco-icon-label-iconpath').evaluate((el) => el.style.backgroundImage);
      assert.doesNotMatch(icon2, /tab-dirty/);
    },
  },
  {
    name: 'SV-04 Auto Save onFocusChange saves when focus leaves the prompt',
    async fn({ vsc }) {
      await setting(vsc, 'files', 'autoSave', 'onFocusChange');
      try {
        await vsc.openPanel();
        await newPrompt(vsc);
        await vsc.type('# Focus change save');
        await vsc.waitFor(async () => (await activeDoc(vsc))?.dirty, 5000, 'dirty');
        await lib(vsc).locator('#search').click();
        await vsc.waitFor(async () => { const d = (await vsc.state()).docs.find((x) => x.title === 'Focus change save'); return d?.rel && !d.dirty; }, 5000, 'saved on blur');
      } finally {
        await setting(vsc, 'files', 'autoSave', undefined);
      }
    },
  },
  {
    name: 'SV-06 closing a changed prompt asks Save / Don\'t Save (Save writes)',
    async fn({ vsc, shot }) {
      const rel = `${monthKey}/01-0904-close.md`;
      await openFile(vsc, rel, '# Close me\n');
      await caretToEnd(vsc);
      await vsc.press('Enter');
      await vsc.type('added line');
      await vsc.waitFor(async () => (await activeDoc(vsc))?.dirty, 5000, 'dirty');
      await vsc.command('workbench.action.closeActiveEditor');
      await vsc.page.locator('.monaco-dialog-box').waitFor({ timeout: 5000 });
      await shot('question');
      const text = await vsc.answerDialog('Save');
      assert.match(text, /Do you want to save the changes you made to "Close me"\?/);
      const file = join(vsc.ws, '.prompt-composer', ...rel.split('/'));
      await vsc.waitFor(() => readFileSync(file, 'utf8') === '# Close me\n\nadded line\n', 5000, 'saved')
        .catch((e) => { throw new Error(`${e.message}: file is ${JSON.stringify(readFileSync(file, 'utf8'))}`); });
    },
  },
  {
    name: 'SV-09 CE-05 unsaved changes survive a window reload',
    async fn({ vsc, shot, relaunch }) {
      const rel = `${monthKey}/01-0905-reload.md`;
      await openFile(vsc, rel, '# Reload me\n');
      await caretToEnd(vsc);
      await vsc.press('Enter');
      await vsc.type('not saved yet');
      await vsc.waitFor(async () => (await activeDoc(vsc))?.dirty, 5000, 'dirty');
      await sleep(600);
      await vsc.command('workbench.action.reloadWindow').catch(() => undefined);
      await sleep(1500);
      await vsc.ready();
      await vsc.waitFor(async () => (await vsc.state()).docs.some((d) => d.rel === rel && d.open), 20_000, 'tab restored');
      await vsc.waitFor(async () => (await editor(vsc).locator('.ProseMirror').innerText()).includes('not saved yet'), 10_000, 'draft text restored');
      const d = (await vsc.state()).docs.find((x) => x.rel === rel);
      await shot('restored');
      assert.equal(d.dirty, true);
      assert.equal(readFileSync(join(vsc.ws, '.prompt-composer', ...rel.split('/')), 'utf8'), '# Reload me\n');
      void relaunch;
    },
  },
  {
    name: 'UT-01 UT-09 double-clicking empty tab-bar space opens a prompt in that group',
    async fn({ vsc, note, shot }) {
      await openTextFile(vsc, 'README.md');
      await vsc.page.locator('.tabs-container .tab').first().waitFor();
      // watch tab labels for an "Untitled" tab appearing and how long it stays
      await vsc.page.evaluate(() => {
        window.__untitled = { seen: 0, gone: 0 };
        const check = () => {
          const has = [...document.querySelectorAll('.tabs-container .tab .label-name')].some((e) => /^Untitled-\d+$/.test(e.textContent ?? ''));
          if (has && !window.__untitled.seen) window.__untitled.seen = performance.now();
          if (!has && window.__untitled.seen && !window.__untitled.gone) window.__untitled.gone = performance.now();
        };
        new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      const tabs = vsc.page.locator('.editor-group-container.active .tabs-container');
      const box = await tabs.boundingBox();
      await vsc.page.mouse.dblclick(box.x + box.width - 40, box.y + box.height / 2);
      await waitTab(vsc, 'Untitled prompt', 8000);
      const u = await vsc.page.evaluate(() => window.__untitled);
      note(u.seen ? `Untitled tab visible for ${Math.round(u.gone - u.seen)} ms` : 'Untitled tab never rendered');
      await shot('after-dblclick');
      const labels = await vsc.page.locator('.tabs-container .tab .label-name').allInnerTexts();
      assert.ok(!labels.some((l) => /^Untitled-\d+$/.test(l)), `no Untitled tab left: ${labels}`);
      assert.equal(await vsc.page.locator('.editor-group-container').count(), 1, 'same group');
    },
  },
  {
    name: 'UT-02 double-clicking an empty editor area opens a prompt',
    async fn({ vsc }) {
      await vsc.closeAllEditors();
      const group = vsc.page.locator('.editor-group-container.empty').first();
      await group.waitFor();
      const box = await group.boundingBox();
      await vsc.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
      await vsc.waitFor(async () => (await tabLabel(vsc).catch(() => '')) === 'Untitled prompt', 8000, 'prompt tab');
    },
  },
  {
    name: 'UT-03 Ctrl+N still makes a normal text file',
    async fn({ vsc }) {
      await vsc.closeAllEditors();
      await vsc.page.locator('.monaco-workbench').click({ position: { x: 700, y: 400 } }).catch(() => undefined);
      await vsc.press('Control+n');
      await vsc.waitFor(async () => /^Untitled-\d+$/.test(await tabLabel(vsc).catch(() => '')), 5000, 'Untitled tab');
      await sleep(800);
      assert.match(await tabLabel(vsc), /^Untitled-\d+$/);
    },
  },
  {
    name: 'PN-02 PN-06 panel groups by day; click previews (reused), double-click opens',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      const a = `${monthKey}/${pad(today.getDate())}-0800-preview-a.md`;
      const b = `${monthKey}/${pad(today.getDate())}-0801-preview-b.md`;
      for (const [rel, t] of [[a, '# Preview A\n'], [b, '# Preview B\n']]) {
        mkdirSync(join(vsc.ws, '.prompt-composer', monthKey), { recursive: true });
        writeFileSync(join(vsc.ws, '.prompt-composer', ...rel.split('/')), t);
      }
      const rowA = lib(vsc).locator('.lrow.prompt', { hasText: 'Preview A' });
      const rowB = lib(vsc).locator('.lrow.prompt', { hasText: 'Preview B' });
      await rowA.waitFor({ timeout: 8000 });
      assert.ok(await lib(vsc).locator('.lrow.day', { hasText: 'Today' }).count());
      await rowA.click();
      await vsc.waitFor(async () => (await tabLabel(vsc)) === 'Preview A', 5000, 'A in preview');
      await rowB.click();
      await vsc.waitFor(async () => (await tabLabel(vsc)) === 'Preview B', 5000, 'B replaced A');
      const titles = await vsc.page.locator('.tabs-container .tab .label-name').allInnerTexts();
      assert.ok(!titles.includes('Preview A'), `preview tab reused: ${titles}`);
      await shot('preview');
      await rowA.dblclick();
      await vsc.waitFor(async () => (await tabLabel(vsc)) === 'Preview A', 5000, 'A opened');
      await vsc.waitFor(() => editor(vsc).locator('.ProseMirror').evaluate((el) => el.contains(document.activeElement)), 5000, 'caret in A');
    },
  },
  {
    name: 'PN-03 PN-04 older months are hidden until Show All Months',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      const old = new Date(today.getFullYear(), today.getMonth() - 2, 5, 9, 30);
      const om = `${old.getFullYear()}-${pad(old.getMonth() + 1)}`;
      mkdirSync(join(vsc.ws, '.prompt-composer', om), { recursive: true });
      writeFileSync(join(vsc.ws, '.prompt-composer', om, '05-0930-split-routes.md'), '# Split routes\n\n@src/server/routes.ts is too long\n');
      await lib(vsc).locator('.lib-empty-hint', { hasText: 'Older months are hidden' }).waitFor({ timeout: 8000 });
      const label = old.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      assert.equal(await lib(vsc).locator('.lrow.grp', { hasText: new RegExp(label, 'i') }).count(), 0);
      await vsc.command('promptComposer.showAllMonths');
      const grp = lib(vsc).locator('.lrow.grp', { hasText: new RegExp(label, 'i') });
      await grp.waitFor({ timeout: 5000 });
      assert.match(await grp.locator('.twistie').getAttribute('class'), /chevron-right/, 'older month starts folded');
      await shot('all-months');
      await vsc.command('promptComposer.hideOlderMonths');
      await vsc.waitFor(async () => (await grp.count()) === 0, 5000, 'hidden again');
    },
  },
  {
    name: 'PN-05 search covers every month and shows the matching line',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      const search = lib(vsc).locator('#search');
      await search.click();
      await vsc.type('routes.ts');
      await lib(vsc).locator('#count', { hasText: /found/ }).waitFor({ timeout: 5000 });
      await shot('search');
      const snip = lib(vsc).locator('.lrow.snip mark').first();
      assert.equal((await snip.innerText()).toLowerCase(), 'routes.ts');
      await vsc.press('Escape');
      await vsc.waitFor(async () => (await search.inputValue()) === '' && (await lib(vsc).locator('#count').innerText()) === '', 5000, 'Esc clears');
    },
  },
  {
    name: 'PN-07 right-click shows VS Code\'s menu; Pin adds a Pinned group',
    async fn({ vsc, shot }) {
      await vsc.openPanel();
      const row = lib(vsc).locator('.lrow.prompt', { hasText: 'Preview A' }).first();
      await row.waitFor({ timeout: 8000 });
      const labels = await contextMenu(vsc, row);
      await shot('menu');
      for (const l of ['Open', 'Open to the Side', 'Copy as Prompt', 'Copy @Path for Claude', 'Pin', 'Duplicate', 'Reveal in Explorer', 'Delete']) {
        assert.ok(labels.includes(l), `menu has ${l}: ${labels}`);
      }
      await vsc.page.keyboard.press('Escape');
      await contextMenu(vsc, row, 'Pin');
      await lib(vsc).locator('.lrow.grp', { hasText: 'Pinned' }).waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'PN-08 Collapse All folds every group',
    async fn({ vsc }) {
      await vsc.openPanel();
      await vsc.command('promptComposer.collapseAll');
      await sleep(300);
      const twisties = await lib(vsc).locator('.lrow.grp .twistie').evaluateAll((els) => els.map((e) => e.className));
      assert.ok(twisties.length > 0 && twisties.every((c) => c.includes('chevron-right')), twisties.join(' | '));
      await lib(vsc).locator('.lrow.grp').first().click();
    },
  },
  {
    name: 'PN-12 keyboard: arrows move, Enter opens',
    async fn({ vsc }) {
      await vsc.openPanel();
      await vsc.command('promptComposer.focusSearch');
      await vsc.type('Preview');
      await lib(vsc).locator('.lrow.prompt').first().waitFor();
      await lib(vsc).locator('#search').press('ArrowDown');
      await sleep(150);
      await vsc.press('Enter');
      await vsc.waitFor(async () => /^Preview/.test((await activeDoc(vsc))?.title ?? ''), 5000, 'opened from the keyboard');
      await lib(vsc).locator('#search').fill('');
      await lib(vsc).locator('#search').press('Escape');
    },
  },
  {
    name: 'MN-08 MN-09 @ picker shows names and paths; Tab drills; Enter inserts a name-only chip',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('Fix @');
      const picker = editor(vsc).locator('#picker');
      await picker.waitFor({ state: 'visible' });
      await vsc.type('auth');
      await vsc.waitFor(async () => (await picker.locator('.pk-item.sel .pk-path').innerText().catch(() => '')).startsWith('src/server/auth.ts'), 8000, 'auth.ts first');
      assert.equal((await picker.locator('.pk-item.sel .pk-name').innerText()).trim(), 'auth.ts');
      await shot('picker');
      await vsc.press('Enter');
      const chip = editor(vsc).locator('.mention').first();
      await chip.waitFor();
      assert.equal((await chip.innerText()).trim(), 'auth.ts');
      await waitMd(vsc, (m) => m === 'Fix @src/server/auth.ts\n', 'full path saved');
      // drill into a folder with Tab
      await vsc.type('and @sr');
      await vsc.waitFor(async () => (await picker.locator('.pk-item.sel .pk-name').innerText().catch(() => '')).trim() === 'src', 8000, 'src first');
      await vsc.press('Tab');
      await vsc.waitFor(async () => (await picker.locator('.tt-label').first().innerText().catch(() => '')).includes('In src'), 5000, 'inside src');
      await shot('drill');
      await vsc.press('Escape');
      // hover shows the full path
      await chip.hover();
      const hover = editor(vsc).locator('#hover');
      await hover.waitFor({ state: 'visible' });
      assert.match(await hover.innerText(), /src\/server\/auth\.ts/);
      await shot('hover');
      // Ctrl+click opens the file
      await chip.click({ modifiers: ['Control'] });
      await waitTab(vsc, 'auth.ts');
    },
  },
  {
    name: 'MN-13 @ after a letter (emails) does not open the picker; after "(" it does',
    async fn({ vsc }) {
      await newPrompt(vsc);
      await vsc.type('mail a@b');
      await sleep(400);
      assert.equal(await editor(vsc).locator('#picker').isVisible(), false);
      await vsc.type(' (@');
      await editor(vsc).locator('#picker').waitFor({ state: 'visible' });
    },
  },
  {
    name: 'MN-14 CP-04 broken mentions are flagged; the status bar counts and jumps to them',
    async fn({ vsc, shot }) {
      await openFile(vsc, `${monthKey}/01-0906-broken.md`, 'Use @src/server/auth.ts but not @src/legacy/session.ts\n');
      const broken = editor(vsc).locator('.mention.is-broken');
      await broken.waitFor();
      const item = vsc.page.locator('.statusbar-item', { hasText: /broken/ });
      await item.waitFor({ timeout: 5000 });
      assert.match(await item.innerText(), /2\s+.*1 broken/s);
      assert.ok(await vsc.page.locator('.statusbar-item', { hasText: /words · ~\d+ tokens/ }).count());
      await shot('broken');
      await item.click();
      await vsc.waitFor(async () => (await editor(vsc).locator('.mention.ProseMirror-selectednode.is-broken').count()) === 1, 5000, 'broken chip selected');
      await openTextFile(vsc, 'README.md');
      await vsc.waitFor(async () => (await vsc.page.locator('.statusbar-item', { hasText: /words · ~/ }).count()) === 0, 5000, 'hidden for text editors');
    },
  },
  {
    name: 'IM-01 IM-04 IM-05 pasting a screenshot saves it and shows it',
    async fn({ vsc, shot }) {
      await newPrompt(vsc);
      await vsc.type('# Paste test');
      await vsc.press('Enter');
      await vsc.app.evaluate(({ clipboard, nativeImage }, p) => clipboard.writeImage(nativeImage.createFromPath(p)), join(fixtures, 'red.png'));
      await vsc.press('Control+v');
      const img = editor(vsc).locator('img').first();
      await img.waitFor({ timeout: 8000 });
      await vsc.waitFor(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), 5000, 'image loaded');
      const d = await waitMd(vsc, (m) => /!\[image\]\(\.\.\/images\/\d{4}-\d{2}-\d{2}-\d{6}\.png\)/.test(m), 'image link');
      const name = /images\/([^)]+)\)/.exec(d.current)[1];
      assert.ok(existsSync(join(vsc.ws, '.prompt-composer', 'images', name)), 'file saved');
      await shot('pasted');
      await img.hover();
      await editor(vsc).locator('#hover').waitFor({ state: 'visible' });
      await img.dblclick();
      await waitTab(vsc, name);
    },
  },
  {
    name: 'MD-18 MD-19 copying gives Markdown; pasting Markdown gives formatting',
    async fn({ vsc }) {
      await openFile(vsc, `${monthKey}/01-0907-copy.md`, '# Copy\n\nSome **bold** and @src/server/auth.ts\n\n- a\n- b\n');
      await vsc.press('Control+a');
      await vsc.press('Control+c');
      await sleep(300);
      const copied = await vsc.app.evaluate(({ clipboard }) => clipboard.readText());
      assert.equal(copied, '# Copy\n\nSome **bold** and @src/server/auth.ts\n\n- a\n- b');
      await newPrompt(vsc);
      await vsc.app.evaluate(({ clipboard }) => clipboard.writeText('## Pasted\n\n- one\n- two\n\n`code` here'));
      await vsc.press('Control+v');
      await waitMd(vsc, (m) => m === '## Pasted\n\n- one\n- two\n\n`code` here\n', 'pasted Markdown');
      assert.equal(await editor(vsc).locator('h2').count(), 1);
    },
  },
  {
    name: 'PF-02 a 1,000-line prompt opens quickly',
    async fn({ vsc, note }) {
      const lines = [];
      for (let i = 0; i < 1000; i++) lines.push(i % 25 === 0 ? `## Section ${i}` : `Line ${i} with some **bold** text and @src/server/auth.ts`);
      const rel = `${monthKey}/01-0908-big.md`;
      mkdirSync(join(vsc.ws, '.prompt-composer', monthKey), { recursive: true });
      writeFileSync(join(vsc.ws, '.prompt-composer', ...rel.split('/')), lines.join('\n\n') + '\n');
      const t0 = Date.now();
      await vsc.call('POST', '/open', { rel });
      await vsc.waitFor(async () => (await editor(vsc).locator('.ProseMirror > *').count()) > 900, 15_000, 'content shown');
      const ms = Date.now() - t0;
      note(`usable in ${ms} ms`);
      assert.ok(ms < 3000, `${ms} ms`);
      const d = (await vsc.state()).docs.find((x) => x.rel === rel);
      assert.equal(d.dirty, false);
    },
  },
  {
    name: 'SV-05 Auto Save onWindowChange saves when the window loses focus',
    async fn({ vsc, skip }) {
      // Windows won't hand OS focus to a window started in the background; without it there's no focus change to observe.
      // Playwright emulates focus (the page always believes it's focused, even minimized), so no window focus change
      // can be observed here. The logic is covered by the integration test SV-05 and the manual guide.
      skip('Playwright emulates window focus; covered by the integration test and the manual guide');
      await setting(vsc, 'files', 'autoSave', 'onWindowChange');
      try {
        await newPrompt(vsc);
        await vsc.type('# Window change save');
        await vsc.waitFor(async () => (await activeDoc(vsc))?.dirty, 5000, 'dirty');
        // what VS Code hears when another app takes focus
        // move OS focus to another window, as when you switch to another app
        await vsc.app.evaluate(({ BrowserWindow }) => { const other = new BrowserWindow({ width: 300, height: 200, show: true }); other.setAlwaysOnTop(true); other.focus(); globalThis.__pcOther = other; });
        await vsc.waitFor(async () => { const d = (await vsc.state()).docs.find((x) => x.title === 'Window change save'); return d?.rel && !d.dirty; }, 6000, 'saved when the window lost focus');
      } finally {
        await vsc.app.evaluate(({ BrowserWindow }) => { globalThis.__pcOther?.destroy(); const w = BrowserWindow.getAllWindows()[0]; w.setAlwaysOnTop(true); w.focus(); w.setAlwaysOnTop(false); });
        await setting(vsc, 'files', 'autoSave', undefined);
      }
    },
  },
  {
    name: 'ST-14 without an open folder the panel explains and New Prompt asks for a folder',
    async fn({ out }) {
      const { launch } = await import('./driver.mjs');
      const empty = await launch({ ws: undefined });
      try {
        await empty.palette('View: Show Prompt Composer');
        const welcome = empty.libraryFrame().locator('.lib-welcome');
        await welcome.waitFor({ timeout: 15_000 });
        assert.match(await welcome.innerText(), /Open a folder to use Prompt Composer/);
        await empty.shot(out, 'no-folder');
        await empty.page.getByRole('button', { name: 'New Prompt', exact: true }).first().click();
        await empty.sleep(1000);
        await empty.shot(out, 'after-new-prompt');
        // toasts wait for the window to have OS focus; the notification center has it either way
        await empty.palette('Notifications: Show Notifications');
        await empty.page.locator('.notifications-center', { hasText: 'Open a folder to use Prompt Composer' }).waitFor({ timeout: 5000 });
      } finally {
        await empty.close();
      }
    },
  },
];
void savePrompt; void readdirSync;
