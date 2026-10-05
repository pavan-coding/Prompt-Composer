// Prompt tabs: one webview panel per prompt, user-controlled saving (Ctrl+S and VS Code's files.autoSave),
// a dirty marker, a save question when a changed prompt is closed, and unsaved changes that survive reloads.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EditorSettings, EditorStats, EditorToHost, HostToEditor, MentionMap, PersistState,
} from '../common/protocol';
import { imagePaths, mentionPaths, searchLines, titleOf, toPromptText } from '../common/markdownText';
import { STORE_DIR, monthKey } from '../common/naming';
import type { PromptStore } from '../store/promptStore';
import type { Library } from '../store/library';
import type { LibraryItem } from '../store/libraryModel';
import type { FileIndex } from '../mentions/fileIndex';
import { resolveMentions } from '../mentions/resolve';
import type { ImageStore } from '../images/imageStore';
import { CLAUDE_DONE_FILE } from '../claude/claudeEditor';
import { rebaseMentions } from '../claude/claudePaths';
import { webviewHtml } from './html';

export const EDITOR_VIEW_TYPE = 'promptComposer.editor';
const DRAFTS_KEY = 'promptComposer.drafts';
const UNTITLED = 'Untitled prompt';

interface Draft { rel?: string; created: number; markdown: string }

/** Claude Code's prompt (Ctrl+G, see claude/claudeEditor.ts): where it's written and for which folder. */
export interface ClaudeTarget {
  /** The .prompt file in Claude's temp folder. */
  file: string;
  /** Claude's working directory, which @paths are made relative to. */
  cwd: string | undefined;
}

interface ClaudeState extends ClaudeTarget {
  /** The editor's first Markdown: until the prompt is edited, the file keeps Claude's exact text. */
  baseline: string | undefined;
  /** What's in the file (or being written). */
  written: string;
  writing: Promise<void>;
  /** Which @paths exist, so typing doesn't stat the same files again. */
  exists: Map<string, boolean>;
}

export class PromptDoc {
  rel: string | undefined;
  savedText: string;
  current: string;
  title: string;
  stats: EditorStats | undefined;
  panel: vscode.WebviewPanel | undefined;
  /** A single-click preview tab: reused by the next single click until it's edited. */
  preview = false;
  /** Focus the editor when the webview finishes loading. */
  focusOnLoad = false;
  /** Images saved while this prompt was being edited (workspace-relative), for cleanup on Don't Save. */
  readonly sessionImages = new Set<string>();
  readonly flushes = new Map<number, (c: { markdown: string; title: string }) => void>();
  saving: Promise<boolean> | undefined;
  autoSaveTimer: NodeJS.Timeout | undefined;
  /** The webview has loaded this prompt and reported its content at least once. */
  loaded = false;
  private loadWaiters: (() => void)[] = [];
  whenLoaded(): Promise<void> {
    return this.loaded ? Promise.resolve() : new Promise((r) => this.loadWaiters.push(r));
  }
  markLoaded(): void {
    this.loaded = true;
    for (const r of this.loadWaiters.splice(0)) r();
  }
  lastQuery: { seq: number; query: string } | undefined;
  /**
   * Set for Claude Code's prompt: every edit goes straight to Claude's file, so it's never dirty, never in the
   * library and never a draft. savedText holds Claude's original text (Revert goes back to it).
   */
  claude: ClaudeState | undefined;

  constructor(readonly id: string, rel: string | undefined, readonly created: Date, savedText: string, current = savedText) {
    this.rel = rel;
    this.savedText = savedText;
    this.current = current;
    this.title = titleOf(current);
  }

  get dirty(): boolean {
    return !this.claude && this.current !== this.savedText;
  }

  get displayTitle(): string {
    return this.title || UNTITLED;
  }

  /** Workspace-relative folder the prompt lives in (known before the first save): ".prompt-composer/2026-10". */
  get dir(): string {
    return `${STORE_DIR}/${this.rel ? this.rel.split('/')[0] : monthKey(this.created)}`;
  }
}

export interface EditorDeps {
  context: vscode.ExtensionContext;
  store: PromptStore;
  library: Library;
  index: FileIndex;
  images: ImageStore;
  log: vscode.LogOutputChannel;
  onActiveChanged: (doc: PromptDoc | undefined) => void;
}

export class EditorManager implements vscode.Disposable {
  private readonly docs = new Map<string, PromptDoc>();
  private readonly panelDocs = new Map<vscode.WebviewPanel, PromptDoc>();
  private readonly quietClose = new Set<vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private requestSeq = 0;
  private active: PromptDoc | undefined;
  private closeQueue: PromptDoc[] = [];
  private closeTimer: NodeJS.Timeout | undefined;
  private draftsTimer: NodeJS.Timeout | undefined;
  /** Resolves when the close question being shown is answered (tests wait on it). */
  closing: Promise<void> = Promise.resolve();
  /** Modal questions go through here so tests can answer them. */
  dialogs = {
    warn: (message: string, options: vscode.MessageOptions, ...items: string[]): Thenable<string | undefined> =>
      vscode.window.showWarningMessage(message, options, ...items),
  };

  constructor(private readonly deps: EditorDeps) {
    const { context } = deps;
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(EDITOR_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state) => this.restorePanel(panel, state as PersistState | undefined),
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('promptComposer') || e.affectsConfiguration('editor.cursorBlinking')) {
          const settings = this.settings();
          for (const doc of this.panelDocs.values()) this.post(doc, { type: 'settings', settings });
        }
      }),
      vscode.window.onDidChangeWindowState((s) => this.windowFocusChanged(s.focused)),
    );
    this.loadDrafts(context.workspaceState.get<Record<string, Draft>>(DRAFTS_KEY, {}));
  }

  /** Auto Save onWindowChange / onFocusChange: save changed prompts when VS Code loses focus. */
  windowFocusChanged(focused: boolean): void {
    if (focused) return;
    for (const doc of this.docs.values()) {
      const mode = this.autoSave(doc).mode;
      if (doc.dirty && (mode === 'onWindowChange' || mode === 'onFocusChange')) void this.save(doc, 'auto');
    }
  }

  dispose(): void {
    clearTimeout(this.closeTimer);
    this.writeDraftsNow();
    for (const d of this.disposables) d.dispose();
  }

  // ------------------------------------------------------------------ queries

  get activeDoc(): PromptDoc | undefined {
    return this.active;
  }

  allDocs(): PromptDoc[] {
    return [...this.docs.values()];
  }

  docByRel(rel: string): PromptDoc | undefined {
    for (const d of this.docs.values()) if (d.rel === rel) return d;
    return undefined;
  }

  docById(id: string): PromptDoc | undefined {
    return id.startsWith('doc:') ? this.docs.get(id.slice(4)) : this.docByRel(id);
  }

  /** Library rows: every saved prompt, plus unsaved prompts that have content. */
  libraryItems(): LibraryItem[] {
    const { library } = this.deps;
    const items: LibraryItem[] = [];
    const seen = new Set<string>();
    for (const e of library.all()) {
      const doc = this.docByRel(e.rel);
      seen.add(e.rel);
      items.push({
        id: e.rel,
        title: doc ? doc.title : e.title,
        created: e.created,
        pinned: library.isPinned(e.rel),
        dirty: !!doc?.dirty,
        open: !!doc?.panel,
        active: !!doc && doc === this.active,
        saved: true,
        tooltip: `${STORE_DIR}/${e.rel}`,
        ...(doc?.dirty ? { text: searchLines(doc.current).join('\n') } : { text: e.text, lower: e.lower }),
      });
    }
    for (const doc of this.docs.values()) {
      if (doc.rel && seen.has(doc.rel)) continue;
      if (doc.claude || (!doc.rel && !doc.current.trim())) continue;
      items.push({
        id: doc.rel ?? `doc:${doc.id}`,
        title: doc.title,
        created: doc.created,
        pinned: !!doc.rel && library.isPinned(doc.rel),
        dirty: doc.dirty,
        open: !!doc.panel,
        active: doc === this.active,
        saved: !!doc.rel,
        tooltip: doc.rel ? `${STORE_DIR}/${doc.rel}` : 'Not saved yet',
        text: searchLines(doc.current).join('\n'),
      });
    }
    return items;
  }

  // ------------------------------------------------------------------ settings

  settings(): EditorSettings {
    const c = vscode.workspace.getConfiguration('promptComposer');
    return {
      colors: c.get('editor.colors', 'theme'),
      mentionStyle: c.get('mentions.style', 'icon'),
      toolbar: c.get('toolbar', 'mid'),
      width: c.get('editor.width', 'full'),
      caret: c.get('caret', 'smooth'),
      lineNumbers: c.get('lineNumbers', true),
      cursorBlinking: vscode.workspace.getConfiguration('editor').get('cursorBlinking', 'blink'),
    };
  }

  /** VS Code's Auto Save setting for this prompt (folder and [markdown] overrides included). */
  autoSave(doc: PromptDoc): { mode: string; delay: number } {
    const uri = doc.rel ? vscode.Uri.file(this.deps.store.absOf(doc.rel)) : vscode.Uri.file(this.deps.store.workspaceRoot);
    const c = vscode.workspace.getConfiguration('files', { uri, languageId: 'markdown' });
    return { mode: c.get<string>('autoSave', 'off'), delay: c.get<number>('autoSaveDelay', 1000) };
  }

  // ------------------------------------------------------------------ opening

  /** A new, empty, unsaved prompt in its own tab, ready to type. */
  newPrompt(opts: { viewColumn?: vscode.ViewColumn; content?: string } = {}): PromptDoc {
    const doc = new PromptDoc(randomUUID(), undefined, new Date(), '', opts.content ?? '');
    this.docs.set(doc.id, doc);
    doc.focusOnLoad = true;
    this.createPanel(doc, opts.viewColumn ?? vscode.ViewColumn.Active, true);
    this.changed();
    return doc;
  }

  /** Opens in progress, per prompt: a fast double-click sends several opens before the file has been read. */
  private readonly opening = new Map<string, Promise<PromptDoc | undefined>>();

  /** Open a saved prompt (by its rel path). Reuses its tab if it's already open. */
  async open(rel: string, opts: { viewColumn?: vscode.ViewColumn; preview?: boolean; focus?: boolean } = {}): Promise<PromptDoc | undefined> {
    const pending = this.opening.get(rel);
    if (pending) {
      await pending;
      return this.open(rel, opts);
    }
    const p = this.openNow(rel, opts);
    this.opening.set(rel, p);
    try {
      return await p;
    } finally {
      this.opening.delete(rel);
    }
  }

  private async openNow(rel: string, opts: { viewColumn?: vscode.ViewColumn; preview?: boolean; focus?: boolean }): Promise<PromptDoc | undefined> {
    let doc = this.docByRel(rel);
    if (doc?.panel) {
      if (!opts.preview && doc.preview) this.pin(doc);
      doc.panel.reveal(opts.viewColumn ?? doc.panel.viewColumn, !opts.focus && opts.preview);
      // a tab that's still loading this prompt (a preview just switched to it) takes focus once it's ready
      if (opts.focus) {
        if (doc.loaded) {
          this.post(doc, { type: 'focus' });
          // VS Code may still be moving focus from the panel to this tab: ask once more a moment later
          setTimeout(() => this.post(doc!, { type: 'focus' }), 150);
        }
        else doc.focusOnLoad = true;
      }
      return doc;
    }
    if (!doc) {
      let text: string;
      try {
        text = await this.deps.store.read(rel);
      } catch {
        void vscode.window.showWarningMessage(`Prompt Composer: ${STORE_DIR}/${rel} no longer exists.`);
        this.deps.library.remove(rel);
        return undefined;
      }
      // Opened by double-clicking it in the Explorer while another open was in flight?
      doc = this.docByRel(rel);
      if (!doc) {
        const st = await this.deps.store.stat(rel);
        doc = new PromptDoc(randomUUID(), rel, st?.created ?? new Date(), text);
        this.docs.set(doc.id, doc);
      }
    }
    doc.focusOnLoad = !!opts.focus;
    const reuse = opts.preview ? this.previewPanel() : undefined;
    if (reuse && !opts.viewColumn) {
      this.retarget(reuse, doc);
    } else {
      this.createPanel(doc, opts.viewColumn ?? vscode.ViewColumn.Active, !!opts.focus || !opts.preview);
      doc.preview = !!opts.preview;
    }
    this.changed();
    return doc;
  }

  /** Open an unsaved prompt (or a backed-up draft) by doc id. */
  openDoc(doc: PromptDoc, opts: { viewColumn?: vscode.ViewColumn; focus?: boolean } = {}): void {
    if (doc.panel) {
      doc.panel.reveal(opts.viewColumn ?? doc.panel.viewColumn);
      if (opts.focus) this.post(doc, { type: 'focus' });
      return;
    }
    doc.focusOnLoad = !!opts.focus;
    this.createPanel(doc, opts.viewColumn ?? vscode.ViewColumn.Active, true);
    this.changed();
  }

  /** Claude Code's prompt, in the tab VS Code made for its file (so `code --wait` follows that tab). */
  openClaude(panel: vscode.WebviewPanel, target: ClaudeTarget, text: string): PromptDoc {
    const doc = new PromptDoc(randomUUID(), undefined, new Date(), text);
    doc.claude = { ...target, baseline: undefined, written: text, writing: Promise.resolve(), exists: new Map() };
    this.docs.set(doc.id, doc);
    doc.focusOnLoad = true;
    this.attach(doc, panel);
    // A preview tab would be replaced (closed, so sent to Claude) by the next file you single-click.
    if (panel.active) void vscode.commands.executeCommand('workbench.action.keepEditor');
    this.changed();
    return doc;
  }

  private previewPanel(): vscode.WebviewPanel | undefined {
    for (const [panel, doc] of this.panelDocs) if (doc.preview && !doc.dirty) return panel;
    return undefined;
  }

  private pin(doc: PromptDoc): void {
    doc.preview = false;
  }

  private panelOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist'),
        vscode.Uri.file(this.deps.store.workspaceRoot),
      ],
    };
  }

  private createPanel(doc: PromptDoc, viewColumn: vscode.ViewColumn, focus: boolean): void {
    const panel = vscode.window.createWebviewPanel(EDITOR_VIEW_TYPE, doc.displayTitle, { viewColumn, preserveFocus: !focus }, this.panelOptions());
    this.attach(doc, panel);
  }

  private attach(doc: PromptDoc, panel: vscode.WebviewPanel): void {
    doc.panel = panel;
    this.panelDocs.set(panel, doc);
    panel.webview.options = this.panelOptions();
    this.updateTab(doc);
    panel.webview.html = webviewHtml(panel.webview, this.deps.context.extensionUri, 'editor', 'Prompt');
    panel.webview.onDidReceiveMessage((m: EditorToHost) => {
      const d = this.panelDocs.get(panel);
      if (d) void this.onMessage(d, m).catch((e) => this.deps.log.error(`message ${m.type}: ${e?.stack ?? e}`));
    });
    panel.onDidChangeViewState(() => {
      const d = this.panelDocs.get(panel);
      if (!d) return;
      if (panel.active) this.setActive(d);
      else {
        if (this.active === d) this.setActive(undefined);
        if (d.dirty && this.autoSave(d).mode === 'onFocusChange') void this.save(d, 'auto');
      }
    });
    panel.onDidDispose(() => this.onPanelDisposed(panel));
    if (panel.active) this.setActive(doc);
  }

  /** Point an existing (preview) tab at another prompt. */
  private retarget(panel: vscode.WebviewPanel, doc: PromptDoc): void {
    const old = this.panelDocs.get(panel);
    if (old && old !== doc) {
      old.panel = undefined;
      old.preview = false;
      if (!old.dirty) this.forget(old);
    }
    doc.panel = panel;
    doc.preview = true;
    this.panelDocs.set(panel, doc);
    this.updateTab(doc);
    void this.sendInit(doc);
    panel.reveal(panel.viewColumn, !doc.focusOnLoad);
    if (panel.active) this.setActive(doc);
  }

  private async restorePanel(panel: vscode.WebviewPanel, state: PersistState | undefined): Promise<void> {
    if (!state?.docId) {
      panel.dispose();
      return;
    }
    let doc = this.docs.get(state.docId) ?? (state.rel ? this.docByRel(state.rel) : undefined);
    if (doc?.panel) {
      // already open in another tab: keep one
      this.quietClose.add(panel);
      panel.dispose();
      return;
    }
    if (!doc) {
      let saved = '';
      if (state.rel) {
        try { saved = await this.deps.store.read(state.rel); } catch { /* deleted: keep the text from the tab */ }
      }
      doc = new PromptDoc(state.docId, state.rel, new Date(state.created || Date.now()), saved, state.markdown ?? saved);
      this.docs.set(doc.id, doc);
    } else if (state.markdown !== undefined) {
      doc.current = state.markdown;
      doc.title = titleOf(doc.current);
    }
    this.attach(doc, panel);
    this.changed();
  }

  // ------------------------------------------------------------------ webview messages

  post(doc: PromptDoc, msg: HostToEditor): void {
    void doc.panel?.webview.postMessage(msg);
  }

  private persistState(doc: PromptDoc): PersistState {
    return { docId: doc.id, rel: doc.rel, created: doc.created.getTime() };
  }

  private async sendInit(doc: PromptDoc): Promise<void> {
    const panel = doc.panel;
    if (!panel) return;
    const mentions = await this.resolve(doc, mentionPaths(doc.current));
    const promptDirUri = vscode.Uri.file(path.join(this.deps.store.workspaceRoot, ...doc.dir.split('/')));
    const focus = doc.focusOnLoad;
    doc.focusOnLoad = false;
    this.post(doc, {
      type: 'init',
      init: {
        docId: doc.id,
        state: this.persistState(doc),
        markdown: doc.current,
        mentions,
        settings: this.settings(),
        promptDirUrl: panel.webview.asWebviewUri(promptDirUri).toString() + '/',
        workspaceUrl: panel.webview.asWebviewUri(vscode.Uri.file(this.deps.store.workspaceRoot)).toString() + '/',
        workspaceFileUri: vscode.Uri.file(this.deps.store.workspaceRoot).toString() + '/',
        focus,
        isMac: process.platform === 'darwin',
      },
    });
  }

  private resolve(doc: PromptDoc, paths: string[]): Promise<MentionMap> {
    const webview = doc.panel?.webview;
    return resolveMentions(this.deps.store.workspaceRoot, paths, webview ? (abs) => webview.asWebviewUri(vscode.Uri.file(abs)).toString() : undefined);
  }

  private async onMessage(doc: PromptDoc, m: EditorToHost): Promise<void> {
    switch (m.type) {
      case 'ready':
        doc.loaded = false;
        return this.sendInit(doc);
      case 'changed': {
        const wasDirty = doc.dirty;
        const oldTitle = doc.title;
        doc.current = m.markdown;
        doc.title = m.title;
        doc.stats = m.stats;
        if (!doc.loaded) {
          doc.markLoaded();
          if (doc.focusOnLoad) {
            doc.focusOnLoad = false;
            this.post(doc, { type: 'focus', at: 'end' });
          }
        }
        if (doc.claude) {
          if (doc.claude.baseline === undefined) doc.claude.baseline = m.markdown;
          else void this.writeClaude(doc);
        }
        if (doc.dirty && doc.preview) this.pin(doc);
        if (oldTitle !== doc.title || wasDirty !== doc.dirty) this.updateTab(doc);
        if (doc === this.active) this.deps.onActiveChanged(doc);
        this.scheduleAutoSave(doc);
        this.scheduleDrafts();
        this.changed();
        return;
      }
      case 'content':
        doc.flushes.get(m.requestId)?.({ markdown: m.markdown, title: m.title });
        doc.flushes.delete(m.requestId);
        return;
      case 'mentionQuery': {
        doc.lastQuery = { seq: m.seq, query: m.query };
        const { index } = this.deps;
        const built = index.ensureBuilt();
        this.post(doc, { type: 'mentionResults', seq: m.seq, items: index.search(m.query), indexing: index.isIndexing });
        if (index.isIndexing) {
          await built;
          if (doc.lastQuery?.seq === m.seq) this.post(doc, { type: 'mentionResults', seq: m.seq, items: index.search(m.query), indexing: false });
        }
        return;
      }
      case 'resolveMentions':
        this.post(doc, { type: 'mentionInfo', mentions: await this.resolve(doc, m.paths) });
        return;
      case 'saveImage': {
        try {
          const name = await this.deps.images.saveBytes(m.bytes, m.mime, m.name, m.origin);
          doc.sessionImages.add(this.deps.images.workspaceRel(name));
          this.post(doc, { type: 'imageSaved', requestId: m.requestId, path: this.deps.images.linkFor(name) });
        } catch (e) {
          this.post(doc, { type: 'imageSaved', requestId: m.requestId, error: String(e) });
          void vscode.window.showErrorMessage(`Prompt Composer: couldn't save the image. ${e}`);
        }
        return;
      }
      case 'pickImage':
        return this.insertImage(doc);
      case 'askLink': {
        const href = await vscode.window.showInputBox({
          title: 'Link',
          prompt: 'Paste or type a URL or a workspace path. Leave empty to remove the link.',
          value: m.current,
          placeHolder: 'https://…',
        });
        this.post(doc, { type: 'linkResult', requestId: m.requestId, href: href === undefined ? null : href.trim() });
        return;
      }
      case 'openLink':
        return this.openLink(doc, m.href);
      case 'openMention':
        return this.openWorkspacePath(m.path);
      case 'focusChanged':
        void vscode.commands.executeCommand('setContext', 'promptComposer.editorFocused', m.focused);
        if (!m.focused && doc.dirty && this.autoSave(doc).mode === 'onFocusChange') void this.save(doc, 'auto');
        return;
      case 'noBroken':
        void vscode.window.showInformationMessage('Prompt Composer: every @mention in this prompt points at an existing file or folder.');
        return;
      case 'log':
        this.deps.log[m.level](`[editor] ${m.message}`);
        return;
    }
  }

  /** Workspace-relative path for a link inside a prompt (relative to the prompt's folder). */
  private resolveRelative(doc: PromptDoc, href: string): string | undefined {
    const clean = decodeURI(href.split('#')[0]);
    const parts: string[] = [];
    for (const p of `${doc.dir}/${clean}`.split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') { if (!parts.length) return undefined; parts.pop(); } else parts.push(p);
    }
    return parts.join('/');
  }

  private async openLink(doc: PromptDoc, href: string): Promise<void> {
    if (/^(https?|mailto):/i.test(href)) {
      void vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      void vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(href));
      return;
    }
    // A workspace path ("src/a.ts", "./docs/") or a path relative to the prompt.
    const direct = href.replace(/^\.\//, '').replace(/#.*$/, '');
    for (const candidate of [direct, this.resolveRelative(doc, href)]) {
      if (candidate && (await this.exists(candidate))) return this.openWorkspacePath(candidate);
    }
    void vscode.window.showWarningMessage(`Prompt Composer: "${href}" wasn't found in the workspace.`);
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(this.deps.store.workspaceRoot, ...rel.split('/').filter(Boolean))));
      return true;
    } catch {
      return false;
    }
  }

  async openWorkspacePath(rel: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.deps.store.workspaceRoot, ...rel.split('/').filter(Boolean)));
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      void vscode.window.showWarningMessage(`Prompt Composer: ${rel} wasn't found. Was it moved or deleted?`);
      return;
    }
    if (stat.type & vscode.FileType.Directory) await vscode.commands.executeCommand('revealInExplorer', uri);
    else await vscode.commands.executeCommand('vscode.open', uri);
  }

  // ------------------------------------------------------------------ saving

  /** Ask the webview for its latest Markdown (it batches changes while you type). */
  private flush(doc: PromptDoc): Promise<{ markdown: string; title: string }> {
    if (!doc.panel) return Promise.resolve({ markdown: doc.current, title: doc.title });
    const requestId = ++this.requestSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        doc.flushes.delete(requestId);
        resolve({ markdown: doc.current, title: doc.title });
      }, 1500);
      doc.flushes.set(requestId, (c) => {
        clearTimeout(timer);
        resolve(c);
      });
      this.post(doc, { type: 'flush', requestId });
    });
  }

  /** Save one prompt. Returns false if the save failed. */
  save(doc: PromptDoc, reason: 'user' | 'auto' | 'close' = 'user'): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      if (doc.saving) await doc.saving;
      clearTimeout(doc.autoSaveTimer);
      const { markdown, title } = await this.flush(doc);
      doc.current = markdown;
      doc.title = title;
      if (doc.claude) {
        // already written as you type; Ctrl+S just makes sure the last edit is on disk
        await this.writeClaude(doc);
        return true;
      }
      const { store, library } = this.deps;
      if (!doc.rel && !markdown.trim()) {
        // nothing to save in a new, empty prompt
        doc.savedText = markdown;
        this.updateTab(doc);
        this.changed();
        return true;
      }
      if (doc.rel && markdown === doc.savedText && reason === 'auto') return true;
      let rel = doc.rel;
      let allocated = false;
      try {
        if (!rel) {
          rel = await store.allocate(doc.created, title || titleOf(markdown));
          allocated = true;
        }
        library.beginWrite(rel);
        const st = await store.write(rel, markdown);
        doc.rel = rel;
        doc.savedText = markdown;
        library.endWrite(rel, markdown, st);
      } catch (e) {
        if (rel) library.endWrite(rel, undefined, undefined);
        if (allocated && rel) await store.removeQuietly(rel);
        this.deps.log.error(`save failed: ${e}`);
        void vscode.window.showErrorMessage(`Prompt Composer: couldn't save "${doc.displayTitle}". ${e}`);
        return false;
      }
      if (allocated) this.post(doc, { type: 'state', state: this.persistState(doc) });
      this.updateTab(doc);
      this.scheduleDrafts();
      this.changed();
      if (doc === this.active) this.deps.onActiveChanged(doc);
      return true;
    };
    const p = run().finally(() => { if (doc.saving === p) doc.saving = undefined; });
    doc.saving = p;
    return p;
  }

  async saveActive(): Promise<void> {
    if (this.active) await this.save(this.active, 'user');
  }

  private scheduleAutoSave(doc: PromptDoc): void {
    clearTimeout(doc.autoSaveTimer);
    const { mode, delay } = this.autoSave(doc);
    if (mode === 'afterDelay' && doc.dirty) doc.autoSaveTimer = setTimeout(() => void this.save(doc, 'auto'), Math.max(0, delay));
  }

  /** Throw away unsaved changes and reload the saved file (Claude's prompt: go back to Claude's text). */
  async revert(doc: PromptDoc): Promise<void> {
    let saved = '';
    if (doc.claude) {
      saved = doc.savedText;
    } else if (doc.rel) {
      try { saved = await this.deps.store.read(doc.rel); } catch { saved = doc.savedText; }
    }
    doc.savedText = saved;
    doc.current = saved;
    doc.title = titleOf(saved);
    this.post(doc, { type: 'reload', markdown: saved, mentions: await this.resolve(doc, mentionPaths(saved)) });
    this.updateTab(doc);
    this.scheduleDrafts();
    this.changed();
  }

  // ------------------------------------------------------------------ closing

  private onPanelDisposed(panel: vscode.WebviewPanel): void {
    const doc = this.panelDocs.get(panel);
    this.panelDocs.delete(panel);
    if (this.quietClose.delete(panel) || !doc || doc.panel !== panel) return;
    doc.panel = undefined;
    clearTimeout(doc.autoSaveTimer);
    if (this.active === doc) this.setActive(undefined);
    for (const resolve of doc.flushes.values()) resolve({ markdown: doc.current, title: doc.title });
    doc.flushes.clear();
    if (doc.claude) {
      // Claude Code's prompt is on disk already; tell the helper it's final. Its images stay: Claude reads them.
      void this.finishClaude(doc);
      this.forget(doc);
    } else if (doc.dirty && (doc.rel || doc.current.trim())) {
      this.closeQueue.push(doc);
      clearTimeout(this.closeTimer);
      // Close All closes several tabs in one go: ask once for all of them.
      this.closeTimer = setTimeout(() => { this.closing = this.askToSave(); }, 60);
    } else {
      if (!doc.rel) void this.discardImages(doc);
      this.forget(doc);
    }
    this.changed();
  }

  private async askToSave(): Promise<void> {
    const docs = this.closeQueue.splice(0).filter((d) => !d.panel && d.dirty);
    if (!docs.length) return;
    const message = docs.length === 1
      ? `Do you want to save the changes you made to "${docs[0].displayTitle}"?`
      : `Do you want to save the changes to the following ${docs.length} prompts?`;
    const detail = (docs.length > 1 ? docs.map((d) => d.displayTitle).join('\n') + '\n\n' : '') + "Your changes will be lost if you don't save them.";
    const choice = await this.dialogs.warn(message, { modal: true, detail }, 'Save', "Don't Save");
    if (choice === 'Save') {
      for (const doc of docs) if (await this.save(doc, 'close')) this.forget(doc);
    } else if (choice === "Don't Save") {
      for (const doc of docs) {
        if (!doc.rel) await this.discardImages(doc);
        this.forget(doc);
      }
    } else {
      // Cancel: bring the prompts back with their changes.
      for (const doc of docs) this.openDoc(doc, { focus: true });
    }
    this.scheduleDrafts();
    this.changed();
  }

  /** Drop a document that has no tab and nothing unsaved. */
  private forget(doc: PromptDoc): void {
    if (doc.panel) return;
    this.docs.delete(doc.id);
    this.scheduleDrafts();
  }

  /** Remove images added to a never-saved prompt that no saved prompt uses. */
  private async discardImages(doc: PromptDoc): Promise<void> {
    if (!doc.sessionImages.size) return;
    const unused = [...doc.sessionImages].filter((img) => !this.imageInUse(img, doc));
    await this.deps.images.deleteImages(unused);
  }

  /** Is an image (workspace-relative path) referenced by any saved prompt or other open prompt? */
  imageInUse(wsPath: string, except?: PromptDoc): boolean {
    const name = wsPath.slice(wsPath.lastIndexOf('/') + 1);
    const needles = [`images/${name}`, `images/${encodeURI(name)}`];
    for (const e of this.deps.library.all()) {
      if (except?.rel === e.rel) continue;
      if (needles.some((n) => e.text.includes(n))) return true;
    }
    for (const d of this.docs.values()) {
      if (d === except) continue;
      if (imagePaths(d.current, d.dir).includes(wsPath)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ Claude Code's prompt (Ctrl+G)

  /** The text Claude gets: its own text until the prompt is edited, then the Markdown with images and @paths for Claude. */
  claudeText(doc: PromptDoc): string {
    const c = doc.claude!;
    if (c.baseline === undefined || doc.current === c.baseline) return doc.savedText;
    const { text } = toPromptText(doc.current, doc.dir);
    if (!c.cwd) return text;
    return rebaseMentions(text, this.deps.store.workspaceRoot, c.cwd, (abs) => {
      let found = c.exists.get(abs);
      if (found === undefined) c.exists.set(abs, (found = fs.existsSync(abs)));
      return found;
    });
  }

  /** Write Claude's file (one write at a time, in order). Its folder is gone if the helper was cancelled. */
  private writeClaude(doc: PromptDoc): Promise<void> {
    const c = doc.claude!;
    const text = this.claudeText(doc);
    if (text !== c.written) {
      c.written = text;
      c.writing = c.writing.then(() => fs.promises.writeFile(c.file, text)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') this.deps.log.warn(`couldn't write Claude's prompt: ${e}`);
      });
    }
    return c.writing;
  }

  /** The tab was closed: write the last edit, then .done so the helper hands the file back to Claude. */
  private async finishClaude(doc: PromptDoc): Promise<void> {
    await this.writeClaude(doc);
    try {
      await fs.promises.writeFile(path.join(path.dirname(doc.claude!.file), CLAUDE_DONE_FILE), '');
    } catch { /* the helper was cancelled and removed its folder */ }
  }

  // ------------------------------------------------------------------ drafts backup (survive reloads)

  private loadDrafts(drafts: Record<string, Draft>): void {
    for (const [id, d] of Object.entries(drafts)) {
      if (this.docs.has(id)) continue;
      const doc = new PromptDoc(id, d.rel, new Date(d.created), '', d.markdown);
      // savedText is unknown until the file is read; read it now so dirty is right.
      this.docs.set(id, doc);
      if (d.rel) {
        void this.deps.store.read(d.rel).then((t) => {
          doc.savedText = t;
          if (!doc.dirty) this.forget(doc);
          this.changed();
        }, () => { /* file gone: the draft keeps the text */ });
      }
    }
  }

  private scheduleDrafts(): void {
    clearTimeout(this.draftsTimer);
    this.draftsTimer = setTimeout(() => this.writeDraftsNow(), 400);
  }

  /** The backed-up drafts (tests read them). */
  drafts(): Record<string, Draft> {
    return this.deps.context.workspaceState.get<Record<string, Draft>>(DRAFTS_KEY, {});
  }

  writeDraftsNow(): void {
    clearTimeout(this.draftsTimer);
    const drafts: Record<string, Draft> = {};
    for (const doc of this.docs.values()) {
      if (doc.dirty && (doc.rel || doc.current.trim())) drafts[doc.id] = { rel: doc.rel, created: doc.created.getTime(), markdown: doc.current };
    }
    void this.deps.context.workspaceState.update(DRAFTS_KEY, drafts);
  }

  // ------------------------------------------------------------------ tab + state

  private updateTab(doc: PromptDoc): void {
    const panel = doc.panel;
    if (!panel) return;
    panel.title = doc.displayTitle;
    const media = vscode.Uri.joinPath(this.deps.context.extensionUri, 'media');
    const icon = doc.dirty ? 'tab-dirty' : 'tab';
    panel.iconPath = { light: vscode.Uri.joinPath(media, `${icon}-light.svg`), dark: vscode.Uri.joinPath(media, `${icon}-dark.svg`) };
  }

  private setActive(doc: PromptDoc | undefined): void {
    if (this.active === doc) return;
    this.active = doc;
    void vscode.commands.executeCommand('setContext', 'promptComposer.activeSaved', !!doc?.rel);
    this.deps.onActiveChanged(doc);
    this.changed();
  }

  /** Something the panel shows changed (open/dirty/active/titles). */
  private changed(): void {
    this.deps.library.touch();
    void vscode.commands.executeCommand('setContext', 'promptComposer.activeSaved', !!this.active?.rel);
  }

  // ------------------------------------------------------------------ commands

  async insertImage(doc = this.active): Promise<void> {
    if (!doc) return;
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Insert Image',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
    });
    if (!files?.length) return;
    const paths: string[] = [];
    for (const f of files) {
      try {
        const name = await this.deps.images.copyFile(f.fsPath);
        doc.sessionImages.add(this.deps.images.workspaceRel(name));
        paths.push(this.deps.images.linkFor(name));
      } catch (e) {
        void vscode.window.showErrorMessage(`Prompt Composer: couldn't copy ${path.basename(f.fsPath)}. ${e}`);
      }
    }
    if (paths.length) this.post(doc, { type: 'insertImages', paths });
  }

  /** The Markdown of a prompt for "Copy as Prompt", with images turned into @paths. */
  async promptText(id: string | undefined): Promise<{ text: string; images: number; title: string } | undefined> {
    const doc = id ? this.docById(id) : this.active;
    if (doc) {
      const { markdown } = await this.flush(doc);
      return { ...toPromptText(markdown, doc.dir), title: doc.displayTitle };
    }
    if (!id || id.startsWith('doc:')) return undefined;
    const text = await this.deps.store.read(id);
    return { ...toPromptText(text, `${STORE_DIR}/${id.split('/')[0]}`), title: titleOf(text) || UNTITLED };
  }

  async closeTabFor(rel: string): Promise<void> {
    const doc = this.docByRel(rel);
    if (!doc) return;
    if (doc.panel) {
      this.quietClose.add(doc.panel);
      doc.panel.dispose();
      doc.panel = undefined;
    }
    this.docs.delete(doc.id);
    this.scheduleDrafts();
    this.changed();
  }

  /** Throw away an unsaved prompt: close its tab without asking and remove images only it used. */
  async discard(doc: PromptDoc): Promise<void> {
    if (doc.panel) {
      this.quietClose.add(doc.panel);
      doc.panel.dispose();
      doc.panel = undefined;
    }
    if (this.active === doc) this.setActive(undefined);
    if (!doc.rel) await this.discardImages(doc);
    this.docs.delete(doc.id);
    this.scheduleDrafts();
    this.changed();
  }

  goToBroken(): void {
    if (this.active) this.post(this.active, { type: 'goToBroken' });
  }
}
