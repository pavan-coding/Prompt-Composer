// Images live in one flat folder, .prompt-composer/images/. Pasted images are named by date and time;
// dropped or picked files keep their own (made-safe) name. Nothing is ever overwritten.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IMAGES_DIR, STORE_DIR, extForMime, pastedImageBase, safeImageName, uniqueName } from '../common/naming';
import type { PromptStore } from '../store/promptStore';

export class ImageStore {
  constructor(private readonly store: PromptStore) {}

  get dir(): string {
    return this.store.imagesDir;
  }

  /** Workspace-relative path of an image file name: ".prompt-composer/images/x.png". */
  workspaceRel(name: string): string {
    return `${STORE_DIR}/${IMAGES_DIR}/${name}`;
  }

  /** The link written into a prompt (prompts sit one level down, in a month folder): "../images/x.png". */
  linkFor(name: string): string {
    return `../${IMAGES_DIR}/${encodeURI(name)}`;
  }

  private async reserve(base: string, ext: string, data: Uint8Array): Promise<string> {
    await this.store.ensureRoot();
    await fs.mkdir(this.dir, { recursive: true });
    for (let attempt = 0; attempt < 1000; attempt++) {
      const existing = new Set(await fs.readdir(this.dir).catch(() => [] as string[]));
      const lower = new Set([...existing].map((n) => n.toLowerCase()));
      const name = uniqueName(base, ext, (n) => lower.has(n.toLowerCase()));
      try {
        await fs.writeFile(path.join(this.dir, name), data, { flag: 'wx' });
        return name;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    throw new Error('Could not find a free image name');
  }

  /** Save pasted or dropped image bytes. Returns the file name inside images/. */
  async saveBytes(data: Uint8Array, mime: string, name: string | undefined, origin: 'paste' | 'drop', now = new Date()): Promise<string> {
    if (origin === 'paste' || !name) return this.reserve(pastedImageBase(now), extForMime(mime || 'image/png'), data);
    const { base, ext } = safeImageName(name);
    return this.reserve(base, ext, data);
  }

  /** Copy a picked file into images/, keeping its name. */
  async copyFile(abs: string): Promise<string> {
    const data = await fs.readFile(abs);
    const { base, ext } = safeImageName(path.basename(abs));
    return this.reserve(base, ext, data);
  }

  /** Delete images (workspace-relative paths inside .prompt-composer/images/). */
  async deleteImages(wsPaths: string[]): Promise<void> {
    const prefix = `${STORE_DIR}/${IMAGES_DIR}/`;
    await Promise.all(wsPaths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) =>
      fs.rm(path.join(this.dir, p.slice(prefix.length)), { force: true }),
    ));
  }
}
