// Claude Code reads @paths relative to the folder it runs in. A prompt written in a VS Code window open on
// another folder has workspace-relative @paths, so before the text goes back to Claude they're rewritten:
// relative to Claude's folder when the file is inside it, absolute otherwise. Code is left alone.
import * as path from 'node:path';
import { MENTION_GLOBAL, formatMention, matchMentionAt } from '../common/mentionSyntax';

/** Fenced code blocks (group 1: the fence) and inline code spans (group 2: the backticks). */
const CODE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|(`+)(?!`)[\s\S]*?(?<!`)\2(?!`)/gm;

/** Apply `fn` to the text between code blocks and code spans. */
function mapOutsideCode(md: string, fn: (text: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of md.matchAll(CODE_RE)) {
    out += fn(md.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(md.slice(last));
}

/**
 * One workspace-relative @path seen from `cwd`. Undefined when it should stay as written: already absolute,
 * or nothing exists there (so "@team" isn't a path). Folders keep their trailing slash.
 */
export function rebasePath(rel: string, root: string, cwd: string, exists: (abs: string) => boolean, p: path.PlatformPath = path): string | undefined {
  const parts = rel.split('/').filter((s) => s && s !== '.');
  if (!parts.length || rel.startsWith('/') || p.isAbsolute(rel)) return undefined;
  const abs = p.join(root, ...parts);
  if (!exists(abs)) return undefined;
  const fromCwd = p.relative(cwd, abs);
  const inside = fromCwd !== '' && fromCwd !== '..' && !fromCwd.startsWith(`..${p.sep}`) && !p.isAbsolute(fromCwd);
  const out = (inside ? fromCwd : abs).split(p.sep).join('/');
  return rel.endsWith('/') && !out.endsWith('/') ? `${out}/` : out;
}

/** The prompt with each @path that exists under `root` rewritten for Claude Code running in `cwd`. */
export function rebaseMentions(md: string, root: string, cwd: string, exists: (abs: string) => boolean, p: path.PlatformPath = path): string {
  if (p.relative(root, cwd) === '') return md;
  return mapOutsideCode(md, (text) => text.replace(MENTION_GLOBAL, (whole: string, prefix: string) => {
    const hit = matchMentionAt(whole.slice(prefix.length));
    if (!hit) return whole;
    const moved = rebasePath(hit.path, root, cwd, exists, p);
    return moved === undefined ? whole : prefix + formatMention(moved) + whole.slice(prefix.length + hit.raw.length);
  }));
}
