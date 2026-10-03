// Status bar items for the active prompt: mentions (and how many are broken), images, size.
import * as vscode from 'vscode';
import type { EditorStats } from '../common/protocol';

export class PromptStatusBar implements vscode.Disposable {
  private readonly mentions = vscode.window.createStatusBarItem('promptComposer.mentions', vscode.StatusBarAlignment.Right, 102);
  private readonly images = vscode.window.createStatusBarItem('promptComposer.images', vscode.StatusBarAlignment.Right, 101);
  private readonly size = vscode.window.createStatusBarItem('promptComposer.size', vscode.StatusBarAlignment.Right, 100);

  constructor() {
    this.mentions.name = 'Prompt Composer: Mentions';
    this.images.name = 'Prompt Composer: Images';
    this.size.name = 'Prompt Composer: Size';
    this.size.tooltip = 'Words, and a rough token estimate (characters ÷ 4)';
    this.images.tooltip = 'Images in this prompt';
  }

  show(stats: EditorStats | undefined): void {
    if (!stats) {
      this.hide();
      return;
    }
    this.mentions.text = `$(mention) ${stats.mentions}` + (stats.broken ? `  $(warning) ${stats.broken} broken` : '');
    this.mentions.tooltip = stats.broken ? 'Some @mentions point at files that no longer exist. Click to go to the first one.' : '@mentions in this prompt';
    this.mentions.command = stats.broken ? 'promptComposer.goToBrokenMention' : undefined;
    this.mentions.backgroundColor = undefined;
    this.images.text = `$(file-media) ${stats.images}`;
    const tokens = Math.round(stats.chars / 4);
    this.size.text = `${stats.words} words · ~${tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : tokens} tokens`;
    this.mentions.show();
    this.images.show();
    this.size.show();
  }

  hide(): void {
    this.mentions.hide();
    this.images.hide();
    this.size.hide();
  }

  /** Current texts (tests read these). */
  texts(): string[] {
    return [this.mentions.text, this.images.text, this.size.text];
  }

  dispose(): void {
    this.mentions.dispose();
    this.images.dispose();
    this.size.dispose();
  }
}
