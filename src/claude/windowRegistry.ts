// Lets the claude-prompt-composer helper (Claude Code's Ctrl+G) find the VS Code window open on Claude's folder.
// Each window with a folder writes one file, named by its extension host's process id (the helper drops files
// whose process is gone):
//   line 1  the window's folder
//   line 2  what to pass to `code` to reach this window: its .code-workspace file, or the folder
// The file is rewritten whenever the window gains focus, so the newest one belongs to the window used last.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function windowRegistryDir(): string {
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'prompt-composer', 'windows');
}

export class WindowRegistry implements vscode.Disposable {
  private readonly file = path.join(windowRegistryDir(), String(process.pid));
  private readonly content: string;
  private readonly listener: vscode.Disposable;

  constructor(folder: string, workspaceFile: vscode.Uri | undefined, private readonly log: vscode.LogOutputChannel) {
    const open = workspaceFile?.scheme === 'file' ? workspaceFile.fsPath : folder;
    this.content = `${folder}\n${open}\n`;
    this.write();
    this.listener = vscode.window.onDidChangeWindowState((s) => { if (s.focused) this.write(); });
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, this.content);
    } catch (e) {
      this.log.warn(`window registry: ${e}`);
    }
  }

  dispose(): void {
    this.listener.dispose();
    try { fs.rmSync(this.file, { force: true }); } catch { /* already gone */ }
  }
}
