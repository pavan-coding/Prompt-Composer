// In-memory index of every saved prompt (title + search text), kept current by a file watcher on
// .prompt-composer/*/*.md, plus pins. Loaded the first time something needs it, never at startup.
import * as vscode from 'vscode';
import { PromptStore, StoredPrompt } from './promptStore';
import { searchLines, titleOf } from '../common/markdownText';
import { STORE_DIR } from '../common/naming';

export interface LibraryEntry {
  rel: string;
  created: Date;
  title: string;
  /** Plain text for search (searchLines joined by "\n") and its lower-case form. */
  text: string;
  lower: string;
  mtimeMs: number;
  size: number;
}

const PINS_KEY = 'promptComposer.pins';

function entryOf(f: StoredPrompt, md: string): LibraryEntry {
  const text = searchLines(md).join('\n');
  return { rel: f.rel, created: f.created, title: titleOf(md), text, lower: text.toLowerCase(), mtimeMs: f.mtimeMs, size: f.size };
}

export class Library implements vscode.Disposable {
  private entries = new Map<string, LibraryEntry>();
  private loading: Promise<void> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires (debounced) whenever the list of prompts or their titles change. */
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private changeTimer: NodeJS.Timeout | undefined;
  /** Paths being written by this extension right now; watcher events for them are ignored. */
  private readonly writing = new Set<string>();

  constructor(readonly store: PromptStore, private readonly state: vscode.Memento) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(store.workspaceRoot), `${STORE_DIR}/*/*.md`),
    );
    const refresh = (uri: vscode.Uri) => {
      const rel = store.relOf(uri.fsPath);
      if (rel && !this.writing.has(rel) && this.loading) void this.refreshEntry(rel);
    };
    watcher.onDidCreate(refresh, null, this.disposables);
    watcher.onDidChange(refresh, null, this.disposables);
    watcher.onDidDelete((uri) => {
      const rel = store.relOf(uri.fsPath);
      if (rel && this.entries.delete(rel)) this.fireChange();
    }, null, this.disposables);
    this.disposables.push(watcher, this.changeEmitter);
  }

  dispose(): void {
    clearTimeout(this.changeTimer);
    for (const d of this.disposables) d.dispose();
  }

  private fireChange(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.changeEmitter.fire(), 30);
  }

  /** Read every prompt once (titles and text). Later calls return the same promise. */
  ensureLoaded(): Promise<void> {
    this.loading ??= (async () => {
      const files = await this.store.list();
      const queue = files.slice();
      const worker = async () => {
        for (let f = queue.pop(); f; f = queue.pop()) await this.readEntry(f);
      };
      await Promise.all(Array.from({ length: 16 }, worker));
      this.fireChange();
    })();
    return this.loading;
  }

  get loaded(): boolean {
    return this.loading !== undefined;
  }

  private async readEntry(f: StoredPrompt): Promise<void> {
    try {
      const text = await this.store.read(f.rel);
      this.entries.set(f.rel, entryOf(f, text));
    } catch {
      this.entries.delete(f.rel);
    }
  }

  private async refreshEntry(rel: string): Promise<void> {
    const st = await this.store.stat(rel);
    if (!st) {
      if (this.entries.delete(rel)) this.fireChange();
      return;
    }
    const cur = this.entries.get(rel);
    if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size) return;
    await this.readEntry(st);
    this.fireChange();
  }

  /** Called around a save so the watcher doesn't re-read what we just wrote. */
  beginWrite(rel: string): void {
    this.writing.add(rel);
  }

  endWrite(rel: string, text: string | undefined, st: StoredPrompt | undefined): void {
    this.writing.delete(rel);
    if (st && text !== undefined) {
      this.entries.set(rel, entryOf(st, text));
    }
    this.fireChange();
  }

  remove(rel: string): void {
    if (this.entries.delete(rel)) this.fireChange();
    if (this.isPinned(rel)) void this.setPinned(rel, false);
  }

  get(rel: string): LibraryEntry | undefined {
    return this.entries.get(rel);
  }

  all(): LibraryEntry[] {
    return [...this.entries.values()];
  }

  // ------------------------------------------------------------- pins (workspace storage)

  private pins(): string[] {
    return this.state.get<string[]>(PINS_KEY, []);
  }

  isPinned(rel: string): boolean {
    return this.pins().includes(rel);
  }

  async setPinned(rel: string, pinned: boolean): Promise<void> {
    const pins = this.pins().filter((p) => p !== rel);
    if (pinned) pins.push(rel);
    await this.state.update(PINS_KEY, pins);
    this.fireChange();
  }

  /** Forget pins whose files are gone (run after loading). */
  async prunePins(): Promise<void> {
    const pins = this.pins();
    const kept = pins.filter((p) => this.entries.has(p));
    if (kept.length !== pins.length) await this.state.update(PINS_KEY, kept);
  }

  /** Ask listeners to rebuild (open/dirty state changed elsewhere). */
  touch(): void {
    this.fireChange();
  }

  /**
   * Re-list the store and fix up the in-memory list. VS Code's watcher drops a create+delete pair that
   * happens in quick succession, so the panel re-checks when it's shown and when the window regains focus.
   */
  async resync(): Promise<void> {
    if (!this.loading) return;
    await this.loading;
    const files = await this.store.list();
    const onDisk = new Set(files.map((f) => f.rel));
    let changed = false;
    for (const rel of [...this.entries.keys()]) {
      if (!onDisk.has(rel) && !this.writing.has(rel)) { this.entries.delete(rel); changed = true; }
    }
    for (const f of files) {
      const cur = this.entries.get(f.rel);
      if (!cur || cur.mtimeMs !== f.mtimeMs || cur.size !== f.size) { await this.readEntry(f); changed = true; }
    }
    if (changed) this.fireChange();
  }
}
