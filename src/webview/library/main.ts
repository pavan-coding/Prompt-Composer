// The Prompts panel (webview view). The host does the grouping and search; this page renders rows,
// keeps fold state, and sends clicks, double-clicks and keys back. Right-click uses VS Code's own menu.
import './library.css';
import type { HostToLibrary, LibraryModel, LibraryToHost, PanelShow, PromptRow } from '../../common/protocol';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
const post = (m: LibraryToHost) => vscode.postMessage(m);
window.addEventListener('error', (e) => post({ type: 'log', level: 'error', message: `${e.message} at ${e.filename}:${e.lineno}` }));

const app = document.getElementById('app')!;
app.innerHTML = `
  <label class="lib-search" id="searchBox"><i class="codicon codicon-search"></i>
    <input id="search" placeholder="Search prompts" spellcheck="false" autocomplete="off" aria-label="Search prompts">
    <button class="iconbtn" id="clear" title="Clear Search" tabindex="-1"><i class="codicon codicon-close"></i></button></label>
  <div class="lib-count" id="count" aria-live="polite"></div>
  <div class="lib-tree" id="tree" tabindex="0" role="tree" aria-label="Prompts"></div>`;
// Everywhere but a prompt row, VS Code's default context menu items (Cut/Copy/Paste) aren't wanted.
document.body.dataset.vscodeContext = JSON.stringify({ preventDefaultContextMenuItems: true });

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const search = $<HTMLInputElement>('#search');
const tree = $('#tree');

const state = (vscode.getState() as { collapsed?: string[]; seen?: string[]; query?: string } | undefined) ?? {};
const collapsed = new Set<string>(state.collapsed ?? []);
/** Months that have been shown before: older months start folded the first time they appear. */
const seen = new Set<string>(state.seen ?? []);
let model: LibraryModel | undefined;
let focusedId: string | undefined;

function saveState(): void {
  vscode.setState({ collapsed: [...collapsed], seen: [...seen], query: search.value });
}
function saveFolds(): void {
  saveState();
  post({ type: 'folds', collapsed: [...collapsed] });
}

function highlight(text: string, range?: [number, number]): string {
  if (!range) return esc(text);
  return esc(text.slice(0, range[0])) + '<mark>' + esc(text.slice(range[0], range[1])) + '</mark>' + esc(text.slice(range[1]));
}

function render(): void {
  const m = model;
  if (!m) return;
  const q = m.query;
  $('#searchBox').classList.toggle('has-text', !!search.value);
  $('#count').textContent = q ? (m.found ? `${m.found} prompt${m.found > 1 ? 's' : ''} found` : 'No prompts found') : '';
  if (!m.folder) {
    tree.innerHTML = '<div class="lib-welcome">Open a folder to use Prompt Composer. Prompts are saved in the folder you work in, under .prompt-composer/.</div>';
    return;
  }
  if (!m.total) {
    tree.innerHTML = '<div class="lib-welcome">No prompts yet.<button id="welcomeNew">New Prompt</button></div><div class="lib-empty-hint">Double-click here to start a new prompt</div>';
    return;
  }
  const row = (cls: string, depth: number, inner: string, attrs = '') =>
    `<div class="lrow ${cls}" style="padding-left:${4 + depth * 12}px" ${attrs}>${inner}</div>`;
  const twistie = (key: string) => `<span class="twistie codicon codicon-chevron-${collapsed.has(key) && !q ? 'right' : 'down'}"></span>`;
  const promptRow = (p: PromptRow, depth: number, dated: boolean) => {
    const ctx = esc(JSON.stringify({ webviewSection: 'prompt', promptId: p.id, promptSaved: p.saved, promptPinned: p.pinned, preventDefaultContextMenuItems: true }));
    const cls = ['prompt', p.active && 'active', p.dirty && 'dirty', p.open && 'open', p.id === focusedId && 'focused'].filter(Boolean).join(' ');
    let h = row(cls, depth,
      `<span class="twistie"></span><i class="icon codicon codicon-${p.pinned ? 'pinned' : 'note'}"></i>` +
      `<span class="name${p.saved ? '' : ' unsaved'}">${highlight(p.title, p.titleMatch)}</span><span class="dot" title="Unsaved changes"></span>` +
      `<span class="desc">${dated ? esc(p.date) : esc(p.time)}</span>`,
      `data-id="${esc(p.id)}" data-vscode-context="${ctx}" title="${esc(p.tooltip)}" role="treeitem" aria-selected="${p.active}"`);
    if (p.snippet) {
      const [a, b, c] = p.snippet;
      h += row('snip', depth + 1, `<span class="twistie"></span><span class="name">${esc(a)}<mark>${esc(b)}</mark>${esc(c)}</span>`, `data-id="${esc(p.id)}" data-snippet="1" data-vscode-context="${ctx}"`);
    }
    return h;
  };
  let html = '';
  if (m.pinned.length && !q) {
    html += row('grp', 0, `${twistie('pinned')}<span class="name">Pinned</span><span class="badge">${m.pinned.length}</span>`, 'data-group="pinned"');
    if (!collapsed.has('pinned')) for (const p of m.pinned) html += promptRow(p, 1, true);
  }
  if (m.empty) html += row('quiet', 1, `<span class="twistie"></span><span class="name">No prompts yet ${m.show === 'today' ? 'today' : 'this month'}</span>`);
  // Showing today only: "Today" is a top-level group like Pinned, without its month.
  const flat = m.show === 'today' && !q;
  for (const month of m.months) {
    if (!flat) {
      const mg = 'm:' + month.key;
      if (!seen.has(month.key)) {
        seen.add(month.key);
        if (!month.current) collapsed.add(mg);
      }
      html += row('grp', 0, `${twistie(mg)}<span class="name">${esc(month.label)}</span><span class="badge">${month.count}</span>`, `data-group="${mg}"`);
      if (collapsed.has(mg) && !q) continue;
    }
    for (const day of month.days) {
      const dg = 'd:' + day.key;
      html += flat
        ? row('grp', 0, `${twistie(dg)}<span class="name">${esc(day.label)}</span><span class="badge">${day.prompts.length}</span>`, `data-group="${dg}"`)
        : row('day', 1, `${twistie(dg)}<i class="icon codicon codicon-calendar"></i><span class="name">${esc(day.label)}</span><span class="desc">${day.prompts.length}</span>`, `data-group="${dg}"`);
      if (collapsed.has(dg) && !q) continue;
      for (const p of day.prompts) html += promptRow(p, flat ? 1 : 2, false);
    }
  }
  const link = (show: PanelShow, text: string) => `<a href="#" data-show="${show}">${text}</a>`;
  const hidden = !m.hidden || q ? ''
    : m.show === 'today'
      ? `<span>Earlier prompts are hidden. Search finds every prompt.</span><span>${link('month', 'Show this month')} · ${link('all', 'Show all months')}</span>`
      : `<span>Older months are hidden. Search finds every prompt.</span><span>${link('all', 'Show all months')}</span>`;
  tree.innerHTML = html + `<div class="lib-empty-hint"><span>Double-click empty space for a new prompt</span>${hidden}</div>`;
  saveState();
}

function promptRows(): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>('.lrow.prompt')];
}

function setFocused(id: string | undefined, scroll = true): void {
  focusedId = id;
  for (const r of promptRows()) r.classList.toggle('focused', r.dataset.id === id);
  if (scroll) tree.querySelector<HTMLElement>('.lrow.prompt.focused')?.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ events

let searchTimer: number | undefined;
search.addEventListener('input', () => {
  $('#searchBox').classList.toggle('has-text', !!search.value);
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => post({ type: 'search', query: search.value }), 60);
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && search.value) {
    search.value = '';
    post({ type: 'search', query: '' });
    e.stopPropagation();
  } else if (e.key === 'Enter') {
    const first = promptRows()[0];
    if (first) post({ type: 'open', id: first.dataset.id!, preview: false, focus: true });
  } else if (e.key === 'ArrowDown') {
    const first = promptRows()[0];
    if (first) { e.preventDefault(); tree.focus(); setFocused(first.dataset.id); }
  }
});
$('#clear').addEventListener('mousedown', (e) => e.preventDefault());
$('#clear').addEventListener('click', (e) => {
  e.preventDefault();
  search.value = '';
  post({ type: 'search', query: '' });
  search.focus();
});

tree.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'welcomeNew') { post({ type: 'newPrompt' }); return; }
  const show = target.closest<HTMLElement>('a[data-show]');
  if (show) { e.preventDefault(); post({ type: 'show', show: show.dataset.show as PanelShow }); return; }
  const r = target.closest<HTMLElement>('.lrow');
  if (!r) return;
  if (r.dataset.group) {
    const k = r.dataset.group;
    if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
    saveFolds();
    render();
    return;
  }
  if (r.dataset.id) {
    setFocused(r.dataset.id, false);
    post({ type: 'open', id: r.dataset.id, preview: !r.dataset.snippet, focus: !!r.dataset.snippet, side: e.ctrlKey || e.metaKey });
  }
});
tree.addEventListener('dblclick', (e) => {
  const target = e.target as HTMLElement;
  const r = target.closest<HTMLElement>('.lrow');
  if (!r && !target.closest('.lib-welcome, a')) { post({ type: 'newPrompt' }); return; }
  if (r?.dataset.id) post({ type: 'open', id: r.dataset.id, preview: false, focus: true });
});
tree.addEventListener('keydown', (e) => {
  const rows = promptRows();
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.dataset.id === focusedId);
  switch (e.key) {
    case 'ArrowDown': i = Math.min(rows.length - 1, i + 1); break;
    case 'ArrowUp':
      if (i <= 0) { search.focus(); setFocused(undefined); e.preventDefault(); return; }
      i -= 1;
      break;
    case 'Home': i = 0; break;
    case 'End': i = rows.length - 1; break;
    case 'Enter':
      if (focusedId) post({ type: 'open', id: focusedId, preview: false, focus: true, side: e.ctrlKey || e.metaKey });
      e.preventDefault();
      return;
    case ' ':
      if (focusedId) post({ type: 'open', id: focusedId, preview: true, focus: false });
      e.preventDefault();
      return;
    case 'Delete':
      if (focusedId) post({ type: 'delete', id: focusedId });
      e.preventDefault();
      return;
    default:
      return;
  }
  e.preventDefault();
  setFocused(rows[Math.max(0, i)].dataset.id);
});
tree.addEventListener('focus', () => {
  if (!focusedId) setFocused(promptRows().find((r) => r.classList.contains('active'))?.dataset.id ?? promptRows()[0]?.dataset.id);
});

window.addEventListener('message', (ev: MessageEvent<HostToLibrary>) => {
  const m = ev.data;
  switch (m.type) {
    case 'model':
      model = m.model;
      if (search.value.trim() !== m.model.query && document.activeElement !== search) search.value = m.model.query;
      render();
      return;
    case 'collapseAll':
      collapsed.add('pinned');
      for (const month of model?.months ?? []) {
        collapsed.add('m:' + month.key);
        for (const d of month.days) collapsed.add('d:' + d.key);
      }
      saveFolds();
      render();
      return;
    case 'focusSearch':
      search.focus();
      search.select();
      return;
    case 'folds':
      // the host's copy wins only when this page has no state of its own (first load after a restart)
      if (!state.collapsed) for (const k of m.collapsed) collapsed.add(k);
      render();
      return;
  }
});

if (state.query) {
  search.value = state.query;
  post({ type: 'search', query: state.query });
}
post({ type: 'ready' });
