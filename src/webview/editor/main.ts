// The prompt editor (runs in the webview). Tiptap with the mockup's UI: toolbar, bubble menu, "/" commands,
// @ picker, code blocks with a language picker, block moving, smooth caret and line numbers.
// The extension host owns files: this page reports changes and answers "flush" requests; it never saves.
import './editor.css';
import { Editor, Extension, mergeAttributes, type JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection, PluginKey, Plugin, type Transaction } from '@tiptap/pm/state';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Mention } from '@tiptap/extension-mention';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { Suggestion, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import type { EditorInit, EditorSettings, EditorStats, EditorToHost, HostToEditor, MentionInfo, MentionItem, MentionMap, PersistState } from '../../common/protocol';
import { mentionLabel } from '../../common/mentionSyntax';
import { MarkdownReader, MarkdownWriter } from './markdown';
import { lowlight, schemaExtensions } from './nodes';
import { SKELETON } from './dom';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
const post = (m: EditorToHost) => vscode.postMessage(m);
const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });
window.addEventListener('error', (e) => log('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled rejection: ${e.reason?.stack ?? e.reason}`));

const app = document.getElementById('app')!;
app.innerHTML = SKELETON;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// 2 device pixels in CSS px, so thin lines land exactly on screen pixels at 125%/150% scaling.
const setDevicePixels = () => document.documentElement.style.setProperty('--px2', `${2 / window.devicePixelRatio}px`);
setDevicePixels();
window.addEventListener('resize', setDevicePixels);

let init: EditorInit | undefined;
let settings: EditorSettings | undefined;
let persist: PersistState | undefined;
let editor: Editor | undefined;
const reader = new MarkdownReader();
let writer: MarkdownWriter | undefined;
/** The file as loaded and how it serializes: until the user edits, report the file's exact text, so opening never changes it. */
let baseline = { original: '', serialized: '' };
let resizeObserver: ResizeObserver | undefined;
/** A focus request that arrived before the editor existed. */
let pendingFocus: 'start' | 'end' | null | undefined;
const bubbleEl = $('#bubble');
const mentionInfo = new Map<string, MentionInfo>();

// ------------------------------------------------------------------------------------------- settings

function applySettings(s: EditorSettings): void {
  settings = s;
  app.dataset.look = s.colors;
  const b = document.body.classList;
  b.remove('m-icon', 'm-at', 'm-plain');
  b.add('m-' + s.mentionStyle);
  b.toggle('show-toolbar', s.toolbar !== 'off');
  b.toggle('tb-mid', s.toolbar === 'mid');
  b.toggle('tb-full', s.toolbar === 'full');
  b.toggle('wide', s.width === 'full');
  b.toggle('smooth-caret', s.caret === 'smooth');
  b.toggle('line-numbers', s.lineNumbers);
  caretShown = false;
  scheduleCaret();
  scheduleLines();
  tidySeparators();
}

// ------------------------------------------------------------------------------------------- images

function imageSrc(path: string): string {
  if (/^(https?:|data:|blob:)/i.test(path) || !init) return path;
  try {
    return new URL(path, init.promptDirUrl).href;
  } catch {
    return path;
  }
}

// ------------------------------------------------------------------------------------------- mentions

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name);
function iconFor(path: string, info?: MentionInfo): string {
  const isDir = path.endsWith('/') || info?.kind === 'dir';
  if (info && !info.exists) return 'i-triangle-alert';
  if (info?.link) return isDir ? 'i-folder-symlink' : 'i-file-symlink';
  if (isDir) return 'i-folder';
  if (isImage(path)) return 'i-file-image';
  if (/\.(md|txt)$/i.test(path)) return 'i-file-text';
  if (/\.json$/i.test(path)) return 'i-file-json';
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|cs|cpp|c|h|rb|php|kt|swift|sh)$/i.test(path)) return 'i-file-code';
  return 'i-file';
}

function rememberMentions(map: MentionMap): void {
  for (const [k, v] of Object.entries(map)) mentionInfo.set(k, v);
  for (const v of mentionViews) v();
}

const mentionViews = new Set<() => void>();

const FileMention = Mention.extend({
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('span');
      const icon = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'mention-label';
      dom.append(icon, label);
      let current = node;
      const render = () => {
        const id = String(current.attrs.id);
        const info = mentionInfo.get(id);
        const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
        for (const [k, v] of Object.entries(attrs)) if (k !== 'class') dom.setAttribute(k, String(v));
        dom.className = ['mention', info && !info.exists ? 'is-broken' : '', id.endsWith('/') || info?.kind === 'dir' ? 'is-dir' : ''].filter(Boolean).join(' ');
        dom.dataset.path = id;
        icon.className = `ic ${iconFor(id, info)}`;
        label.textContent = mentionLabel(id);
      };
      render();
      mentionViews.add(render);
      return {
        dom,
        update: (n: PMNode) => {
          if (n.type.name !== 'mention') return false;
          current = n;
          render();
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => { mentionViews.delete(render); },
      };
    };
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => '@' + node.attrs.id,
  suggestion: {
    char: '@',
    allowedPrefixes: [' ', '(', ' '],
    allowSpaces: false,
    items: ({ query }) => queryMentions(query),
    render: () => picker,
    command: ({ editor: ed, range, props }) => {
      const item = props as unknown as { id: string };
      const after = ed.state.doc.textBetween(range.to, Math.min(range.to + 1, ed.state.doc.content.size));
      ed.chain().focus().insertContentAt(range, [
        { type: 'mention', attrs: { id: item.id, label: mentionLabel(item.id) } },
        ...(after === ' ' ? [] : [{ type: 'text', text: ' ' }]),
      ]).run();
    },
  },
});

// Each @ query goes to the host; a later answer for the same query (when indexing finishes) refreshes the list.
let mentionSeq = 0;
const pendingQueries = new Map<number, (items: MentionItem[]) => void>();
let pickerIndexing = false;
function queryMentions(query: string): Promise<MentionItem[]> {
  const seq = ++mentionSeq;
  post({ type: 'mentionQuery', seq, query });
  return new Promise((resolve) => {
    pendingQueries.set(seq, resolve);
    setTimeout(() => { if (pendingQueries.delete(seq)) resolve([]); }, 3000);
  });
}

const picker = (() => {
  const box = $('#picker');
  const list = $('#pickerList');
  let props: SuggestionProps<MentionItem> | null = null;
  let items: MentionItem[] = [];
  let sel = 0;
  const place = () => {
    const r = props?.clientRect?.();
    if (!r) return;
    const h = box.offsetHeight || 300;
    const w = box.offsetWidth || 320;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    box.style.top = top + 'px';
    box.style.left = Math.min(Math.max(8, r.left - 6), window.innerWidth - w - 8) + 'px';
  };
  const marked = (text: string, from: number, pos: number[]) => {
    let html = '';
    for (let i = 0; i < text.length; i++) html += pos.includes(from + i) ? `<b>${esc(text[i])}</b>` : esc(text[i]);
    return html;
  };
  const render = () => {
    if (!items.length) {
      list.innerHTML = `<div class="empty">${pickerIndexing ? 'Indexing files…' : 'No files or folders found'}</div>`;
    } else {
      let html = '';
      let lastGroup: string | undefined;
      items.forEach((it, i) => {
        if (it.group && it.group !== lastGroup) { html += `<div class="tt-label">${esc(it.group)}</div>`; lastGroup = it.group; }
        const nameAt = it.path.length - it.name.length;
        const path = marked(it.path, 0, it.match) + (it.kind === 'dir' ? '/' : '');
        const link = it.link ? `<span class="ic i-arrow-right"></span>${esc(it.link)}` : it.via ? '<span class="ic i-link-2" title="Inside a symlinked folder"></span>' : '';
        const info: MentionInfo = { exists: !it.broken, kind: it.kind, link: it.link, via: it.via };
        html += `<div class="pk-item${i === sel ? ' sel' : ''}" data-i="${i}" role="option" title="${esc(it.path)}${it.link ? ' → ' + esc(it.link) : ''}">` +
          `<span class="ic ${iconFor(it.kind === 'dir' ? it.path + '/' : it.path, info)}"></span><span class="pk-text"><span class="pk-name">${marked(it.name, nameAt, it.match)}</span>` +
          `<span class="pk-path">${path}${link}</span></span></div>`;
      });
      list.innerHTML = html;
      list.querySelector('.pk-item.sel')?.scrollIntoView({ block: 'nearest' });
    }
    place();
  };
  const choose = (i: number) => {
    const it = items[i];
    if (!it || !props) return;
    const id = it.kind === 'dir' ? it.path + '/' : it.path;
    mentionInfo.set(id, { exists: !it.broken, kind: it.kind, link: it.link, via: it.via });
    props.command({ id, label: it.name } as unknown as MentionItem);
  };
  const drill = (i: number) => {
    const it = items[i];
    if (!it || !props) return false;
    if (it.kind !== 'dir') { choose(i); return true; }
    props.editor.chain().focus().insertContentAt(props.range, '@' + it.path + '/').run();
    return true;
  };
  list.addEventListener('mousedown', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.pk-item');
    if (!row) return;
    ev.preventDefault();
    choose(+row.dataset.i!);
  });
  return {
    onStart(p: SuggestionProps<MentionItem>) { props = p; items = p.items || []; sel = 0; box.classList.add('show'); hideHover(); render(); },
    onUpdate(p: SuggestionProps<MentionItem>) {
      if (p.query !== props?.query) sel = 0;
      props = p;
      items = p.items || [];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      render();
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === 'Escape') { box.classList.remove('show'); return true; }
      if (!items.length) return false;
      if (event.key === 'ArrowDown') { sel = (sel + 1) % items.length; render(); return true; }
      if (event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); return true; }
      if (event.key === 'Enter') { choose(sel); return true; }
      if (event.key === 'Tab') return drill(sel);
      return false;
    },
    onExit() { box.classList.remove('show'); props = null; items = []; },
    /** New results for the query on screen (the index finished building). */
    refresh(next: MentionItem[]) { if (props) { items = next; sel = Math.min(sel, Math.max(0, items.length - 1)); render(); } },
    get open() { return box.classList.contains('show'); },
  };
})();

// ------------------------------------------------------------------------------------------- code blocks

const LANGS: [string, string][] = [
  ['plaintext', 'Plain text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'],
  ['diff', 'Diff'], ['go', 'Go'], ['xml', 'HTML / XML'], ['java', 'Java'], ['javascript', 'JavaScript'], ['json', 'JSON'],
  ['kotlin', 'Kotlin'], ['markdown', 'Markdown'], ['php', 'PHP'], ['python', 'Python'], ['ruby', 'Ruby'], ['rust', 'Rust'],
  ['sql', 'SQL'], ['swift', 'Swift'], ['typescript', 'TypeScript'], ['yaml', 'YAML'],
];
const ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', py: 'python',
  yml: 'yaml', html: 'xml', md: 'markdown', rs: 'rust', cs: 'csharp', 'c++': 'cpp', text: 'plaintext', txt: 'plaintext',
};
const langLabel = (l: string | null) => LANGS.find(([id]) => id === (ALIASES[l ?? ''] ?? l))?.[1] ?? l ?? 'Plain text';

let langTarget: (() => number | undefined) | null = null;
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('pre');
      const btn = document.createElement('button');
      btn.className = 'cb-lang';
      btn.contentEditable = 'false';
      btn.title = 'Change language';
      btn.tabIndex = -1;
      const code = document.createElement('code');
      dom.append(btn, code);
      const sync = (n: PMNode) => {
        btn.innerHTML = `${esc(langLabel(n.attrs.language))}<span class="ic i-chevron-down"></span>`;
        code.className = n.attrs.language ? 'language-' + n.attrs.language : '';
      };
      sync(node);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); openLangMenu(btn, getPos as () => number | undefined); });
      return {
        dom,
        contentDOM: code,
        update: (n: PMNode) => { if (n.type.name !== 'codeBlock') return false; sync(n); return true; },
        stopEvent: (e: Event) => btn.contains(e.target as Node),
        ignoreMutation: (m: MutationRecord | { type: 'selection'; target: Node }) => m.type !== 'selection' && btn.contains(m.target as Node),
      };
    };
  },
}).configure({ lowlight, defaultLanguage: null });

function openLangMenu(btn: HTMLElement, getPos: () => number | undefined): void {
  if (!editor) return;
  const menu = $('#menu-lang');
  const pos = getPos();
  if (pos === undefined) return;
  const lang = editor.state.doc.nodeAt(pos)?.attrs.language as string | null;
  const current = ALIASES[lang ?? ''] ?? lang ?? 'plaintext';
  menu.innerHTML = LANGS.map(([id, label]) => `<button data-lang="${id}" class="${id === current ? 'on' : ''}"><span class="lbl">${esc(label)}</span>${id === current ? '<span class="ic i-check"></span>' : ''}</button>`).join('');
  closeMenus();
  langTarget = getPos;
  const r = btn.getBoundingClientRect();
  menu.classList.add('show');
  const h = menu.offsetHeight;
  menu.style.top = (r.bottom + 4 + h <= window.innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
  menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
$('#menu-lang').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
  if (!b || !langTarget || !editor) return;
  const pos = langTarget();
  if (pos === undefined) return;
  const lang = b.dataset.lang === 'plaintext' ? null : b.dataset.lang!;
  editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'language', lang));
  closeMenus();
  editor.commands.focus();
});

// ------------------------------------------------------------------------------------------- moving blocks

function blockAt(ed: Editor, $pos: ReturnType<PMNode['resolve']>): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') return $pos.before(d);
  }
  return $pos.depth >= 1 ? $pos.before(1) : null;
}
function selectedBlock(ed: Editor): number | null {
  const sel = ed.state.selection;
  if (sel instanceof NodeSelection && sel.node.isBlock) return sel.from;
  return blockAt(ed, sel.$from);
}
/** Swap the block at `pos` with its previous/next sibling. */
function moveTr(ed: Editor, pos: number, dir: -1 | 1): { tr: Transaction; shift: number; target: number } | null {
  const { state } = ed;
  const $pos = state.doc.resolve(pos);
  const node = $pos.nodeAfter;
  const parent = $pos.parent;
  const index = $pos.index();
  if (!node || index + dir < 0 || index + dir >= parent.childCount) return null;
  const sibling = parent.child(index + dir);
  const target = dir < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  const tr = state.tr.delete(pos, pos + node.nodeSize).insert(target, node);
  return { tr, shift: target - pos, target };
}
function moveSelectedBlock(ed: Editor, dir: -1 | 1): boolean {
  const pos = selectedBlock(ed);
  if (pos == null) return true;
  const moved = moveTr(ed, pos, dir);
  if (!moved) return true;
  const { tr, shift } = moved;
  const sel = ed.state.selection;
  tr.setSelection(sel instanceof NodeSelection
    ? NodeSelection.create(tr.doc, sel.from + shift)
    : TextSelection.create(tr.doc, sel.anchor + shift, sel.head + shift));
  ed.view.dispatch(tr.scrollIntoView());
  return true;
}
const MoveBlocks = Extension.create({
  name: 'moveBlocks',
  addKeyboardShortcuts() {
    return { 'Alt-ArrowUp': () => moveSelectedBlock(this.editor, -1), 'Alt-ArrowDown': () => moveSelectedBlock(this.editor, 1) };
  },
});

// ------------------------------------------------------------------------------------------- "/" commands

interface SlashItem { cmd: string; label: string; icon: string; hint?: string; keys: string; group: string }
const SLASH_ITEMS: SlashItem[] = [
  { cmd: 'paragraph', label: 'Text', icon: 'i-pilcrow', keys: 'text paragraph plain body', group: 'Basic blocks' },
  { cmd: 'h1', label: 'Heading 1', icon: 'i-heading-1', hint: '#', keys: 'h1 heading title', group: 'Basic blocks' },
  { cmd: 'h2', label: 'Heading 2', icon: 'i-heading-2', hint: '##', keys: 'h2 heading subtitle', group: 'Basic blocks' },
  { cmd: 'h3', label: 'Heading 3', icon: 'i-heading-3', hint: '###', keys: 'h3 heading', group: 'Basic blocks' },
  { cmd: 'bulletList', label: 'Bullet list', icon: 'i-list', hint: '-', keys: 'bullet list unordered ul', group: 'Basic blocks' },
  { cmd: 'orderedList', label: 'Numbered list', icon: 'i-list-ordered', hint: '1.', keys: 'numbered ordered list ol', group: 'Basic blocks' },
  { cmd: 'taskList', label: 'Task list', icon: 'i-list-todo', hint: '[ ]', keys: 'task todo checkbox checklist', group: 'Basic blocks' },
  { cmd: 'blockquote', label: 'Quote', icon: 'i-text-quote', hint: '>', keys: 'quote blockquote', group: 'Basic blocks' },
  { cmd: 'codeBlock', label: 'Code block', icon: 'i-square-code', hint: '```', keys: 'code block snippet', group: 'Basic blocks' },
  { cmd: 'hr', label: 'Divider', icon: 'i-minus', hint: '---', keys: 'divider line separator hr rule', group: 'Basic blocks' },
  { cmd: 'mention', label: 'File or folder', icon: 'i-at-sign', hint: '@', keys: 'file folder mention reference', group: 'Reference' },
  { cmd: 'image', label: 'Image', icon: 'i-image-plus', keys: 'image picture screenshot photo img', group: 'Reference' },
];
function slashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS
    .map((it) => {
      const label = it.label.toLowerCase();
      const score = label.startsWith(q) ? 3 : it.keys.split(' ').some((k) => k.startsWith(q)) ? 2 : label.includes(q) ? 1 : 0;
      return { it, score };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

const slashMenu = (() => {
  const box = $('#slash');
  const list = $('#slashList');
  let props: SuggestionProps<SlashItem> | null = null;
  let items: SlashItem[] = [];
  let sel = 0;
  const render = () => {
    if (!items.length) list.innerHTML = '<div class="empty">No matching command</div>';
    else {
      let html = '';
      let lastGroup: string | null = null;
      items.forEach((it, i) => {
        if (!props?.query && it.group !== lastGroup) { html += `<div class="tt-label">${it.group}</div>`; lastGroup = it.group; }
        html += `<button class="${i === sel ? 'sel' : ''}" data-i="${i}" role="option" tabindex="-1"><span class="ic ${it.icon}"></span><span class="lbl">${it.label}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`;
      });
      list.innerHTML = html;
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    const r = props?.clientRect?.();
    if (!r) return;
    const h = box.offsetHeight;
    const w = box.offsetWidth;
    box.style.top = (r.bottom + 6 + h <= window.innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
    box.style.left = Math.min(Math.max(8, r.left - 6), window.innerWidth - w - 8) + 'px';
  };
  list.addEventListener('mousedown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b || !props) return;
    e.preventDefault();
    props.command(items[+b.dataset.i!]);
  });
  return {
    onStart(p: SuggestionProps<SlashItem>) { props = p; items = p.items || []; sel = 0; box.classList.add('show'); hideHover(); render(); },
    onUpdate(p: SuggestionProps<SlashItem>) { if (p.query !== props?.query) sel = 0; props = p; items = p.items || []; sel = Math.min(sel, Math.max(0, items.length - 1)); render(); },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === 'Escape') { box.classList.remove('show'); return true; }
      if (!items.length) return false;
      if (event.key === 'ArrowDown') { sel = (sel + 1) % items.length; render(); return true; }
      if (event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); return true; }
      if ((event.key === 'Enter' || event.key === 'Tab') && props) { props.command(items[sel]); return true; }
      return false;
    },
    onExit() { box.classList.remove('show'); props = null; items = []; },
  };
})();

const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [Suggestion<SlashItem>({
      editor: this.editor,
      char: '/',
      pluginKey: new PluginKey('slashCommands'),
      allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
      items: ({ query }) => slashItems(query),
      render: () => slashMenu,
      // remove the typed "/query", then run the chosen command on the now-empty spot
      command: ({ editor: ed, range, props }) => { ed.chain().focus().deleteRange(range).run(); run(props.cmd); },
    })];
  },
});

// Undo/redo come only from VS Code (Ctrl+Z/Y reach VS Code, which calls document.execCommand('undo')
// in this page). Tiptap's own Mod-z binding would undo a second time, so it's switched off.
const History = UndoRedo.extend({ addKeyboardShortcuts: () => ({}) });

/** Keep positions of images still being saved by the host as the document changes. */
const pendingImages = new Map<number, { pos: number; alt: string }>();
const TrackPending = Extension.create({
  name: 'trackPendingImages',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (trs) => {
        for (const tr of trs) if (tr.docChanged) for (const p of pendingImages.values()) p.pos = tr.mapping.map(p.pos);
        return null;
      },
    })];
  },
});

// ------------------------------------------------------------------------------------------- editor

function createEditor(markdown: string): void {
  editor?.destroy();
  resizeObserver?.disconnect();
  mentionViews.clear();
  // Tiptap's bubble menu takes its element out of the page when the editor is destroyed: put it back.
  if (!bubbleEl.isConnected) $('#holder').appendChild(bubbleEl);
  const extensions = [
    ...schemaExtensions({ mention: FileMention, codeBlock: CodeBlock }),
    History,
    MoveBlocks,
    TrackPending,
    Placeholder.configure({ placeholder: 'Write your prompt… Type / for commands, @ to mention a file' }),
    BubbleMenu.configure({
      element: bubbleEl,
      options: { placement: 'top', offset: 8 },
      shouldShow: ({ editor: ed, state, from, to }) => {
        if (!ed.isFocused && !bubbleEl.contains(document.activeElement)) return false;
        if (state.selection.empty || !(state.selection instanceof TextSelection)) return false;
        if (ed.isActive('codeBlock') || ed.isActive('rawBlock') || !state.doc.textBetween(from, to).trim()) return false;
        return true;
      },
    }),
    SlashCommands,
  ];
  const parsed = reader.parse(markdown, { mentions: Object.fromEntries(mentionInfo), imageSrc });
  $('#editor').innerHTML = '';
  editor = new Editor({
    element: $('#editor'),
    extensions,
    content: parsed.json,
    editorProps: {
      attributes: { spellcheck: 'false' },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          void addImages(files, view.state.selection.from, 'paste');
          return true;
        }
        // Text copied from VS Code's own editors arrives as coloured HTML; take the plain text as Markdown instead.
        const types = event.clipboardData?.types ?? [];
        if (types.includes('vscode-editor-data') && !view.state.selection.$from.parent.type.spec.code) {
          const text = event.clipboardData!.getData('text/plain');
          view.dispatch(view.state.tr.replaceSelection(markdownSlice(text)).scrollIntoView());
          return true;
        }
        return false;
      },
      clipboardTextParser: (text) => markdownSlice(text),
      clipboardTextSerializer: (slice) => {
        if (!editor || !writer) return slice.content.textBetween(0, slice.content.size, '\n');
        try {
          const doc = editor.schema.topNodeType.create(null, slice.content);
          return writer.serialize(doc).replace(/\n$/, '');
        } catch {
          return slice.content.textBetween(0, slice.content.size, '\n');
        }
      },
      // ProseMirror selects the whole block on Ctrl/Cmd+click. In VS Code that gesture means "follow".
      handleClick: (_view, _pos, event) => event.ctrlKey || event.metaKey,
      handleDrop: (view, event) => {
        hideDropHint();
        const dt = (event as DragEvent).dataTransfer;
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? view.state.selection.to;
        // Files dragged from VS Code's Explorer (with Shift) arrive as URIs: insert them as @mentions.
        const uris = (dt?.getData('application/vnd.code.uri-list') || dt?.getData('text/uri-list') || '').split(/\r?\n/).filter((u) => u && !u.startsWith('#'));
        const rels = uris.map(workspaceRel).filter((p): p is string => !!p);
        if (rels.length) {
          const nodes: JSONContent[] = [];
          for (const p of rels) nodes.push({ type: 'mention', attrs: { id: p, label: mentionLabel(p) } }, { type: 'text', text: ' ' });
          editor!.chain().focus().insertContentAt(at, nodes).run();
          post({ type: 'resolveMentions', paths: rels });
          return true;
        }
        const files = [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        void addImages(files, at, 'drop');
        return true;
      },
    },
    onUpdate: () => { scheduleChanged(); updateToolbar(); },
    onSelectionUpdate: () => updateToolbar(),
    onFocus: () => post({ type: 'focusChanged', focused: true }),
    onBlur: () => post({ type: 'focusChanged', focused: false }),
  });
  writer = new MarkdownWriter(editor.schema, reader);
  writer.remember(editor.state.doc, parsed.sources);
  baseline = { original: markdown, serialized: writer.serialize(editor.state.doc) };
  lastSent = serialize();
  for (const ev of ['selectionUpdate', 'update', 'focus', 'blur'] as const) editor.on(ev, scheduleCaret);
  for (const ev of ['update', 'selectionUpdate', 'focus', 'blur'] as const) editor.on(ev, scheduleLines);
  resizeObserver = new ResizeObserver(() => { caretShown = false; scheduleCaret(); scheduleLines(); });
  resizeObserver.observe(editor.view.dom);
  editor.view.dom.addEventListener('keydown', () => hideHandle());
  updateToolbar();
  scheduleLines();
  report(false);
}

function markdownSlice(text: string): Slice {
  const parsed = reader.parse(text, { mentions: Object.fromEntries(mentionInfo), imageSrc });
  const doc = editor!.schema.nodeFromJSON(parsed.json);
  // unknown @paths in pasted text: ask the host what they are
  const paths: string[] = [];
  doc.descendants((n) => { if (n.type.name === 'mention' && !mentionInfo.has(n.attrs.id)) paths.push(n.attrs.id); });
  if (paths.length) post({ type: 'resolveMentions', paths });
  return Slice.maxOpen(doc.content);
}

/** "file:///…/workspace/src/a.ts" → "src/a.ts" (folders get a trailing slash when the URI has one). */
function workspaceRel(uri: string): string | undefined {
  if (!init) return undefined;
  const base = init.workspaceFileUri.toLowerCase();
  const u = uri.trim();
  if (!u.toLowerCase().startsWith(base)) return undefined;
  try {
    return decodeURIComponent(u.slice(base.length));
  } catch {
    return u.slice(base.length);
  }
}

// ------------------------------------------------------------------------------------------- reporting changes

let lastSent = '';
let changeTimer: number | undefined;
function serialize(): string {
  if (!editor || !writer) return '';
  const md = writer.serialize(editor.state.doc);
  return md === baseline.serialized ? baseline.original : md;
}

/** First non-empty line of text (mentions as @path), at most 80 characters. Mirrors the host's titleOf. */
function titleOfDoc(doc: PMNode): string {
  let title = '';
  doc.descendants((node) => {
    if (title) return false;
    if (node.isTextblock && node.type.name !== 'rawBlock') {
      let line = '';
      node.forEach((c) => {
        if (line.includes('\n')) return;
        if (c.type.name === 'hardBreak') line += '\n';
        else if (c.type.name === 'mention') line += '@' + c.attrs.id;
        else if (c.isText) line += c.text;
      });
      line = (node.type.name === 'codeBlock' ? line.split('\n').find((l) => l.trim()) ?? '' : line.split('\n')[0]).replace(/\s+/g, ' ').trim();
      if (line) title = line.length > 80 ? line.slice(0, 80).trimEnd() : line;
      return false;
    }
    return true;
  });
  return title;
}

function stats(doc: PMNode, markdown: string): EditorStats {
  let mentions = 0;
  let broken = 0;
  let images = 0;
  doc.descendants((n) => {
    if (n.type.name === 'mention') {
      mentions++;
      if (mentionInfo.get(n.attrs.id)?.exists === false) broken++;
    }
    if (n.type.name === 'image') images++;
  });
  const words = doc.textContent.trim().split(/\s+/).filter(Boolean).length;
  return { mentions, broken, images, words, chars: markdown.length };
}

/** Send the current Markdown to the host (and keep it in the webview state for reloads). */
function report(force: boolean): void {
  if (!editor) return;
  window.clearTimeout(changeTimer);
  changeTimer = undefined;
  const markdown = serialize();
  if (!force && markdown === lastSent && persist) {
    post({ type: 'changed', markdown, title: titleOfDoc(editor.state.doc), stats: stats(editor.state.doc, markdown) });
    return;
  }
  lastSent = markdown;
  if (persist) vscode.setState({ ...persist, markdown });
  post({ type: 'changed', markdown, title: titleOfDoc(editor.state.doc), stats: stats(editor.state.doc, markdown) });
}
// Every change is sent at once (only the edited block is re-serialized, so it's cheap). Batching would lose the
// last keystrokes when a tab is closed right after typing: a closed webview can't be asked for them any more.
function scheduleChanged(): void {
  report(true);
}

// ------------------------------------------------------------------------------------------- images

let imageSeq = 0;
const imageWaiters = new Map<number, (path: string | undefined) => void>();
async function addImages(files: File[], at: number, origin: 'paste' | 'drop'): Promise<void> {
  for (const file of files) {
    const requestId = ++imageSeq;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const alt = origin === 'paste' || !file.name ? 'image' : file.name.replace(/\.[^.]+$/, '');
    pendingImages.set(requestId, { pos: at, alt });
    post({ type: 'saveImage', requestId, name: origin === 'drop' ? file.name : undefined, mime: file.type, bytes, origin });
    const path = await new Promise<string | undefined>((resolve) => imageWaiters.set(requestId, resolve));
    const pending = pendingImages.get(requestId)!;
    pendingImages.delete(requestId);
    if (!path || !editor) continue;
    const pos = Math.min(pending.pos, editor.state.doc.content.size);
    editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: imageSrc(path), alt: pending.alt, path } }).run();
  }
}

// ------------------------------------------------------------------------------------------- hover + Ctrl+click

let hoverTimer: number | undefined;
const hoverEl = $('#hover');
function hideHover(): void { window.clearTimeout(hoverTimer); hoverEl.classList.remove('show'); }
function showHoverFor(el: HTMLElement): void {
  const mod = init?.isMac ? 'Cmd' : 'Ctrl';
  let html = '';
  if (el.classList.contains('mention')) {
    const id = el.dataset.path ?? '';
    const info = mentionInfo.get(id);
    const broken = info?.exists === false;
    const isDir = id.endsWith('/') || info?.kind === 'dir';
    html += `<div class="hc-title"><span class="ic ${iconFor(id, info)}"></span>${esc(mentionLabel(id))}</div><div class="hc-path">${esc(id)}</div>`;
    if (broken) html += '<div class="hc-sub warn"><span class="ic i-triangle-alert"></span>Not found in the workspace. Moved or deleted?</div>';
    if (info?.link) html += `<div class="hc-sub"><span class="ic i-link-2"></span>Symlink to ${esc(info.link)}</div>`;
    else if (info?.via) html += `<div class="hc-sub"><span class="ic i-link-2"></span>Inside symlinked ${esc(info.via.name)} → ${esc(info.via.link)}</div>`;
    if (info?.thumb) html += `<img class="thumb" src="${esc(info.thumb)}" alt="">`;
    html += `<div class="hc-foot">${broken ? 'Backspace to remove' : isDir ? `${mod}+click to reveal in Explorer` : `${mod}+click to open`}</div>`;
  } else if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    html += `<div class="hc-title"><span class="ic i-link"></span>${esc(el.textContent ?? '')}</div><div class="hc-path">${esc(href)}</div><div class="hc-foot">Follow link (${mod} + click)</div>`;
  } else {
    const p = el.dataset.path ?? el.getAttribute('src') ?? '';
    html += `<div class="hc-title"><span class="ic i-file-image"></span>${esc(decodeURIComponent(p.split('/').pop() ?? ''))}</div><div class="hc-path">${esc(p)}</div><div class="hc-foot">Click to zoom</div>`;
  }
  hoverEl.innerHTML = html;
  hoverEl.classList.add('show');
  const r = el.getBoundingClientRect();
  const h = hoverEl.offsetHeight;
  const w = hoverEl.offsetWidth;
  let top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  hoverEl.style.top = top + 'px';
  hoverEl.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
}
const editorRoot = $('#editor');
const HOVERABLE = '.mention, img, a[href]';
editorRoot.addEventListener('mouseover', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(HOVERABLE);
  // not while a menu or a selection (and its bubble menu) is showing
  if (!el || picker.open || (editor && editor.state.selection instanceof TextSelection && !editor.state.selection.empty)) return;
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => showHoverFor(el), 350);
});
editorRoot.addEventListener('mouseout', (ev) => { if ((ev.target as HTMLElement).closest(HOVERABLE)) hideHover(); });
editorRoot.addEventListener('click', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const link = (ev.target as HTMLElement).closest('a[href]');
  if (link) { ev.preventDefault(); hideHover(); post({ type: 'openLink', href: link.getAttribute('href')! }); return; }
  const el = (ev.target as HTMLElement).closest<HTMLElement>('.mention');
  if (el?.dataset.path) { hideHover(); post({ type: 'openMention', path: el.dataset.path }); }
});
editorRoot.addEventListener('click', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.button !== 0) return;
  const img = (ev.target as HTMLElement).closest<HTMLImageElement>('.ProseMirror img');
  if (img?.complete && img.naturalWidth) openViewer(img);
});

// ------------------------------------------------------------------------------------------- image viewer
// Click an image to see it larger: zoom with the buttons or the scroll wheel, drag to move, Esc or ✕ to close.
const iv = $('#imgView');
const ivScroll = $('#ivScroll');
const ivImg = $<HTMLImageElement>('#ivImg');
const ivPct = $('#ivPct');
let ivScale = 1;
/** Resize to `scale`, keeping the image point under `at` (client coordinates) where it is; no `at`: just resize. */
function ivZoom(scale: number, at?: { x: number; y: number }): void {
  const before = ivImg.getBoundingClientRect();
  ivScale = Math.min(8, Math.max(0.05, scale));
  ivImg.style.width = `${ivImg.naturalWidth * ivScale}px`;
  ivImg.style.height = `${ivImg.naturalHeight * ivScale}px`;
  ivPct.textContent = `${Math.round(ivScale * 100)}%`;
  if (!at || !before.width) return;
  const after = ivImg.getBoundingClientRect();
  ivScroll.scrollLeft += after.left + ((at.x - before.left) / before.width) * after.width - at.x;
  ivScroll.scrollTop += after.top + ((at.y - before.top) / before.height) * after.height - at.y;
}
const ivCentre = () => { const b = ivScroll.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
function openViewer(img: HTMLImageElement): void {
  hideHover();
  iv.hidden = false;
  ivImg.alt = img.alt;
  ivImg.style.visibility = 'hidden'; // until it's fitted, so it never flashes at full size
  ivPct.textContent = '';
  ivImg.onload = () => {
    // fit the window (never enlarge past 100%), centred
    ivZoom(Math.min(1, (ivScroll.clientWidth - 48) / ivImg.naturalWidth, (ivScroll.clientHeight - 96) / ivImg.naturalHeight));
    ivImg.style.visibility = '';
  };
  ivImg.src = img.currentSrc || img.src;
  // focus leaves the prompt (typing can't change it behind the viewer); Esc still reaches us
  iv.focus();
}
function closeViewer(): void {
  if (iv.hidden) return;
  iv.hidden = true;
  ivImg.onload = null;
  ivImg.removeAttribute('src');
  editor?.commands.focus();
}
iv.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-iv]');
  if (b?.dataset.iv === 'close') closeViewer();
  else if (b) ivZoom(ivScale * (b.dataset.iv === 'in' ? 1.25 : 0.8), ivCentre());
});
ivScroll.addEventListener('wheel', (e) => {
  e.preventDefault();
  ivZoom(ivScale * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
}, { passive: false });
let ivDrag: { x: number; y: number; left: number; top: number } | undefined;
ivScroll.addEventListener('pointerdown', (e) => {
  const b = ivScroll.getBoundingClientRect();
  // leave the scrollbars alone
  if (e.button !== 0 || e.clientX - b.left >= ivScroll.clientWidth || e.clientY - b.top >= ivScroll.clientHeight) return;
  e.preventDefault();
  ivDrag = { x: e.clientX, y: e.clientY, left: ivScroll.scrollLeft, top: ivScroll.scrollTop };
  ivScroll.setPointerCapture(e.pointerId);
  ivScroll.classList.add('dragging');
});
ivScroll.addEventListener('pointermove', (e) => {
  if (!ivDrag) return;
  ivScroll.scrollLeft = ivDrag.left - (e.clientX - ivDrag.x);
  ivScroll.scrollTop = ivDrag.top - (e.clientY - ivDrag.y);
});
const ivEndDrag = () => { ivDrag = undefined; ivScroll.classList.remove('dragging'); };
ivScroll.addEventListener('pointerup', ivEndDrag);
ivScroll.addEventListener('pointercancel', ivEndDrag);
window.addEventListener('keydown', (e) => {
  if (iv.hidden || e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeViewer();
}, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Control' || e.key === 'Meta') document.body.classList.add('ctrl'); });
window.addEventListener('keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') document.body.classList.remove('ctrl'); });
window.addEventListener('blur', () => document.body.classList.remove('ctrl'));
$('#scroller').addEventListener('scroll', () => { hideHover(); closeMenus(); });

// drop hint (VS Code needs Shift to drop Explorer files into a webview)
function hideDropHint(): void { $('#dropHint').classList.remove('show'); }
app.addEventListener('dragover', (e) => {
  const types = [...(e.dataTransfer?.types ?? [])];
  if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('application/vnd.code.uri-list')) return;
  if ((e.target as HTMLElement).closest('#dragHandle')) return;
  $('#dropHint').classList.add('show');
  $('#dropHintText').textContent = types.includes('Files') && !types.includes('application/vnd.code.uri-list')
    ? 'Drop images to save them in .prompt-composer/images/'
    : 'Drop to insert @mentions';
});
app.addEventListener('dragleave', (e) => { if (!app.contains(e.relatedTarget as Node)) hideDropHint(); });
window.addEventListener('drop', hideDropHint);
window.addEventListener('dragend', hideDropHint);

// ------------------------------------------------------------------------------------------- commands, toolbar, menus

let linkSeq = 0;
const linkWaiters = new Map<number, (href: string | null) => void>();
async function askLink(): Promise<void> {
  if (!editor) return;
  const range = { from: editor.state.selection.from, to: editor.state.selection.to };
  const requestId = ++linkSeq;
  post({ type: 'askLink', requestId, current: editor.getAttributes('link').href ?? '' });
  const href = await new Promise<string | null>((resolve) => linkWaiters.set(requestId, resolve));
  if (href === null || !editor) { editor?.commands.focus(); return; }
  const c = editor.chain().focus().setTextSelection(range).extendMarkRange('link');
  if (!href) { c.unsetLink().run(); return; }
  if (range.from === range.to && !editor.isActive('link')) {
    editor.chain().focus().insertContentAt(range.from, { type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    return;
  }
  c.setLink({ href }).run();
}

function run(cmd: string): unknown {
  if (!editor) return;
  const c = editor.chain().focus();
  switch (cmd) {
    case 'bold': return c.toggleBold().run();
    case 'italic': return c.toggleItalic().run();
    case 'strike': return c.toggleStrike().run();
    case 'code': return c.toggleCode().run();
    case 'paragraph': return c.setParagraph().run();
    case 'h1': return c.toggleHeading({ level: 1 }).run();
    case 'h2': return c.toggleHeading({ level: 2 }).run();
    case 'h3': return c.toggleHeading({ level: 3 }).run();
    case 'bulletList': return c.toggleBulletList().run();
    case 'orderedList': return c.toggleOrderedList().run();
    case 'taskList': return c.toggleTaskList().run();
    case 'blockquote': return c.toggleBlockquote().run();
    case 'codeBlock': return c.toggleCodeBlock().run();
    case 'hr': return c.setHorizontalRule().run();
    case 'clear': return c.unsetAllMarks().clearNodes().run();
    case 'mention': {
      const { $from } = editor.state.selection;
      const needsSpace = $from.parentOffset > 0 && !/\s$/.test($from.parent.textBetween(0, $from.parentOffset));
      return c.insertContent(needsSpace ? ' @' : '@').run();
    }
    case 'image': return post({ type: 'pickImage' });
    case 'link': return askLink();
  }
}
const isOn: Record<string, () => boolean> = {
  bold: () => !!editor?.isActive('bold'), italic: () => !!editor?.isActive('italic'), strike: () => !!editor?.isActive('strike'),
  code: () => !!editor?.isActive('code'), link: () => !!editor?.isActive('link'),
  blockquote: () => !!editor?.isActive('blockquote'), codeBlock: () => !!editor?.isActive('codeBlock'),
  bulletList: () => !!editor?.isActive('bulletList'), orderedList: () => !!editor?.isActive('orderedList'), taskList: () => !!editor?.isActive('taskList'),
  h1: () => !!editor?.isActive('heading', { level: 1 }), h2: () => !!editor?.isActive('heading', { level: 2 }), h3: () => !!editor?.isActive('heading', { level: 3 }),
  paragraph: () => !!editor?.isActive('paragraph') && !editor.isActive('bulletList') && !editor.isActive('orderedList') && !editor.isActive('taskList'),
};
function updateToolbar(): void {
  if (!editor) return;
  document.querySelectorAll<HTMLElement>('#toolbar [data-cmd], #bubble [data-cmd], .tt-menu [data-cmd]').forEach((b) => {
    b.classList.toggle('on', !!isOn[b.dataset.cmd!]?.());
  });
  const level = [1, 2, 3].find((l) => editor!.isActive('heading', { level: l }));
  const hBtn = $('#toolbar [data-dd="heading"]');
  hBtn.querySelector('[data-icon]')!.className = `ic ${level ? 'i-heading-' + level : 'i-heading'}`;
  hBtn.classList.toggle('on', !!level);
  const list = ['taskList', 'orderedList', 'bulletList'].find((t) => editor!.isActive(t));
  const lBtn = $('#toolbar [data-dd="list"]');
  lBtn.querySelector('[data-icon]')!.className = `ic ${({ taskList: 'i-list-todo', orderedList: 'i-list-ordered' } as Record<string, string>)[list ?? ''] ?? 'i-list'}`;
  lBtn.classList.toggle('on', !!list);
}

// When the toolbar wraps, hide separators that would dangle at a line break.
function tidySeparators(): void {
  const seps = [...document.querySelectorAll<HTMLElement>('#toolbar .tt-sep')];
  seps.forEach((s) => { s.style.display = ''; });
  seps.forEach((s) => {
    const prev = s.previousElementSibling as HTMLElement | null;
    const next = s.nextElementSibling as HTMLElement | null;
    if (prev && next && prev.offsetTop !== next.offsetTop) s.style.display = 'none';
  });
}
new ResizeObserver(tidySeparators).observe($('#toolbar'));

function closeMenus(): void {
  document.querySelectorAll('.tt-menu.show').forEach((m) => m.classList.remove('show'));
  $('#dragHandle').classList.remove('open');
}
$('#toolbar').addEventListener('click', (e) => {
  const dd = (e.target as HTMLElement).closest<HTMLElement>('[data-dd]');
  if (dd) {
    const menu = document.querySelector<HTMLElement>(`.tt-menu[data-menu="${dd.dataset.dd}"]`)!;
    const open = menu.classList.contains('show');
    closeMenus();
    if (!open) {
      const r = dd.getBoundingClientRect();
      menu.style.top = r.bottom + 6 + 'px';
      menu.style.left = r.left + 'px';
      menu.classList.add('show');
      updateToolbar();
    }
    return;
  }
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (b) { closeMenus(); void run(b.dataset.cmd!); updateToolbar(); }
});
document.querySelectorAll('.tt-menu').forEach((menu) => menu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (b) { closeMenus(); void run(b.dataset.cmd!); updateToolbar(); }
}));
document.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('.tt-menu, [data-dd], .cb-lang, .drag-handle')) closeMenus(); });
document.querySelectorAll('#toolbar, .tt-menu, #bubble').forEach((bar) => bar.addEventListener('mousedown', (e) => e.preventDefault()));
$('#bubble').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (b) { void run(b.dataset.cmd!); updateToolbar(); } });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

// ------------------------------------------------------------------------------------------- drag handle

const handle = $<HTMLButtonElement>('#dragHandle');
const composer = $('#composer');
let handlePos: number | null = null;
let blockMenuPos: number | null = null;
function hideHandle(): void { if (!handle.classList.contains('open')) handle.classList.remove('show'); }
function placeHandle(pos: number): void {
  if (!editor) return;
  const dom = editor.view.nodeDOM(pos);
  const node = editor.state.doc.nodeAt(pos);
  if (!(dom instanceof HTMLElement) || !node) return hideHandle();
  if (node.type.name === 'paragraph' && node.content.size === 0) return hideHandle();
  const c = composer.getBoundingClientRect();
  const r = dom.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(dom).lineHeight) || 24;
  let top = r.top - c.top + Math.max(0, (Math.min(lineHeight, r.height) - 24) / 2);
  if (node.type.name === 'codeBlock' || node.type.name === 'rawBlock') top = r.top - c.top + 6;
  let left = editor.view.dom.getBoundingClientRect().left - c.left - 28;
  if (node.type.name === 'listItem') left = r.left - c.left - 44;
  if (node.type.name === 'taskItem') left = r.left - c.left - 26;
  handle.style.top = top + 'px';
  handle.style.left = left + 'px';
  handle.classList.add('show');
  handlePos = pos;
}
composer.addEventListener('mousemove', (e) => {
  if (!editor || handle.classList.contains('open') || e.buttons || (e.target as HTMLElement).closest('#dragHandle')) return;
  const view = editor.view;
  const r = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: Math.min(Math.max(e.clientX, r.left + 30), r.right - 10), top: e.clientY });
  if (!hit) return hideHandle();
  let pos: number | null = null;
  if (hit.inside >= 0) {
    const n = view.state.doc.nodeAt(hit.inside);
    if (n && n.isBlock && n.isAtom && view.state.doc.resolve(hit.inside).depth === 0) pos = hit.inside;
  }
  if (pos == null) pos = blockAt(editor, view.state.doc.resolve(hit.pos));
  if (pos == null) return hideHandle();
  placeHandle(pos);
});
composer.addEventListener('mouseleave', hideHandle);
// Dragging uses ProseMirror's own block drag: select the block, hand PM the slice, PM moves it on drop.
handle.addEventListener('dragstart', (e) => {
  if (handlePos == null || !editor) return e.preventDefault();
  const view = editor.view;
  const sel = NodeSelection.create(view.state.doc, handlePos);
  view.dispatch(view.state.tr.setSelection(sel));
  view.dragging = { slice: sel.content(), move: true };
  e.dataTransfer!.effectAllowed = 'copyMove';
  e.dataTransfer!.setData('text/plain', sel.node.textContent);
  const dom = view.nodeDOM(handlePos);
  if (dom instanceof HTMLElement) e.dataTransfer!.setDragImage(dom, 0, 0);
  closeMenus();
});
handle.addEventListener('dragend', () => handle.classList.remove('show'));
handle.addEventListener('click', () => {
  if (handlePos == null) return;
  const menu = $('#menu-block');
  const wasOpen = menu.classList.contains('show');
  closeMenus();
  if (wasOpen) return;
  blockMenuPos = handlePos;
  const r = handle.getBoundingClientRect();
  menu.classList.add('show');
  handle.classList.add('open');
  const h = menu.offsetHeight;
  menu.style.top = (r.bottom + 4 + h <= window.innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
  menu.style.left = r.left + 'px';
});
$('#menu-block').addEventListener('mousedown', (e) => e.preventDefault());
$('#menu-block').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bcmd]');
  const pos = blockMenuPos;
  if (!editor || !b || pos == null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  closeMenus();
  const cmd = b.dataset.bcmd;
  let tr: Transaction | null = null;
  let keep: number | null = null;
  if (cmd === 'up' || cmd === 'down') {
    const m = moveTr(editor, pos, cmd === 'up' ? -1 : 1);
    if (m) { tr = m.tr; keep = m.target; }
  } else if (cmd === 'duplicate') {
    tr = editor.state.tr.insert(pos + node.nodeSize, node);
    keep = pos + node.nodeSize;
  } else if (cmd === 'delete') {
    tr = editor.state.tr.delete(pos, pos + node.nodeSize);
  }
  if (!tr) return;
  if (keep != null) tr.setSelection(NodeSelection.create(tr.doc, keep));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  if (keep != null) placeHandle(keep); else handle.classList.remove('show');
});

// ------------------------------------------------------------------------------------------- smooth caret

const caret = document.createElement('div');
caret.className = 'pc-caret';
caret.innerHTML = '<span class="pc-caret-bar"></span>';
composer.appendChild(caret);
let caretShown = false;
let caretBlinkTimer: number | undefined;
let caretFrame: number | null = null;
function placeCaret(): void {
  caretFrame = null;
  if (!editor) return;
  const sel = editor.state.selection;
  const on = settings?.caret === 'smooth' && editor.isFocused && sel instanceof TextSelection;
  if (!on) { caret.className = 'pc-caret'; caretShown = false; return; }
  let c: { left: number; top: number; bottom: number };
  try { c = editor.view.coordsAtPos(sel.head); } catch { return; }
  const base = composer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = Math.round((c.left - base.left) * dpr) / dpr;   // whole device pixels: crisp at 125%/150%
  const y = Math.round((c.top - base.top) * dpr) / dpr;
  caret.classList.toggle('glide', caretShown);              // first appearance jumps, later moves glide
  caret.style.transform = `translate(${x}px, ${y}px)`;
  caret.style.height = Math.max(12, Math.round((c.bottom - c.top) * dpr) / dpr) + 'px';
  caret.classList.add('show');
  caretShown = true;
  const blink = ['blink', 'smooth', 'phase', 'expand', 'solid'].includes(settings?.cursorBlinking ?? '') ? settings!.cursorBlinking : 'expand';
  caret.classList.remove('blink-blink', 'blink-smooth', 'blink-phase', 'blink-expand');
  window.clearTimeout(caretBlinkTimer);
  // solid while moving or typing, then blink in the user's style (expand when it's the default "blink")
  const style = blink === 'blink' ? 'expand' : blink;
  if (style !== 'solid') caretBlinkTimer = window.setTimeout(() => caret.classList.add(`blink-${style}`), 500);
}
function scheduleCaret(): void { if (!caretFrame) caretFrame = requestAnimationFrame(placeCaret); }

// ------------------------------------------------------------------------------------------- line numbers

const gutter = $('#lnGutter');
let lnFrame: number | null = null;
function visualLines(el: HTMLElement): { top: number; bottom: number }[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.height > 0).sort((a, b) => a.top - b.top);
  const lines: { top: number; bottom: number }[] = [];
  for (const r of rects) {
    const cur = lines[lines.length - 1];
    if (cur && r.top < cur.bottom - 3) { cur.top = Math.min(cur.top, r.top); cur.bottom = Math.max(cur.bottom, r.bottom); }
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  return lines;
}
function renderLineNumbers(): void {
  lnFrame = null;
  if (!editor || !settings?.lineNumbers) { gutter.innerHTML = ''; return; }
  const view = editor.view;
  const base = composer.getBoundingClientRect();
  const at = (p: number) => { try { return view.coordsAtPos(p); } catch { return null; } };
  const lines: { top: number; bottom: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' || node.type.name === 'rawBlock') {
      let off = 0;
      for (const text of node.textContent.split('\n')) { const r = at(pos + 1 + off); if (r) lines.push(r); off += text.length + 1; }
      return false;
    }
    if (node.isTextblock) {
      const dom = view.nodeDOM(pos);
      const rows = node.content.size && dom instanceof HTMLElement ? visualLines(dom) : [];
      if (rows.length) lines.push(...rows);
      else { const r = at(pos + 1); if (r) lines.push(r); }
      return false;
    }
    if (node.type.name === 'image' || node.type.name === 'horizontalRule') {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) { const r = dom.getBoundingClientRect(); lines.push({ top: r.top, bottom: r.top + 24 }); }
      return false;
    }
    return true;
  });
  const c = editor.isFocused ? at(editor.state.selection.head) : null;
  const caretMid = c && (c.top + c.bottom) / 2;
  gutter.innerHTML = lines.map((r, i) => {
    const on = caretMid != null && caretMid >= r.top && caretMid <= r.bottom;
    return `<span class="ln${on ? ' on' : ''}" style="top:${(r.top - base.top).toFixed(1)}px;height:${(r.bottom - r.top).toFixed(1)}px">${i + 1}</span>`;
  }).join('');
}
function scheduleLines(): void { if (!lnFrame) lnFrame = requestAnimationFrame(renderLineNumbers); }

// ------------------------------------------------------------------------------------------- undo / redo from VS Code

// VS Code runs its Undo/Redo commands for this page by calling document.execCommand('undo' | 'redo').
const nativeExec = document.execCommand.bind(document);
document.execCommand = (command: string, showUI?: boolean, value?: string) => {
  if (editor && (command === 'undo' || command === 'redo')) {
    if (command === 'undo') editor.commands.undo(); else editor.commands.redo();
    return true;
  }
  return nativeExec(command, showUI, value);
};

// ------------------------------------------------------------------------------------------- host messages

function goToBroken(): void {
  if (!editor) return;
  let target: number | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (target == null && n.type.name === 'mention' && mentionInfo.get(n.attrs.id)?.exists === false) target = pos;
  });
  if (target == null) { post({ type: 'noBroken' }); return; }
  editor.chain().focus().setNodeSelection(target).scrollIntoView().run();
}

window.addEventListener('message', (ev: MessageEvent<HostToEditor>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init': {
      init = m.init;
      persist = m.init.state;
      mentionInfo.clear();
      for (const [k, v] of Object.entries(m.init.mentions)) mentionInfo.set(k, v);
      applySettings(m.init.settings);
      createEditor(m.init.markdown);
      vscode.setState({ ...persist, markdown: lastSent });
      if (m.init.focus || pendingFocus !== undefined) editor?.commands.focus(pendingFocus ?? 'end');
      pendingFocus = undefined;
      return;
    }
    case 'settings':
      applySettings(m.settings);
      return;
    case 'state':
      persist = m.state;
      vscode.setState({ ...persist, markdown: lastSent });
      return;
    case 'flush': {
      const markdown = serialize();
      if (markdown !== lastSent) report(true);
      post({ type: 'content', requestId: m.requestId, markdown, title: editor ? titleOfDoc(editor.state.doc) : '' });
      return;
    }
    case 'reload':
      rememberMentions(m.mentions);
      createEditor(m.markdown);
      vscode.setState({ ...persist, markdown: lastSent });
      return;
    case 'mentionResults': {
      pickerIndexing = m.indexing;
      const waiter = pendingQueries.get(m.seq);
      if (waiter) { pendingQueries.delete(m.seq); waiter(m.items); } else if (m.seq === mentionSeq) picker.refresh(m.items);
      return;
    }
    case 'mentionInfo':
      rememberMentions(m.mentions);
      report(false);
      return;
    case 'imageSaved':
      imageWaiters.get(m.requestId)?.(m.path);
      imageWaiters.delete(m.requestId);
      return;
    case 'insertImages': {
      if (!editor) return;
      const nodes = m.paths.map((p) => ({ type: 'image', attrs: { src: imageSrc(p), alt: decodeURIComponent(p.split('/').pop() ?? 'image').replace(/\.[^.]+$/, ''), path: p } }));
      editor.chain().focus().insertContent(nodes).run();
      return;
    }
    case 'linkResult':
      linkWaiters.get(m.requestId)?.(m.href);
      linkWaiters.delete(m.requestId);
      return;
    case 'focus':
      if (editor) { window.focus(); editor.commands.focus(m.at ?? null); }
      else pendingFocus = m.at ?? null;
      return;
    case 'goToBroken':
      goToBroken();
      return;
    case 'command':
      if (m.name === 'link') void askLink();
      return;
  }
});

// Restore the last text immediately after a reload while the host prepares the real init.
const saved = vscode.getState() as (PersistState & { markdown?: string }) | undefined;
if (saved?.docId) persist = saved;
post({ type: 'ready' });
