// Claude Code's Ctrl+G ("edit the prompt in your editor") opens the prompt here when the claude-prompt-composer
// helper is Claude's editor ($VISUAL). The helper copies Claude's temp file into a folder of its own as a
// .prompt and runs `code --wait` on it. Unlike prompts in .prompt-composer/, this file is edited in its own
// tab (no redirect), so `code --wait` returns exactly when you close that tab.
//
//   <Claude's temp folder>/claude-prompt-<id>/   made by the helper, removed by it afterwards
//     <name>.prompt   the prompt; every edit is written straight back, ready for Claude (images as @paths)
//     .cwd            Claude's working directory: @paths are made relative to it
//     .done           written once the tab is closed and the last edit is on disk
//
// Nothing here touches the library: the prompt isn't saved in .prompt-composer/ and isn't listed in the panel.
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EditorManager } from '../editor/editorManager';

export const CLAUDE_VIEW_TYPE = 'promptComposer.claude';
export const CLAUDE_CWD_FILE = '.cwd';
export const CLAUDE_DONE_FILE = '.done';

export class ClaudeEditorProvider implements vscode.CustomReadonlyEditorProvider {
  /** Without a folder there's no workspace for @ mentions and images: the tab explains instead. */
  constructor(private readonly editors: EditorManager | undefined) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    if (!this.editors || document.uri.scheme !== 'file') {
      panel.webview.html = '<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 1em 2em">' +
        '<p>Prompt Composer edits Claude Code\'s prompt in a window with a folder open.</p>' +
        '<p>Close this tab and Claude keeps the prompt as it was.</p></body></html>';
      return;
    }
    const file = document.uri.fsPath;
    let text = '';
    try { text = await fs.readFile(file, 'utf8'); } catch { /* gone: start empty */ }
    let cwd: string | undefined;
    try {
      cwd = (await fs.readFile(path.join(path.dirname(file), CLAUDE_CWD_FILE), 'utf8')).replace(/\r?\n$/, '') || undefined;
    } catch { /* no .cwd: @paths stay workspace-relative */ }
    this.editors.openClaude(panel, { file, cwd }, text);
  }
}
