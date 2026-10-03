// Prompt Composer: an automated prompt library plus a rich prompt editor for Claude Code.
// Activation is cheap (registrations only); prompts are read when the panel or an editor first needs them.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { PromptStore } from './store/promptStore';
import { Library } from './store/library';
import { EditorManager, PromptDoc } from './editor/editorManager';
import { REDIRECT_VIEW_TYPE, RedirectEditorProvider } from './editor/redirectEditor';
import { LIBRARY_VIEW_ID, LibraryView } from './library/libraryView';
import { UntitledSwap } from './untitled/untitledSwap';
import { FileIndex } from './mentions/fileIndex';
import { ImageStore } from './images/imageStore';
import { PromptStatusBar } from './status/statusBar';
import { imagePaths, titleOf } from './common/markdownText';
import { MONTH_DIR_RE, STORE_DIR } from './common/naming';
import { startTestBridge } from './testBridge';

/** Context passed to commands from the panel's right-click menu (data-vscode-context). */
interface RowContext { promptId?: string }

export interface PromptComposerApi {
  store: PromptStore;
  library: Library;
  editors: EditorManager;
  libraryView: LibraryView;
  untitled: UntitledSwap;
  index: FileIndex;
  images: ImageStore;
  statusBar: PromptStatusBar;
  /** Shows a file or folder in the OS file manager (VS Code hides the prompts folder). Tests replace it. */
  shell: { reveal(uri: vscode.Uri): Thenable<unknown> };
  deletePrompt(id: string, opts?: { confirm?: boolean; deleteImages?: boolean }): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): PromptComposerApi | undefined {
  const log = vscode.window.createOutputChannel('Prompt Composer', { log: true });
  context.subscriptions.push(log);
  const folder = vscode.workspace.workspaceFolders?.[0];
  const statusBar = new PromptStatusBar();
  context.subscriptions.push(statusBar);

  if (!folder || folder.uri.scheme !== 'file') {
    // No folder: the panel explains, commands say why they can't run.
    const view = new LibraryView(context, undefined, undefined, { newPrompt: () => void noFolder(), deletePrompt: async () => undefined });
    context.subscriptions.push(view, vscode.window.registerWebviewViewProvider(LIBRARY_VIEW_ID, view));
    for (const id of ['newPrompt', 'focusSearch', 'revealFolder', 'revealFolderInFinder', 'collapseAll', 'showAllMonths', 'hideOlderMonths', 'newTextFile']) {
      context.subscriptions.push(vscode.commands.registerCommand(`promptComposer.${id}`, () =>
        id === 'newTextFile' ? vscode.commands.executeCommand('workbench.action.files.newUntitledFile') : noFolder()));
    }
    return undefined;
  }

  const config = () => vscode.workspace.getConfiguration('promptComposer');
  const store = new PromptStore(folder.uri.fsPath, () => config().get('gitignore', true));
  const library = new Library(store, context.workspaceState);
  const index = new FileIndex(folder.uri.fsPath, context.workspaceState, (m) => void vscode.window.showWarningMessage(m));
  const images = new ImageStore(store);
  const editors: EditorManager = new EditorManager({
    context, store, library, index, images, log,
    onActiveChanged: (doc) => statusBar.show(doc?.stats),
  });
  const untitled = new UntitledSwap(editors);
  const actions = { newPrompt: () => void editors.newPrompt(), deletePrompt: (id: string) => deletePrompt(id) };
  const libraryView = new LibraryView(context, library, editors, actions);
  context.subscriptions.push(library, index, editors, untitled, libraryView);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LIBRARY_VIEW_ID, libraryView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerCustomEditorProvider(REDIRECT_VIEW_TYPE, new RedirectEditorProvider(editors, store), {
      supportsMultipleEditorsPerDocument: false,
    }),
  );
  // Loading the library also lets the editors know titles of saved prompts.
  void library.ensureLoaded();

  const docFor = (ctx?: RowContext | vscode.Uri): PromptDoc | undefined => {
    if (ctx && 'promptId' in ctx && ctx.promptId) return editors.docById(ctx.promptId);
    return editors.activeDoc;
  };
  const idFor = (ctx?: RowContext | vscode.Uri): string | undefined => {
    if (ctx && 'promptId' in ctx && ctx.promptId) return ctx.promptId;
    const doc = editors.activeDoc;
    return doc ? doc.rel ?? `doc:${doc.id}` : undefined;
  };
  const setShowAll = async (value: boolean) => {
    const c = config();
    const target = c.inspect('panel.showAllMonths')?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await c.update('panel.showAllMonths', value, target);
  };

  async function deletePrompt(id: string, opts: { confirm?: boolean; deleteImages?: boolean } = {}): Promise<void> {
    const confirm = opts.confirm ?? true;
    const doc = editors.docById(id);
    if (id.startsWith('doc:')) {
      if (!doc) return;
      if (confirm) {
        const ok = await editors.dialogs.warn(`Delete the unsaved prompt "${doc.displayTitle}"?`, { modal: true }, 'Delete');
        if (ok !== 'Delete') return;
      }
      await editors.discard(doc);
      return;
    }
    let text = '';
    try { text = await store.read(id); } catch { /* already gone */ }
    const title = doc?.displayTitle ?? (titleOf(text) || 'Untitled prompt');
    const promptDir = `${STORE_DIR}/${id.split('/')[0]}`;
    const own = imagePaths(text, promptDir).filter((p) => p.startsWith(`${STORE_DIR}/images/`) && !editors.imageInUse(p, doc ?? ({ rel: id } as PromptDoc)));
    let withImages = opts.deleteImages ?? false;
    if (confirm) {
      const buttons = own.length ? [`Delete Prompt and ${own.length} Image${own.length > 1 ? 's' : ''}`, 'Delete Prompt Only'] : ['Delete'];
      const detail = (own.length ? `${own.length === 1 ? 'One image is' : `${own.length} images are`} used only by this prompt.\n` : '') +
        'You can restore it from the Recycle Bin / Trash.';
      const choice = await editors.dialogs.warn(`Are you sure you want to delete "${title}"?`, { modal: true, detail }, ...buttons);
      if (!choice) return;
      withImages = own.length > 0 && choice === buttons[0];
    }
    await editors.closeTabFor(id);
    const uri = vscode.Uri.file(store.absOf(id));
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch {
      try { await vscode.workspace.fs.delete(uri, { useTrash: false }); } catch { /* gone */ }
    }
    if (withImages) {
      for (const img of own) {
        try { await vscode.workspace.fs.delete(vscode.Uri.file(path.join(store.root, ...img.split('/').slice(1))), { useTrash: true }); } catch { /* gone */ }
      }
    }
    library.remove(id);
  }

  const copy = async (text: string, message: string) => {
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
  };

  const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`promptComposer.${id}`, fn));
  reg('newPrompt', () => editors.newPrompt());
  reg('collapseAll', () => libraryView.collapseAll());
  reg('showAllMonths', () => setShowAll(true));
  reg('hideOlderMonths', () => setShowAll(false));
  reg('focusSearch', () => libraryView.focusSearch());
  const shell = { reveal: (uri: vscode.Uri): Thenable<unknown> => vscode.commands.executeCommand('revealFileInOS', uri) };
  // The file manager opens inside the folder, on the newest month (Finder hides dot-folders, so selecting
  // .prompt-composer itself could show nothing).
  const revealFolder = async () => {
    await store.ensureRoot();
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(store.root)).then(undefined, () => []);
    const months = entries.filter(([n, t]) => t & vscode.FileType.Directory && MONTH_DIR_RE.test(n)).map(([n]) => n).sort();
    await shell.reveal(vscode.Uri.file(months.length ? path.join(store.root, months[months.length - 1]) : store.root));
  };
  reg('revealFolder', revealFolder);
  reg('revealFolderInFinder', revealFolder);
  reg('open', (ctx?: RowContext) => {
    const id = idFor(ctx);
    if (!id) return;
    const doc = editors.docById(id);
    if (doc && (!doc.rel || doc.panel)) return editors.openDoc(doc, { focus: true });
    if (!id.startsWith('doc:')) return editors.open(id, { focus: true });
  });
  reg('openToSide', (ctx?: RowContext) => {
    const id = idFor(ctx);
    if (!id) return;
    const doc = editors.docById(id);
    if (doc && (!doc.rel || doc.panel)) return editors.openDoc(doc, { viewColumn: vscode.ViewColumn.Beside, focus: true });
    if (!id.startsWith('doc:')) return editors.open(id, { viewColumn: vscode.ViewColumn.Beside, focus: true });
  });
  reg('copyAsPrompt', async (ctx?: RowContext | vscode.Uri) => {
    const r = await editors.promptText(idFor(ctx));
    if (!r) return;
    await copy(r.text, `Copied "${r.title}" as a prompt${r.images ? ` (${r.images} image${r.images > 1 ? 's' : ''} as @paths)` : ''}`);
  });
  reg('copyPath', async (ctx?: RowContext) => {
    const id = idFor(ctx);
    const rel = id && !id.startsWith('doc:') ? id : docFor(ctx)?.rel;
    if (!rel) return;
    const p = `${STORE_DIR}/${rel}`;
    await copy(/\s/.test(p) ? `@"${p}"` : `@${p}`, `Copied @${p}`);
  });
  reg('pin', (ctx?: RowContext) => { const id = idFor(ctx); if (id && !id.startsWith('doc:')) return library.setPinned(id, true); });
  reg('unpin', (ctx?: RowContext) => { const id = idFor(ctx); if (id && !id.startsWith('doc:')) return library.setPinned(id, false); });
  reg('duplicate', async (ctx?: RowContext) => {
    const id = idFor(ctx);
    if (!id || id.startsWith('doc:')) return;
    const text = await store.read(id);
    const rel = await store.allocate(new Date(), titleOf(text));
    library.beginWrite(rel);
    const st = await store.write(rel, text);
    library.endWrite(rel, text, st);
    await editors.open(rel, { focus: true });
  });
  const revealPrompt = async (ctx?: RowContext) => {
    const id = idFor(ctx);
    if (id && !id.startsWith('doc:')) await shell.reveal(vscode.Uri.file(store.absOf(id)));
  };
  reg('revealInOS', revealPrompt);
  reg('revealInFinder', revealPrompt);
  reg('delete', (ctx?: RowContext) => { const id = idFor(ctx); if (id) return deletePrompt(id); });
  reg('save', () => editors.saveActive());
  reg('revert', () => { const d = editors.activeDoc; if (d) return editors.revert(d); });
  reg('openAsText', async () => {
    const d = editors.activeDoc;
    if (!d?.rel) return;
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(store.absOf(d.rel)), 'default', vscode.ViewColumn.Beside);
    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
  });
  reg('insertImage', () => editors.insertImage());
  reg('goToBrokenMention', () => editors.goToBroken());
  reg('insertLink', () => { const d = editors.activeDoc; if (d) editors.post(d, { type: 'command', name: 'link' }); });
  // Swallows workbench shortcuts (Ctrl+B, Ctrl+E…) while the editor has focus; the editor handles the key itself.
  reg('noop', () => undefined);

  const api: PromptComposerApi = { store, library, editors, libraryView, untitled, index, images, statusBar, shell, deletePrompt };
  if (context.extensionMode !== vscode.ExtensionMode.Production && process.env.PROMPT_COMPOSER_E2E_PORT) {
    context.subscriptions.push(startTestBridge(api, Number(process.env.PROMPT_COMPOSER_E2E_PORT), log));
  }
  log.info(`activated for ${folder.uri.fsPath}`);
  return context.extensionMode === vscode.ExtensionMode.Test || process.env.PROMPT_COMPOSER_TEST ? api : undefined;
}

async function noFolder(): Promise<void> {
  const choice = await vscode.window.showInformationMessage('Open a folder to use Prompt Composer. Prompts are saved in the folder you work in.', 'Open Folder');
  if (choice) await vscode.commands.executeCommand('workbench.action.files.openFolder');
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
