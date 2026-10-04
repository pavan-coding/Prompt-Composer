// File and folder naming for .prompt-composer/ (pure functions, shared by host and tests).
//
//   .prompt-composer/
//     .gitignore            "*"
//     images/               flat: YYYY-MM-DD-HHmmss.png (pasted) or the dropped file's own name
//     YYYY-MM/              one folder per month
//       DD-HHmm-<slug>.prompt   DD-HHmm = when the prompt was created; Markdown inside
//
// Prompts use their own extension, not .md, so Markdown tools and `*.md` editor associations
// (e.g. a notes editor set as the default for .md) leave them alone.

export const STORE_DIR = '.prompt-composer';
export const IMAGES_DIR = 'images';
export const GITIGNORE_CONTENT = '*\n';
export const PROMPT_EXT = '.prompt';

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10" */
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
/** "2026-10-03" */
export const dayKey = (d: Date) => `${monthKey(d)}-${pad(d.getDate())}`;
/** "14:15" */
export const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const MONTH_DIR_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PROMPT_NAME_RE = /^(\d{2})-(\d{2})(\d{2})-/;

/**
 * Title → file-name slug: letters and digits of any script, lower case, "-" between words,
 * at most 48 characters. Empty → "untitled".
 */
export function slugify(title: string): string {
  const s = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return Array.from(s).slice(0, 48).join('').replace(/-+$/, '') || 'untitled';
}

/** "03-1415-refactor-auth.prompt", or "03-1415-refactor-auth-2.prompt" for n = 2. */
export function promptFileName(created: Date, slug: string, n = 1): string {
  return `${pad(created.getDate())}-${pad(created.getHours())}${pad(created.getMinutes())}-${slug}${n > 1 ? `-${n}` : ''}${PROMPT_EXT}`;
}

/** Is this a prompt file name? (a visible .prompt file; temporary files start with ".") */
export const isPromptFileName = (name: string) => name.toLowerCase().endsWith(PROMPT_EXT) && !name.startsWith('.');

/**
 * When a prompt was created, from its month folder and file name ("2026-10", "03-1415-x.prompt").
 * Undefined when the name doesn't follow the pattern (the caller falls back to the file's modified time).
 */
export function createdFromName(month: string, file: string): Date | undefined {
  const m = MONTH_DIR_RE.exec(month);
  const f = PROMPT_NAME_RE.exec(file);
  if (!m || !f) return undefined;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +f[1], +f[2], +f[3]];
  if (d < 1 || d > 31 || h > 23 || mi > 59) return undefined;
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  return date.getMonth() === mo - 1 ? date : undefined;
}

/** "2026-10-03-141602": the name of a pasted image, without extension. */
export function pastedImageBase(d: Date): string {
  return `${dayKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** A dropped or picked file keeps its name, made safe: "My Shot (1).PNG" → { base: "My-Shot-1", ext: "png" }. */
export function safeImageName(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  const ext = (dot > 0 ? fileName.slice(dot + 1) : 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const raw = dot > 0 ? fileName.slice(0, dot) : fileName;
  const base = raw.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'image';
  return { base, ext: ext === 'jpeg' ? 'jpg' : ext };
}

/** Extension for an image MIME type. */
export function extForMime(mime: string): string {
  const sub = (mime.split('/')[1] || 'png').toLowerCase();
  return ({ jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico' } as Record<string, string>)[sub] ?? sub.replace(/[^a-z0-9]/g, '');
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

/** "base.ext", then "base-1.ext", "base-2.ext"… until `taken` says no. */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  let name = `${base}.${ext}`;
  for (let i = 1; taken(name); i++) name = `${base}-${i}.${ext}`;
  return name;
}
