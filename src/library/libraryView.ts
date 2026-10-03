// The Prompts panel in the Primary Side Bar (a webview view): search, Pinned, months → days → prompts.
import * as vscode from 'vscode';
import type { HostToLibrary, LibraryModel, LibraryToHost, PanelShow } from '../common/protocol';
import { buildLibraryModel } from '../store/libraryModel';
import type { Library } from '../store/library';
import type { EditorManager } from '../editor/editorManager';
import { webviewHtml } from '../editor/html';

export const LIBRARY_VIEW_ID = 'promptComposer.library';
const FOLDS_KEY = 'promptComposer.folds';

/** The panel.show setting: today (default), this month, or every month. */
export function panelShow(): PanelShow {
  const v = vscode.workspace.getConfiguration('promptComposer').get<string>('panel.show');
  return v === 'month' || v === 'all' ? v : 'today';
}

export class LibraryView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private query = '';
  private readonly disposables: vscode.Disposable[] = [];
  private renderTimer: NodeJS.Timeout | undefined;
  /** The last model sent (tests read it). */
  lastModel: LibraryModel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly library: Library | undefined,
    private readonly editors: EditorManager | undefined,
    private readonly actions: { newPrompt(): void; deletePrompt(id: string): Promise<void>; setShow(show: PanelShow): Promise<void> },
  ) {
    if (library) this.disposables.push(library.onDidChange(() => this.render()));
    this.disposables.push(vscode.window.onDidChangeWindowState((s) => {
      if (s.focused && this.view?.visible) void this.library?.resync();
    }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('promptComposer.panel.show')) this.render();
    }));
    // Today/Yesterday labels and the current month move at midnight.
    const tick = setInterval(() => this.render(), 60_000);
    this.disposables.push({ dispose: () => clearInterval(tick) });
  }

  dispose(): void {
    clearTimeout(this.renderTimer);
    for (const d of this.disposables) d.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri, 'library', 'Prompts');
    view.webview.onDidReceiveMessage((m: LibraryToHost) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (!view.visible) return;
      this.render();
      void this.library?.resync();
    });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    void this.library?.ensureLoaded().then(() => this.library?.prunePins());
  }

  private post(msg: HostToLibrary): void {
    void this.view?.webview.postMessage(msg);
  }

  collapseAll(): void {
    this.post({ type: 'collapseAll' });
  }

  async focusSearch(): Promise<void> {
    await vscode.commands.executeCommand(`${LIBRARY_VIEW_ID}.focus`);
    this.post({ type: 'focusSearch' });
  }

  setQuery(query: string): void {
    this.query = query;
    this.renderNow();
  }

  render(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.renderNow(), 15);
  }

  model(): LibraryModel {
    return buildLibraryModel(this.editors?.libraryItems() ?? [], {
      query: this.query,
      show: panelShow(),
      now: new Date(),
      folder: !!this.library,
      locale: vscode.env.language,
    });
  }

  renderNow(): void {
    clearTimeout(this.renderTimer);
    this.lastModel = this.model();
    this.post({ type: 'model', model: this.lastModel });
  }

  private async onMessage(m: LibraryToHost): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.post({ type: 'folds', collapsed: this.context.workspaceState.get<string[]>(FOLDS_KEY, []) });
        this.renderNow();
        return;
      case 'search':
        this.setQuery(m.query);
        return;
      case 'open': {
        const doc = this.editors?.docById(m.id);
        const viewColumn = m.side ? vscode.ViewColumn.Beside : undefined;
        if (doc && (!doc.rel || doc.panel)) this.editors?.openDoc(doc, { viewColumn, focus: m.focus });
        else if (!m.id.startsWith('doc:')) await this.editors?.open(m.id, { preview: m.preview && !m.side, focus: m.focus, viewColumn });
        return;
      }
      case 'newPrompt':
        this.actions.newPrompt();
        return;
      case 'delete':
        await this.actions.deletePrompt(m.id);
        return;
      case 'folds':
        await this.context.workspaceState.update(FOLDS_KEY, m.collapsed);
        return;
      case 'show':
        await this.actions.setShow(m.show);
        return;
      case 'log':
        console[m.level === 'info' ? 'log' : m.level](`[library] ${m.message}`);
        return;
    }
  }
}
