// How @ mentions look in a prompt file. Shared by the webview parser/serializer and the extension host.
//
//   @src/server/auth.ts        a file (workspace-relative path, as Claude Code expects)
//   @src/config/               a folder (trailing slash)
//   @"docs/my notes.md"        a path with spaces or other awkward characters, quoted
//
// A mention starts at the beginning of a line or after whitespace or "(", so "a@b.com" never is one.

/** Characters an unquoted mention path can't contain. */
const UNQUOTED_STOP = /[\s"'`()[\]{}<>,;!?*|]/;

/** Matches a mention at the start of `src` (which begins with "@"). */
const AT_START = /^@(?:"([^"\n]+)"|([^\s"'`()[\]{}<>,;!?*|]+))/;

/** Mentions anywhere in a text, with an allowed prefix before them. */
export const MENTION_GLOBAL = /(^|[\s(])@(?:"([^"\n]+)"|([^\s"'`()[\]{}<>,;!?*|]+))/g;

export interface MentionMatch {
  /** The path as stored, e.g. "src/a.ts" or "src/config/". */
  path: string;
  /** The exact source text, e.g. '@"docs/my notes.md"' or "@src/a.ts" (sentence punctuation excluded). */
  raw: string;
  quoted: boolean;
}

/** Trailing sentence punctuation isn't part of a path: "see @src/a.ts." → "src/a.ts". */
function trimPath(p: string): string {
  return p.replace(/[.:]+$/, '');
}

/** Parse a mention at the start of `src`. Undefined if there isn't one. */
export function matchMentionAt(src: string): MentionMatch | undefined {
  const m = AT_START.exec(src);
  if (!m) return undefined;
  if (m[1] !== undefined) return { path: m[1], raw: m[0], quoted: true };
  const path = trimPath(m[2]);
  if (!path) return undefined;
  return { path, raw: '@' + path, quoted: false };
}

/** Every mention in a piece of text (no code-awareness: strip code first). */
export function findMentions(text: string): MentionMatch[] {
  const out: MentionMatch[] = [];
  for (const m of text.matchAll(MENTION_GLOBAL)) {
    const hit = matchMentionAt(m[0].slice(m[1].length));
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Does a token look like a path even if nothing exists there? Such tokens become "broken" chips;
 * anything else (like "@team") stays plain text unless it exists in the workspace.
 */
export function looksLikePath(path: string): boolean {
  return path.includes('/') || path.startsWith('.') || /\.[A-Za-z0-9]{1,10}$/.test(path);
}

/** How a mention path is written to the file: quoted when it contains characters a bare path can't. */
export function formatMention(path: string): string {
  const needsQuotes = UNQUOTED_STOP.test(path) || /[.:]$/.test(path);
  return needsQuotes ? `@"${path}"` : `@${path}`;
}

/** The name a chip shows: the last path segment, without the folder's trailing slash. */
export function mentionLabel(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1) || clean;
}

/** Remove fenced code blocks and inline code spans so mentions inside code aren't found. */
export function stripCode(md: string): string {
  return md
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
}
