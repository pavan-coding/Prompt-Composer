// Light, regex-based reading of prompt Markdown for the extension host: titles, search text,
// mentions to resolve, image links and "Copy as Prompt". Fast enough to run over thousands of files.
// The editor (webview) does the real parsing; these helpers agree with it on everyday content.
import { findMentions, stripCode } from './mentionSyntax';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const IMAGE_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Body lines of a prompt (front matter removed), with each line's code-block state. */
function* contentLines(md: string): Generator<{ line: string; code: boolean }> {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) { fence = null; continue; }
      yield { line, code: true };
    } else if (f) {
      fence = f[1];
    } else {
      yield { line, code: false };
    }
  }
}

/** One Markdown line as plain text: markers, emphasis and link syntax removed; images dropped or kept as alt. */
function plainLine(line: string, keepImages: boolean): string {
  let s = line
    .replace(/^(?: {0,3}>[ ]?)+/, '')
    .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    .replace(IMAGE_RE, (_, alt: string, src: string) => (keepImages ? `${alt} ${src}` : ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)([^*_]*?\S)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`+/g, '')
    .replace(/@"([^"\n]+)"/g, '@$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\\$/, '');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** The prompt's title: its first heading or first line of text, at most 80 characters ("" when empty). */
export function titleOf(md: string): string {
  for (const { line, code } of contentLines(md)) {
    if (!code && (HR_RE.test(line) || /^\s*\|/.test(line))) continue;
    const text = code ? line.trim() : plainLine(line, false);
    if (text) return text.length > 80 ? text.slice(0, 80).trimEnd() : text;
  }
  return '';
}

/** Plain-text lines for search and snippets: everything, including code, @paths and image paths. */
export function searchLines(md: string): string[] {
  const out: string[] = [];
  for (const { line, code } of contentLines(md)) {
    const text = code ? line.trim() : plainLine(line, true);
    if (text) out.push(text);
  }
  return out;
}

/** The @mention paths in a prompt (outside code), each once, in order. */
export function mentionPaths(md: string): string[] {
  const seen = new Set<string>();
  for (const m of findMentions(stripCode(md))) seen.add(m.path);
  return [...seen];
}

/** posix-normalise "a/b/../c" → "a/c". Returns undefined when the path climbs above the root. */
export function normalizeRel(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) return undefined; out.pop(); } else out.push(part);
  }
  return out.join('/');
}

const isLocal = (src: string) => !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('#');

/**
 * Images linked from a prompt, as workspace-relative paths.
 * `promptDir` is the prompt's folder relative to the workspace, e.g. ".prompt-composer/2026-10".
 */
export function imagePaths(md: string, promptDir: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(IMAGE_RE)) {
    const src = decodeURI(m[2]);
    if (!isLocal(src)) continue;
    const ws = normalizeRel(`${promptDir}/${src}`);
    if (ws) out.add(ws);
  }
  return [...out];
}

/**
 * "Copy as Prompt": the Markdown with each local image turned into an @path that Claude Code attaches,
 * e.g. ![shot](../images/x.png) → @.prompt-composer/images/x.png. Code blocks are left alone.
 */
export function toPromptText(md: string, promptDir: string): { text: string; images: number } {
  let images = 0;
  const parts = md.split(/(^ {0,3}(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}(?:`{3,}|~{3,})[ \t]*$|(?![\s\S])))/m);
  const text = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(IMAGE_RE, (whole, _alt: string, src: string) => {
      const decoded = decodeURI(src);
      if (!isLocal(decoded)) return whole;
      const ws = normalizeRel(`${promptDir}/${decoded}`);
      if (!ws) return whole;
      images++;
      return /[\s"]/.test(ws) ? `@"${ws}"` : `@${ws}`;
    });
  }).join('');
  return { text, images };
}
