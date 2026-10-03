// What each @path in a prompt points at, checked directly on disk (no index needed), so a prompt
// opens with correct chips even before the @ index has been built.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MentionInfo, MentionMap } from '../common/protocol';
import { IMAGE_EXT_RE } from '../common/naming';

export async function resolveMentions(root: string, paths: string[], thumb?: (abs: string) => string): Promise<MentionMap> {
  const out: MentionMap = {};
  await Promise.all(paths.map(async (p) => {
    out[p] = await resolveOne(root, p, thumb);
  }));
  return out;
}

async function resolveOne(root: string, p: string, thumb?: (abs: string) => string): Promise<MentionInfo> {
  const clean = p.replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  const wantDir = p.endsWith('/');
  if (!parts.length || parts.includes('..') || path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
    return { exists: false, kind: wantDir ? 'dir' : 'file' };
  }
  const abs = path.join(root, ...parts);
  let info: MentionInfo;
  try {
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) {
      let link = '';
      try { link = await fs.readlink(abs); } catch { /* unreadable */ }
      try {
        const st = await fs.stat(abs);
        info = { exists: true, kind: st.isDirectory() ? 'dir' : 'file', link };
      } catch {
        info = { exists: false, kind: wantDir ? 'dir' : 'file', link };
      }
    } else {
      info = { exists: true, kind: lst.isDirectory() ? 'dir' : 'file' };
    }
  } catch {
    return { exists: false, kind: wantDir ? 'dir' : 'file' };
  }
  // the nearest symlinked folder above it, for the hover ("inside symlinked shared → ../shared-libs")
  for (let n = parts.length - 1; n > 0; n--) {
    const anc = path.join(root, ...parts.slice(0, n));
    try {
      if ((await fs.lstat(anc)).isSymbolicLink()) {
        info.via = { name: parts[n - 1], link: await fs.readlink(anc) };
        break;
      }
    } catch { break; }
  }
  if (info.exists && info.kind === 'file' && thumb && IMAGE_EXT_RE.test(clean)) info.thumb = thumb(abs);
  return info;
}
