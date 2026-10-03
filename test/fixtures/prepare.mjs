// Copies the fixture workspace to a temporary folder and adds the links git can't store:
//   shared/        → ../outside/shared-libs/common   (symlinked folder; a junction on Windows)
//   src/config/    → ../outside/infra/config         (symlinked folder inside src)
//   src/loop/      → the workspace's own src/         (a cycle: listed once, never walked)
//   broken-link/   → a folder that doesn't exist     (a broken link)
//   CLAUDE.md      → ../outside/shared-libs/CLAUDE.shared.md (a symlinked file; skipped if Windows won't allow it)
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** `dir`: where to create it (default: a new temporary folder). */
export function prepareWorkspace(dir) {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'pc-fixture-'));
  mkdirSync(root, { recursive: true });
  const ws = join(root, 'ws');
  const outside = join(root, 'outside');
  cpSync(join(here, 'workspace'), ws, { recursive: true });
  cpSync(join(here, 'outside'), outside, { recursive: true });
  mkdirSync(join(outside, 'infra', 'config'), { recursive: true });
  writeFileSync(join(outside, 'infra', 'config', 'env.ts'), 'export const env = {};\n');
  writeFileSync(join(outside, 'infra', 'config', 'flags.ts'), 'export const flags = {};\n');
  writeFileSync(join(outside, 'shared-libs', 'CLAUDE.shared.md'), '# Conventions\n');
  const dirLink = (target, path) => symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
  dirLink(join(outside, 'shared-libs', 'common'), join(ws, 'shared'));
  dirLink(join(outside, 'infra', 'config'), join(ws, 'src', 'config'));
  dirLink(join(ws, 'src'), join(ws, 'src', 'loop'));
  dirLink(join(outside, 'missing'), join(ws, 'broken-link'));
  let fileSymlinks = true;
  try {
    symlinkSync(join(outside, 'shared-libs', 'CLAUDE.shared.md'), join(ws, 'CLAUDE.md'), 'file');
  } catch {
    fileSymlinks = false; // Windows without Developer Mode can't create file symlinks
  }
  writeFileSync(join(root, 'info.json'), JSON.stringify({ ws, outside, fileSymlinks }, null, 2));
  return { root, ws, outside, fileSymlinks };
}
