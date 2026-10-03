// .prompt-composer/ on disk. Reads only one level deep: YYYY-MM/*.md. Only this extension writes here.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  GITIGNORE_CONTENT, IMAGES_DIR, MONTH_DIR_RE, STORE_DIR, createdFromName, isPromptFileName, monthKey,
  promptFileName, slugify,
} from '../common/naming';

export interface StoredPrompt {
  /** "2026-10/03-1415-x.md": the id used everywhere, relative to the store folder, with "/" separators. */
  rel: string;
  abs: string;
  created: Date;
  mtimeMs: number;
  size: number;
}

export class PromptStore {
  /** The store folder: <workspace>/.prompt-composer */
  readonly root: string;
  readonly imagesDir: string;

  constructor(readonly workspaceRoot: string, private readonly gitignoreEnabled: () => boolean) {
    this.root = path.join(workspaceRoot, STORE_DIR);
    this.imagesDir = path.join(this.root, IMAGES_DIR);
  }

  absOf(rel: string): string {
    return path.join(this.root, ...rel.split('/'));
  }

  /** "2026-10/03-1415-x.md" for an absolute path inside the store's month folders, else undefined. */
  relOf(abs: string): string | undefined {
    const r = path.relative(this.root, abs);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return undefined;
    const parts = r.split(path.sep);
    if (parts.length !== 2 || !MONTH_DIR_RE.test(parts[0]) || !isPromptFileName(parts[1])) return undefined;
    return parts.join('/');
  }

  /** Workspace-relative path with "/" separators, e.g. ".prompt-composer/2026-10/03-1415-x.md". */
  workspaceRel(rel: string): string {
    return `${STORE_DIR}/${rel}`;
  }

  /** Every prompt file: .prompt-composer/YYYY-MM/*.md, one level deep. */
  async list(): Promise<StoredPrompt[]> {
    let months: string[];
    try {
      months = (await fs.readdir(this.root, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && MONTH_DIR_RE.test(d.name)).map((d) => d.name);
    } catch {
      return [];
    }
    const out: StoredPrompt[] = [];
    await Promise.all(months.map(async (month) => {
      let entries: import('node:fs').Dirent[];
      try { entries = await fs.readdir(path.join(this.root, month), { withFileTypes: true }); } catch { return; }
      await Promise.all(entries.filter((e) => e.isFile() && isPromptFileName(e.name)).map(async (e) => {
        const abs = path.join(this.root, month, e.name);
        try {
          const st = await fs.stat(abs);
          out.push({
            rel: `${month}/${e.name}`, abs, mtimeMs: st.mtimeMs, size: st.size,
            created: createdFromName(month, e.name) ?? new Date(st.mtimeMs),
          });
        } catch { /* deleted while listing */ }
      }));
    }));
    return out;
  }

  async read(rel: string): Promise<string> {
    return (await fs.readFile(this.absOf(rel), 'utf8')).replace(/^﻿/, '');
  }

  async stat(rel: string): Promise<StoredPrompt | undefined> {
    const abs = this.absOf(rel);
    try {
      const st = await fs.stat(abs);
      const [month, name] = rel.split('/');
      return { rel, abs, mtimeMs: st.mtimeMs, size: st.size, created: createdFromName(month, name) ?? new Date(st.mtimeMs) };
    } catch {
      return undefined;
    }
  }

  /** Create .prompt-composer/ and its .gitignore (when enabled and missing). */
  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    if (this.gitignoreEnabled()) {
      try {
        await fs.writeFile(path.join(this.root, '.gitignore'), GITIGNORE_CONTENT, { flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }

  /**
   * Pick the file for a prompt's first save: YYYY-MM/DD-HHmm-<slug>.md from when it was created and its title,
   * with -2, -3… if that name is taken. Creates the folders.
   */
  async allocate(created: Date, title: string): Promise<string> {
    await this.ensureRoot();
    const month = monthKey(created);
    const dir = path.join(this.root, month);
    await fs.mkdir(dir, { recursive: true });
    const slug = slugify(title);
    for (let n = 1; ; n++) {
      const name = promptFileName(created, slug, n);
      try {
        // Reserve the name atomically so two saves in the same minute can't pick the same file.
        await fs.writeFile(path.join(dir, name), '', { flag: 'wx' });
        return `${month}/${name}`;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }

  /** Atomic write: a temporary file in the same folder, then a rename over the target. */
  async write(rel: string, text: string): Promise<StoredPrompt> {
    const abs = this.absOf(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
    await fs.writeFile(tmp, text, 'utf8');
    try {
      await renameWithRetry(tmp, abs);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    const st = await fs.stat(abs);
    const [month, name] = rel.split('/');
    return { rel, abs, mtimeMs: st.mtimeMs, size: st.size, created: createdFromName(month, name) ?? new Date(st.mtimeMs) };
  }

  /** Remove a file this extension reserved but never wrote (used when a first save fails). */
  async removeQuietly(rel: string): Promise<void> {
    await fs.rm(this.absOf(rel), { force: true });
  }
}

/** Windows can briefly lock a file (antivirus, indexer): retry the rename a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 6 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw e;
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}
