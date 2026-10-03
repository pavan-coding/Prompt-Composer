// Markdown ⇄ Tiptap document.
//
// Reading uses marked's lexer (GFM) plus a small @mention tokenizer. Writing is our own serializer:
//  • Untouched top-level blocks are written back from their original source text, so editing one block
//    changes only that block in the file (ProseMirror keeps unchanged nodes as the same objects).
//  • Blank lines are content: N blank lines between blocks ⇄ N−1 empty paragraphs. Leading blank lines
//    are kept; trailing empty paragraphs aren't written.
//  • Escaping is as light as possible: each changed block is written plainly first and re-read; only if
//    it reads back differently is more escaping added. Prompts stay readable (XML tags, * and _ untouched).
//  • HTML and XML-style blocks (<instructions>…) are plain text lines, so prompt tags are edited as text.
//  • Front matter, tables and link/footnote definitions become raw blocks, kept byte for byte.
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { formatMention, looksLikePath, matchMentionAt, mentionLabel } from '../../common/mentionSyntax';
import { decodeEntities } from '../../common/markdownText';
import type { MentionMap } from '../../common/protocol';

export interface ParseOptions {
  /** What the host knows about @paths; decides chip (and broken) vs plain text for paths that don't look like paths. */
  mentions: MentionMap;
  /** Display URL for an image link written in the file. */
  imageSrc: (path: string) => string;
}

export interface ParsedDoc {
  json: JSONContent;
  /** One entry per top-level node: its original source text, or null (empty lines, split blocks). */
  sources: (string | null)[];
}

// ------------------------------------------------------------------------------------------- reading

function mentionExtension(opts: () => ParseOptions): TokenizerAndRendererExtension {
  return {
    name: 'mention',
    level: 'inline',
    start(src: string) {
      const m = /(?:^|[\s(])@(?=["\w./~-])/.exec(src);
      if (!m) return undefined;
      return m.index + (m[0][0] === '@' ? 0 : 1);
    },
    tokenizer(src: string, tokens: Token[]) {
      if (src[0] !== '@') return undefined;
      const prev = tokens[tokens.length - 1];
      if (prev && !(prev.type === 'br' || /[\s(]$/.test(prev.raw))) return undefined;
      const m = matchMentionAt(src);
      if (!m) return undefined;
      const info = opts().mentions[m.path];
      if (!info && !looksLikePath(m.path)) return undefined;
      return { type: 'mention', raw: m.raw, path: m.path, broken: info ? !info.exists : false };
    },
    renderer: () => '',
  };
}

export class MarkdownReader {
  private opts: ParseOptions = { mentions: {}, imageSrc: (p) => p };
  private readonly marked: Marked;

  constructor() {
    this.marked = new Marked({ gfm: true, breaks: false });
    this.marked.use({ extensions: [mentionExtension(() => this.opts)] });
  }

  parse(markdown: string, opts: ParseOptions): ParsedDoc {
    this.opts = opts;
    const src = markdown.replace(/\r\n?/g, '\n');
    const tokens: Token[] = [];
    let rest = src;
    // Front matter: kept verbatim as the first raw block.
    const fm = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
    if (fm) {
      tokens.push({ type: 'frontmatter', raw: fm[0] } as Token);
      rest = src.slice(fm[0].length);
    }
    tokens.push(...this.marked.lexer(rest));
    const { nodes, sources } = this.blocks(tokens, src);
    const content = nodes.length ? nodes : [{ type: 'paragraph' }];
    return { json: { type: 'doc', content }, sources: nodes.length ? sources : [null] };
  }

  /**
   * Block tokens → nodes, with empty paragraphs for blank lines. When `src` is given (top level), also the
   * source text of each node, taken line-for-line from the original.
   */
  private blocks(tokens: Token[], src?: string): { nodes: JSONContent[]; sources: (string | null)[] } {
    const nodes: JSONContent[] = [];
    const sources: (string | null)[] = [];
    const lines = src !== undefined ? src.split('\n') : [];
    let offset = 0;
    let line = 0;        // line number at `offset`
    let prevEnd = -1;    // last line of the previous block
    for (const t of tokens) {
      offset += t.raw.length;
      if (t.type === 'space') { line += countNewlines(t.raw); continue; }
      const lead = /^\n*/.exec(t.raw)![0].length;
      const body = t.raw.slice(lead).replace(/\n+$/, '');
      const startLine = line + lead;
      const endLine = startLine + countNewlines(body);
      line += countNewlines(t.raw);
      // N blank lines between blocks are N-1 empty paragraphs (one blank line is the normal separator)
      const blanks = prevEnd < 0 ? startLine : Math.max(0, startLine - prevEnd - 2);
      for (let i = 0; i < blanks; i++) { nodes.push({ type: 'paragraph' }); sources.push(null); }
      prevEnd = endLine;
      const converted = this.block(t);
      nodes.push(...converted);
      if (src !== undefined && converted.length === 1) sources.push(lines.slice(startLine, endLine + 1).join('\n'));
      else for (let i = 0; i < converted.length; i++) sources.push(null);
    }
    return { nodes, sources };
  }

  private block(t: Token): JSONContent[] {
    switch (t.type) {
      case 'paragraph':
        // footnote definitions ("[^1]: …") aren't GFM: keep them as raw text
        if (/^\[\^[^\]\n]+\]:/.test(t.raw)) return [{ type: 'rawBlock', content: [{ type: 'text', text: t.raw.replace(/\n+$/, '') }] }];
        return this.splitImages(this.inline((t as Tokens.Paragraph).tokens));
      case 'heading': {
        const h = t as Tokens.Heading;
        const content = this.inline(h.tokens).map((n) => (n.type === 'hardBreak' ? { type: 'text', text: ' ' } : n))
          .filter((n) => n.type !== 'image');
        return [{ type: 'heading', attrs: { level: Math.min(6, Math.max(1, h.depth)) }, content: mergeText(content) }];
      }
      case 'code': {
        const c = t as Tokens.Code;
        const language = (c.lang ?? '').trim().split(/\s+/)[0] || null;
        return [{ type: 'codeBlock', attrs: { language }, content: c.text ? [{ type: 'text', text: c.text }] : [] }];
      }
      case 'blockquote': {
        const inner = this.blocks((t as Tokens.Blockquote).tokens).nodes;
        return [{ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] }];
      }
      case 'list':
        return [this.list(t as Tokens.List)];
      case 'hr':
        return [{ type: 'horizontalRule' }];
      case 'html':
        return this.htmlBlock(t.raw);
      case 'text': {
        // a bare text block (inside list items)
        const tt = t as Tokens.Text;
        return [{ type: 'paragraph', content: this.inline(tt.tokens ?? [{ type: 'text', raw: tt.raw, text: tt.text } as Token]) }];
      }
      case 'frontmatter':
      case 'table':
      case 'def':
      default: {
        const raw = t.raw.replace(/^\n+|\n+$/g, '');
        return [{ type: 'rawBlock', content: raw ? [{ type: 'text', text: raw }] : [] }];
      }
    }
  }

  /** HTML / XML-ish blocks become text: each run of lines a paragraph (lines joined by line breaks). */
  private htmlBlock(raw: string): JSONContent[] {
    const lines = raw.replace(/\n+$/, '').split('\n');
    const out: JSONContent[] = [];
    let para: string[] = [];
    let blanks = 0;
    const flush = () => {
      if (!para.length) return;
      if (out.length) for (let i = 1; i < blanks; i++) out.push({ type: 'paragraph' });
      const content: JSONContent[] = [];
      para.forEach((l, i) => {
        if (i) content.push({ type: 'hardBreak' });
        if (l) content.push({ type: 'text', text: l });
      });
      out.push({ type: 'paragraph', content });
      para = [];
      blanks = 0;
    };
    for (const l of lines) {
      if (l.trim() === '') { if (para.length) flush(); blanks++; } else para.push(l);
    }
    flush();
    return out;
  }

  private list(l: Tokens.List): JSONContent {
    const isEmptyTask = (it: Tokens.ListItem) => !it.task && /^\[[ xX]\]\s*$/.test(it.text);
    const allTasks = !l.ordered && l.items.length > 0 && l.items.every((it) => it.task || isEmptyTask(it));
    const items = l.items.map((it): JSONContent => {
      const childTokens = it.tokens.filter((x) => x.type !== 'checkbox');
      let content: JSONContent[];
      if (isEmptyTask(it)) content = [{ type: 'paragraph' }];
      else {
        content = this.blocks(childTokens).nodes;
        if (it.task && !allTasks) {
          // mixed list: keep the checkbox as text
          const first = content[0];
          const box = { type: 'text', text: `[${it.checked ? 'x' : ' '}] ` };
          if (first?.type === 'paragraph') first.content = mergeText([box, ...(first.content ?? [])]);
          else content.unshift({ type: 'paragraph', content: [box] });
        }
      }
      if (!content.length || content[0].type !== 'paragraph') content.unshift({ type: 'paragraph' });
      if (allTasks) {
        const checked = it.task ? !!it.checked : /^\[[xX]\]/.test(it.text);
        return { type: 'taskItem', attrs: { checked }, content };
      }
      return { type: 'listItem', content };
    });
    if (allTasks) return { type: 'taskList', content: items };
    if (l.ordered) return { type: 'orderedList', attrs: { start: typeof l.start === 'number' ? l.start : 1 }, content: items };
    return { type: 'bulletList', content: items };
  }

  /** A paragraph's inline nodes, with images pulled out as their own blocks (images are blocks here). */
  private splitImages(inline: JSONContent[]): JSONContent[] {
    if (!inline.some((n) => n.type === 'image')) return [{ type: 'paragraph', content: inline.length ? inline : undefined }];
    const out: JSONContent[] = [];
    let run: JSONContent[] = [];
    const flush = () => {
      while (run.length && isBlankInline(run[0])) run.shift();
      while (run.length && isBlankInline(run[run.length - 1])) run.pop();
      if (run.length) out.push({ type: 'paragraph', content: mergeText(run) });
      run = [];
    };
    for (const n of inline) {
      if (n.type === 'image') { flush(); out.push(n); } else run.push(n);
    }
    flush();
    return out;
  }

  inline(tokens: Token[] | undefined, marks: JSONContent['marks'] = []): JSONContent[] {
    const out: JSONContent[] = [];
    const text = (s: string, m = marks) => {
      // soft line breaks inside a paragraph are kept as line breaks
      s.split('\n').forEach((part, i) => {
        if (i) out.push({ type: 'hardBreak' });
        if (part) out.push(m && m.length ? { type: 'text', text: part, marks: m } : { type: 'text', text: part });
      });
    };
    for (const t of tokens ?? []) {
      switch (t.type) {
        case 'text': {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) out.push(...this.inline(tt.tokens, marks));
          else text(decodeEntities(tt.text));
          break;
        }
        case 'escape':
          text((t as Tokens.Escape).text);
          break;
        case 'strong':
          out.push(...this.inline((t as Tokens.Strong).tokens, [...marks!, { type: 'bold' }]));
          break;
        case 'em':
          out.push(...this.inline((t as Tokens.Em).tokens, [...marks!, { type: 'italic' }]));
          break;
        case 'del':
          out.push(...this.inline((t as Tokens.Del).tokens, [...marks!, { type: 'strike' }]));
          break;
        case 'codespan': {
          // inline code can't carry other marks (Tiptap's code mark excludes them), except a link around it
          const link = marks!.filter((m) => m.type === 'link');
          const code = (t as Tokens.Codespan).text;
          if (code) out.push({ type: 'text', text: decodeEntities(code), marks: [...link, { type: 'code' }] });
          break;
        }
        case 'link': {
          const l = t as Tokens.Link;
          out.push(...this.inline(l.tokens, [...marks!.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: l.href } }]));
          break;
        }
        case 'image': {
          const im = t as Tokens.Image;
          out.push({ type: 'image', attrs: { src: this.opts.imageSrc(im.href), alt: im.text || null, title: im.title || null, path: im.href } });
          break;
        }
        case 'br':
          out.push({ type: 'hardBreak' });
          break;
        case 'html':
          text(t.raw);
          break;
        case 'mention': {
          const m = t as Token & { path: string };
          out.push({ type: 'mention', attrs: { id: m.path, label: mentionLabel(m.path) }, ...(marks!.length ? { marks: marks!.filter((x) => x.type !== 'code') } : {}) });
          break;
        }
        case 'checkbox':
          break;
        default:
          text(t.raw);
      }
    }
    return mergeText(out);
  }
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function isBlankInline(n: JSONContent): boolean {
  return n.type === 'hardBreak' || (n.type === 'text' && !n.text!.trim());
}

const sameMarks = (a: JSONContent['marks'] = [], b: JSONContent['marks'] = []) => JSON.stringify(a) === JSON.stringify(b);

/** Join neighbouring text nodes with the same marks. */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) last.text += n.text!;
    else if (n.type !== 'text' || n.text) out.push({ ...n });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- writing

type Level = 0 | 1 | 2 | 3;

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];
const OPEN: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

export class MarkdownWriter {
  /** Original source of untouched top-level nodes (same object ⇒ unchanged). */
  private readonly sources = new WeakMap<PMNode, string>();
  /** Already-serialized changed nodes, so typing doesn't re-verify every block on every keystroke. */
  private readonly cache = new WeakMap<PMNode, string>();

  constructor(private readonly schema: Schema, private readonly reader: MarkdownReader) {}

  /** Remember each top-level node's source after loading a document. */
  remember(doc: PMNode, sources: (string | null)[]): void {
    if (doc.childCount < sources.length) return;
    doc.forEach((node, _, i) => {
      const s = sources[i];
      if (s != null) this.sources.set(node, s);
    });
  }

  serialize(doc: PMNode): string {
    let out = '';
    let blanks = 0;
    let wrote = false;
    let last = -1;
    doc.forEach((n, _, i) => { if (!isEmptyParagraph(n)) last = i; });
    let prevList: { type: string; marker: string } | undefined;
    doc.forEach((node, _, i) => {
      if (i > last) return;
      if (isEmptyParagraph(node)) { blanks++; return; }
      let md = this.sources.get(node);
      let marker = prevList && isList(node) && prevList.type === listKind(node) ? altMarker(prevList.marker, node) : defaultMarker(node);
      if (md === undefined) md = this.block(node, marker);
      else if (isList(node)) marker = markerOfSource(md, node) ?? marker;
      out += (wrote ? '\n\n' : '') + '\n'.repeat(blanks) + md;
      blanks = 0;
      wrote = true;
      prevList = isList(node) ? { type: listKind(node), marker } : undefined;
    });
    return wrote ? out + '\n' : '';
  }

  /** Serialize one changed top-level block with the least escaping that reads back the same. */
  private block(node: PMNode, marker: string): string {
    const key = this.cache.get(node);
    if (key !== undefined && key.startsWith(marker + '\u0000')) return key.slice(marker.length + 1);
    let md = '';
    for (const level of [0, 1, 2, 3] as Level[]) {
      md = this.node(node, level, marker);
      if (this.readsBack(md, node)) break;
    }
    this.cache.set(node, marker + '\u0000' + md);
    return md;
  }

  private readsBack(md: string, node: PMNode): boolean {
    if (!needsCheck(node)) return true;
    try {
      const parsed = this.reader.parse(md, { mentions: {}, imageSrc: (p) => p }).json.content ?? [];
      while (parsed.length && parsed[parsed.length - 1].type === 'paragraph' && !parsed[parsed.length - 1].content?.length) parsed.pop();
      if (parsed.length !== 1) return false;
      const back = this.schema.nodeFromJSON(parsed[0]);
      return normalize(back.toJSON()) === normalize(node.toJSON());
    } catch {
      return false;
    }
  }

  // ---- blocks

  private node(node: PMNode, level: Level, marker = '-'): string {
    switch (node.type.name) {
      case 'paragraph':
        return lineStarts(this.inline(node, level), level);
      case 'heading': {
        const text = this.inline(node, level, true).replace(/\n/g, ' ');
        const body = level >= 1 ? text.replace(/(\s)(#+)\s*$/, (_, s, h) => `${s}\\${h}`) : text;
        return ('#'.repeat(node.attrs.level) + ' ' + body).trimEnd();
      }
      case 'codeBlock': {
        const code = node.textContent;
        const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((s) => s.length));
        const fence = '`'.repeat(Math.max(3, longest + 1));
        return `${fence}${node.attrs.language ?? ''}\n${code}${code ? '\n' : ''}${fence}`;
      }
      case 'rawBlock':
        return node.textContent;
      case 'horizontalRule':
        return '---';
      case 'image':
        return imageMd(node, level);
      case 'blockquote': {
        const inner = this.children(node, level);
        return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return this.list(node, level, marker);
      default:
        return node.textContent;
    }
  }

  /** Child blocks joined by the blank-line rule (used inside quotes and list items). */
  private children(parent: PMNode, level: Level, tightLists = false): string {
    let out = '';
    let blanks = 0;
    let wrote = false;
    let last = -1;
    parent.forEach((n, _, i) => { if (!isEmptyParagraph(n)) last = i; });
    let prevList: { type: string; marker: string } | undefined;
    parent.forEach((child, _, i) => {
      if (i > last) return;
      if (isEmptyParagraph(child)) { blanks++; return; }
      const marker = prevList && isList(child) && prevList.type === listKind(child) ? altMarker(prevList.marker, child) : defaultMarker(child);
      const md = this.node(child, level, marker);
      const sep = !wrote ? '' : tightLists && isList(child) && blanks === 0 ? '\n' : '\n\n';
      out += sep + '\n'.repeat(wrote ? blanks : blanks) + md;
      blanks = 0;
      wrote = true;
      prevList = isList(child) ? { type: listKind(child), marker } : undefined;
    });
    return out;
  }

  private list(node: PMNode, level: Level, marker: string): string {
    const ordered = node.type.name === 'orderedList';
    const task = node.type.name === 'taskList';
    const start = ordered ? (node.attrs.start ?? 1) : 1;
    const items: string[] = [];
    node.forEach((item, _, i) => {
      const head = ordered ? `${start + i}${marker}` : task ? `${marker} [${item.attrs.checked ? 'x' : ' '}]` : marker;
      const body = this.children(item, level, true);
      const indent = ' '.repeat((ordered ? `${start + i}${marker}` : marker).length + 1);
      const lines = body.split('\n');
      const first = lines[0] ? `${head} ${lines[0]}` : head;
      items.push([first, ...lines.slice(1).map((l) => (l ? indent + l : ''))].join('\n'));
    });
    return items.join('\n');
  }

  // ---- inline

  private inline(parent: PMNode, level: Level, heading = false): string {
    const nodes: PMNode[] = [];
    parent.forEach((n) => nodes.push(n));
    // Bare URLs that GFM links by itself are written as-is: https://x.com rather than [https://x.com](https://x.com).
    const bare = nodes.map((n, i) => {
      const href = linkHref(n);
      if (level >= 3 || href === undefined || !n.isText || !isAutolink(n.text!, href)) return false;
      return linkHref(nodes[i - 1]) !== href && linkHref(nodes[i + 1]) !== href;
    });
    const marksOf = (i: number): OpenMark[] => {
      const n = nodes[i];
      if (!n) return [];
      return n.marks
        .filter((m) => m.type.name !== 'code' && !(bare[i] && m.type.name === 'link') && (m.type.name === 'link' || OPEN[m.type.name]))
        .map((m) => ({ type: m.type.name, href: m.type.name === 'link' ? String(m.attrs.href ?? '') : undefined }))
        .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    };
    let out = '';
    const stack: OpenMark[] = [];
    const common = (marks: OpenMark[]) => {
      let k = 0;
      while (k < stack.length && k < marks.length && stack[k].type === marks[k].type && stack[k].href === marks[k].href) k++;
      return k;
    };
    const closeTo = (depth: number) => {
      while (stack.length > depth) {
        const m = stack.pop()!;
        out += m.type === 'link' ? `](${linkTarget(m.href ?? '')})` : OPEN[m.type];
      }
    };
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const marks = marksOf(i);
      const keep = common(marks);
      closeTo(keep);
      if (node.type.name === 'hardBreak') {
        out += heading ? ' ' : '\n';
        continue;
      }
      const isCode = node.marks.some((m) => m.type.name === 'code');
      const isMention = node.type.name === 'mention';
      let text = isMention ? formatMention(String(node.attrs.id)) : node.text ?? '';
      if (marks.length > keep && !isCode) {
        // whitespace can't sit just inside an opening delimiter: move it outside
        const lead = /^\s*/.exec(text)![0];
        out += lead;
        text = text.slice(lead.length);
      }
      for (let k = keep; k < marks.length; k++) {
        stack.push(marks[k]);
        out += marks[k].type === 'link' ? '[' : OPEN[marks[k].type];
      }
      const nextKeep = common(marksOf(i + 1));
      const trail = stack.length > nextKeep && !isCode ? /\s*$/.exec(text)![0] : '';
      const core = text.slice(0, text.length - trail.length);
      out += isCode ? codeSpan(core) : isMention ? core : escapeInline(core, level);
      if (trail) {
        closeTo(nextKeep);
        out += trail;
      }
    }
    closeTo(0);
    return out;
  }
}

interface OpenMark { type: string; href?: string }

function linkHref(n: PMNode | undefined): string | undefined {
  const m = n?.marks.find((x) => x.type.name === 'link');
  return m ? String(m.attrs.href ?? '') : undefined;
}

// ------------------------------------------------------------------------------------------- helpers

function isEmptyParagraph(n: PMNode): boolean {
  return n.type.name === 'paragraph' && n.content.size === 0;
}

function isList(n: PMNode): boolean {
  return n.type.name === 'bulletList' || n.type.name === 'orderedList' || n.type.name === 'taskList';
}

/** Bullet and task lists share "-" markers, so they're one kind for keeping neighbours apart. */
function listKind(n: PMNode): string {
  return n.type.name === 'orderedList' ? 'ordered' : 'bullet';
}

function defaultMarker(n: PMNode): string {
  return n.type.name === 'orderedList' ? '.' : '-';
}

/** Two lists in a row would merge into one: give the second a different marker. */
function altMarker(prev: string, n: PMNode): string {
  if (n.type.name === 'orderedList') return prev === '.' ? ')' : '.';
  return prev === '-' ? '*' : '-';
}

function markerOfSource(md: string, n: PMNode): string | undefined {
  const m = /^\s*(?:\d+([.)])|([-*+]))/.exec(md);
  if (!m) return undefined;
  return n.type.name === 'orderedList' ? m[1] : m[2];
}

function needsCheck(n: PMNode): boolean {
  return !['codeBlock', 'rawBlock', 'horizontalRule'].includes(n.type.name);
}

function isAutolink(text: string, href: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(text) && (href === text || href === `http://${text}`) && !/[<>]/.test(text);
}

function linkTarget(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : href;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim()) ? ' ' : '';
  return ticks + pad + text + pad + ticks;
}

function imageMd(node: PMNode, level: Level): string {
  const alt = (node.attrs.alt ?? '') as string;
  const p = (node.attrs.path ?? node.attrs.src ?? '') as string;
  const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
  const altEsc = level >= 1 ? alt.replace(/([\\[\]])/g, '\\$1') : alt.replace(/([[\]])/g, '\\$1');
  return `![${altEsc}](${linkTarget(p)}${title})`;
}

/** Escape what would change meaning inside a line of text. */
function escapeInline(s: string, level: Level): string {
  if (level < 2) return s;
  if (level >= 3) return s.replace(/[\\`*_~[\]<>|#!&]/g, '\\$&');
  return s.replace(/[\\`*_~[<&|]/g, (c, i: number, str: string) => {
    const prev = str[i - 1] ?? ' ';
    const next = str[i + 1] ?? ' ';
    switch (c) {
      case '\\': return /[!-/:-@[-`{-~]/.test(next) || i === str.length - 1 ? '\\\\' : c;
      case '_': return /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next) ? c : '\\_';
      case '*': return /\s/.test(prev) && /\s/.test(next) ? c : '\\*';
      case '<': return /[A-Za-z/!?]/.test(next) ? '\\<' : c;
      case '&': return /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(str.slice(i)) ? '\\&' : c;
      default: return '\\' + c;
    }
  });
}

/** Escape the start of each line where it would turn into a heading, list, quote, fence, rule… */
function lineStarts(text: string, level: Level): string {
  if (level < 1) return text;
  return text.split('\n').map((line) => {
    let l = line;
    if (/^ +/.test(l)) l = '&#32;' + l.slice(1);
    return l
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^([>+-])(?=\s|$)/, '\\$1')
      .replace(/^\*(?=\s|$)/, '\\*')
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^(`{3,}|~{3,})/, '\\$1')
      .replace(/^([=-])(?=\1*\s*$)/, '\\$1')
      .replace(/^([*_])(?=(?:\s*\1){2,}\s*$)/, '\\$1');
  }).join('\n');
}

/** A comparable form of a node: what matters for the file (mentions read as their @path text). */
function normalize(json: JSONContent): string {
  const walk = (n: JSONContent): unknown => {
    const kids: unknown[] = [];
    let textRun: { t: string; m: string } | undefined;
    for (const c of n.content ?? []) {
      if (c.type === 'text' || c.type === 'mention') {
        const t = c.type === 'mention' ? formatMention(c.attrs!.id as string) : c.text!;
        const m = JSON.stringify((c.marks ?? []).filter((x) => x.type !== 'mention').map((x) => (x.type === 'link' ? `link:${x.attrs?.href}` : x.type)).sort());
        if (textRun && textRun.m === m) textRun.t += t;
        else { textRun = { t, m }; kids.push(textRun); }
      } else {
        textRun = undefined;
        kids.push(walk(c));
      }
    }
    const a = n.attrs ?? {};
    const attrs = {
      level: a.level, language: a.language || null, start: a.start, checked: a.checked,
      path: n.type === 'image' ? a.path ?? a.src : undefined, alt: n.type === 'image' ? a.alt || null : undefined,
    };
    return { t: n.type, a: attrs, c: kids };
  };
  return JSON.stringify(walk(json));
}
