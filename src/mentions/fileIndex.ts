// Every file and folder in the workspace for the @ picker, following symlinks and Windows junctions.
// Built in the background the first time a prompt opens, then kept current by file watchers
// (one extra watcher per symlinked folder, since VS Code's recursive watcher doesn't follow links).
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { IndexEntry, searchIndex } from './fuzzy';
import type { MentionItem } from '../common/protocol';
import { STORE_DIR } from '../common/naming';

const RECENT_KEY = 'promptComposer.recentFiles';
const ALWAYS_EXCLUDED = ['.git', STORE_DIR];

interface Walk {
  abs: string;
  rel: string;
  depth: number;
  /** Real path of this folder, and the chain of real paths above it (to stop symlink cycles). */
  real: string;
  parent?: Walk;
  via?: { name: string; link: string };
}

export class FileIndex implements vscode.Disposable {
  private entries: IndexEntry[] = [];
  private byPath = new Map<string, IndexEntry>();
  private building: Promise<void> | undefined;
  private indexing = false;
  private capped = false;
  private exclude: (rel: string) => boolean = () => false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly linkWatchers = new Map<string, vscode.Disposable>();
  /** Symlinked folders: real target path → the link's workspace path. */
  private readonly linkTargets = new Map<string, string>();

  constructor(
    readonly root: string,
    private readonly state: vscode.Memento,
    private readonly warn: (message: string) => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('promptComposer.mentions')) this.rebuild();
      }),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        const uri = ed?.document.uri;
        if (uri?.scheme !== 'file') return;
        const rel = this.relOf(uri.fsPath);
        if (rel) void this.addRecent(rel);
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const d of this.linkWatchers.values()) d.dispose();
  }

  relOf(abs: string): string | undefined {
    const r = path.relative(this.root, abs);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) {
      // inside a symlinked folder's real target?
      for (const [target, linkRel] of this.linkTargets) {
        const t = path.relative(target, abs);
        if (t && !t.startsWith('..') && !path.isAbsolute(t)) return `${linkRel}/${t.split(path.sep).join('/')}`;
      }
      return undefined;
    }
    return r.split(path.sep).join('/');
  }

  get size(): number {
    return this.entries.length;
  }

  get isIndexing(): boolean {
    return this.indexing;
  }

  /** Start building (once). Resolves when the first full walk is done. */
  ensureBuilt(): Promise<void> {
    if (!this.building) {
      this.building = this.build();
      this.watchWorkspace();
    }
    return this.building;
  }

  private rebuild(): void {
    if (!this.building) return;
    this.building = this.build();
  }

  search(query: string, limit = 50): MentionItem[] {
    return searchIndex(this.entries, query, this.state.get<string[]>(RECENT_KEY, []), limit);
  }

  get(rel: string): IndexEntry | undefined {
    return this.byPath.get(rel.replace(/\/+$/, ''));
  }

  private async addRecent(rel: string): Promise<void> {
    const list = [rel, ...this.state.get<string[]>(RECENT_KEY, []).filter((p) => p !== rel)].slice(0, 20);
    await this.state.update(RECENT_KEY, list);
  }

  private makeExclude(): (rel: string) => boolean {
    const filesExclude = vscode.workspace.getConfiguration('files', vscode.Uri.file(this.root)).get<Record<string, unknown>>('exclude', {});
    const globs = Object.entries(filesExclude).filter(([, v]) => v === true).map(([k]) => k);
    globs.push(...vscode.workspace.getConfiguration('promptComposer').get<string[]>('mentions.exclude', []));
    const match = globs.length ? picomatch(globs, { dot: true }) : () => false;
    return (rel) => ALWAYS_EXCLUDED.includes(rel) || match(rel);
  }

  private async build(): Promise<void> {
    this.indexing = true;
    this.capped = false;
    this.exclude = this.makeExclude();
    const max = Math.max(1000, vscode.workspace.getConfiguration('promptComposer').get<number>('mentions.maxEntries', 200000));
    const entries: IndexEntry[] = [];
    const byPath = new Map<string, IndexEntry>();
    const targets = new Map<string, string>();
    // Results stay searchable while the walk runs.
    this.entries = entries;
    this.byPath = byPath;
    let rootReal = this.root;
    try { rootReal = await fs.realpath(this.root); } catch { /* keep */ }
    const queue: Walk[] = [{ abs: this.root, rel: '', depth: -1, real: rootReal }];
    const add = (e: IndexEntry) => {
      if (entries.length >= max) {
        if (!this.capped) {
          this.capped = true;
          this.warn(`Prompt Composer: @ mentions list the first ${max.toLocaleString()} files and folders. Raise "promptComposer.mentions.maxEntries" or exclude folders to see the rest.`);
        }
        return false;
      }
      entries.push(e);
      byPath.set(e.path, e);
      return true;
    };
    const worker = async () => {
      for (let w = queue.shift(); w && !this.capped; w = queue.shift()) {
        await this.walkDir(w, add, queue, targets);
      }
    };
    // A few walkers in parallel: disk-bound, so more doesn't help.
    while (queue.length && !this.capped) await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
    this.linkTargets.clear();
    for (const [k, v] of targets) this.linkTargets.set(k, v);
    this.watchLinkTargets();
    this.indexing = false;
  }

  private async walkDir(w: Walk, add: (e: IndexEntry) => boolean, queue: Walk[], targets: Map<string, string>): Promise<void> {
    let dirents: Dirent[];
    try { dirents = await fs.readdir(w.abs, { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      const rel = w.rel ? `${w.rel}/${d.name}` : d.name;
      if (this.exclude(rel)) continue;
      const abs = path.join(w.abs, d.name);
      const entry = await this.describe(abs, rel, w.depth + 1, d, w.via);
      if (!entry || !add(entry)) { if (this.capped) return; continue; }
      if (entry.kind !== 'dir' || entry.broken) continue;
      let real = path.join(w.real, d.name);
      if (entry.link) {
        try { real = await fs.realpath(abs); } catch { continue; }
        // A link back to a folder already on this branch would loop forever: list it, don't walk it.
        let cycle = false;
        for (let p: Walk | undefined = w; p; p = p.parent) if (p.real === real) { cycle = true; break; }
        if (cycle || real === this.root) continue;
        targets.set(real, rel);
      }
      queue.push({ abs, rel, depth: w.depth + 1, real, parent: w, via: entry.link ? { name: d.name, link: entry.link } : w.via });
    }
  }

  private async describe(abs: string, rel: string, depth: number, d: Dirent | undefined, via: Walk['via']): Promise<IndexEntry | undefined> {
    const nameAt = rel.lastIndexOf('/') + 1;
    const base = { path: rel, lower: rel.toLowerCase(), nameAt, depth, via };
    let isLink = d?.isSymbolicLink();
    let isDir = d?.isDirectory();
    if (!d || (!isLink && !isDir && !d.isFile())) {
      try {
        const st = await fs.lstat(abs);
        isLink = st.isSymbolicLink();
        isDir = st.isDirectory();
        if (!isLink && !isDir && !st.isFile()) return undefined;
      } catch { return undefined; }
    }
    if (isLink) {
      let link = '';
      try { link = await fs.readlink(abs); } catch { /* unreadable */ }
      try {
        const st = await fs.stat(abs);
        return { ...base, kind: st.isDirectory() ? 'dir' : 'file', link };
      } catch {
        return { ...base, kind: 'file', link, broken: true };
      }
    }
    return { ...base, kind: isDir ? 'dir' : 'file' };
  }

  // ------------------------------------------------------------- watching

  private watchWorkspace(): void {
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.root), '**/*'));
    w.onDidCreate((u) => void this.onCreate(u.fsPath), null, this.disposables);
    w.onDidDelete((u) => this.onDelete(u.fsPath), null, this.disposables);
    this.disposables.push(w);
  }

  private watchLinkTargets(): void {
    for (const [target, d] of this.linkWatchers) if (!this.linkTargets.has(target)) { d.dispose(); this.linkWatchers.delete(target); }
    let n = this.linkWatchers.size;
    for (const target of this.linkTargets.keys()) {
      if (this.linkWatchers.has(target) || n >= 50) continue;
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(target), '**/*'));
      w.onDidCreate((u) => void this.onCreate(u.fsPath));
      w.onDidDelete((u) => this.onDelete(u.fsPath));
      this.linkWatchers.set(target, w);
      n++;
    }
  }

  private async onCreate(abs: string): Promise<void> {
    if (!this.building) return;
    const rel = this.relOf(abs);
    if (!rel || this.byPath.has(rel) || this.exclude(rel)) return;
    const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const parent = parentRel ? this.byPath.get(parentRel) : undefined;
    if (parentRel && !parent) return; // inside an excluded or unknown folder
    const linkAbs = path.join(this.root, ...rel.split('/'));
    const entry = await this.describe(linkAbs, rel, rel.split('/').length - 1, undefined, parent?.link ? { name: parent.path.slice(parent.nameAt), link: parent.link } : parent?.via);
    if (!entry || this.byPath.has(rel)) return;
    this.entries.push(entry);
    this.byPath.set(rel, entry);
    if (entry.kind === 'dir' && !entry.broken) {
      let real = linkAbs;
      try { real = await fs.realpath(linkAbs); } catch { /* keep */ }
      const queue: Walk[] = [{ abs: linkAbs, rel, depth: entry.depth, real, via: entry.link ? { name: entry.path.slice(entry.nameAt), link: entry.link } : entry.via }];
      const add = (e: IndexEntry) => { if (this.byPath.has(e.path)) return true; this.entries.push(e); this.byPath.set(e.path, e); return true; };
      for (let w = queue.shift(); w; w = queue.shift()) await this.walkDir(w, add, queue, this.linkTargets);
      if (entry.link) this.watchLinkTargets();
    }
  }

  private onDelete(abs: string): void {
    const rel = this.relOf(abs);
    if (!rel || !this.byPath.has(rel)) return;
    const prefix = rel + '/';
    // filter in place: a walk in progress may still be appending to this same array
    let kept = 0;
    for (const e of this.entries) if (e.path !== rel && !e.path.startsWith(prefix)) this.entries[kept++] = e;
    this.entries.length = kept;
    for (const k of [...this.byPath.keys()]) if (k === rel || k.startsWith(prefix)) this.byPath.delete(k);
  }
}
