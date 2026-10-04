// Opening .prompt-composer/YYYY-MM/x.prompt from the Explorer (or anywhere) shows the prompt in the composer.
// A custom editor registered for exactly those files hands them to the EditorManager and closes itself.
import * as vscode from 'vscode';
import type { EditorManager } from './editorManager';
import type { PromptStore } from '../store/promptStore';

export const REDIRECT_VIEW_TYPE = 'promptComposer.redirect';

export class RedirectEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly editors: EditorManager, private readonly store: PromptStore) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.html = '<!doctype html><html><body></body></html>';
    const rel = document.uri.scheme === 'file' ? this.store.relOf(document.uri.fsPath) : undefined;
    const column = panel.viewColumn;
    if (!rel) {
      // A prompt-shaped path outside this workspace's store: show it as text instead.
      setTimeout(() => {
        panel.dispose();
        void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', column);
      }, 0);
      return;
    }
    // Let VS Code finish showing this tab before replacing it, so the composer lands in the same group.
    setTimeout(() => {
      void this.editors.open(rel, { viewColumn: column, focus: true }).finally(() => panel.dispose());
    }, 0);
  }
}
