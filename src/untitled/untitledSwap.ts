// Double-clicking empty space in the tab bar (or an empty editor group) makes VS Code open an empty
// "Untitled-1" text file. There's no command or setting behind that gesture, so the extension watches
// for a brand-new, empty, plain-text Untitled tab and swaps it for a new prompt in the same group.
// Ctrl+N goes through a wrapper command that marks the next Untitled file as a real one (setting "doubleClick").
import * as vscode from 'vscode';
import type { EditorManager } from '../editor/editorManager';

type Mode = 'doubleClick' | 'always' | 'off';

export class UntitledSwap implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /** Untitled documents opened in the last moment: uri → time. */
  private readonly fresh = new Map<string, number>();
  /** Ctrl+N was pressed: leave the next Untitled file alone until this time. */
  private skipUntil = 0;
  /** Swaps done (for tests). */
  swaps = 0;

  constructor(private readonly editors: EditorManager) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme !== 'untitled') return;
        if (Date.now() < this.skipUntil) {
          this.skipUntil = 0;
          return;
        }
        this.fresh.set(doc.uri.toString(), Date.now());
      }),
      vscode.window.tabGroups.onDidChangeTabs((e) => {
        for (const tab of e.opened) void this.consider(tab);
      }),
      vscode.commands.registerCommand('promptComposer.newTextFile', () => this.newTextFile()),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private mode(): Mode {
    return vscode.workspace.getConfiguration('promptComposer').get<Mode>('untitledFiles', 'doubleClick');
  }

  /** Ctrl+N: a normal text file, as always. */
  async newTextFile(): Promise<void> {
    if (this.mode() === 'doubleClick') this.skipUntil = Date.now() + 1500;
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
  }

  private async consider(tab: vscode.Tab): Promise<void> {
    if (this.mode() === 'off') return;
    if (!(tab.input instanceof vscode.TabInputText) || tab.input.uri.scheme !== 'untitled') return;
    const key = tab.input.uri.toString();
    // The document-open event normally comes first; give it a moment if the tab event won the race.
    if (!this.fresh.has(key)) await new Promise((r) => setTimeout(r, 50));
    const opened = this.fresh.get(key);
    this.fresh.delete(key);
    for (const [k, t] of this.fresh) if (Date.now() - t > 5000) this.fresh.delete(k);
    if (opened === undefined || Date.now() - opened > 1000) return;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (!doc || doc.isDirty || doc.getText() !== '') return;
    const defaultLang = vscode.workspace.getConfiguration('files').get<string>('defaultLanguage', '') || 'plaintext';
    if (doc.languageId !== 'plaintext' && doc.languageId !== defaultLang) return;
    // Open the prompt first so the group isn't emptied (and closed), then drop the Untitled tab.
    this.editors.newPrompt({ viewColumn: tab.group.viewColumn });
    this.swaps++;
    const current = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
      .find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key);
    if (current) await vscode.window.tabGroups.close(current, true);
  }
}
