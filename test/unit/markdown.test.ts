import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { MarkdownReader, MarkdownWriter } from '../../src/webview/editor/markdown';
import { schemaExtensions } from '../../src/webview/editor/nodes';
import type { MentionMap } from '../../src/common/protocol';

const schema = getSchema(schemaExtensions());
const reader = new MarkdownReader();
const mentions: MentionMap = {
  'src/a.ts': { exists: true, kind: 'file' },
  'src/config/': { exists: true, kind: 'dir' },
  'docs/my notes.md': { exists: true, kind: 'file' },
  README: { exists: true, kind: 'file' },
};

function load(md: string, m: MentionMap = mentions) {
  const parsed = reader.parse(md, { mentions: m, imageSrc: (p) => `https://img/${p}` });
  const doc = schema.nodeFromJSON(parsed.json);
  const writer = new MarkdownWriter(schema, reader);
  writer.remember(doc, parsed.sources);
  return { doc, writer, parsed };
}

/** Serialize without source preservation (the canonical form), then read back and compare. */
function canonical(md: string): string {
  const { doc } = load(md);
  return new MarkdownWriter(schema, reader).serialize(doc);
}

function roundTripStable(md: string) {
  const once = canonical(md);
  const twice = canonical(once);
  expect(twice).toBe(once);
  return once;
}

/** Replace top-level child i with a modified copy (the others stay the same objects, as in the editor). */
function editChild(doc: PMNode, i: number, f: (n: PMNode) => PMNode): PMNode {
  const kids: PMNode[] = [];
  doc.forEach((c, _, j) => kids.push(j === i ? f(c) : c));
  return doc.copy(Fragment.fromArray(kids));
}

const types = (md: string) => (load(md).parsed.json.content ?? []).map((n) => n.type);

describe('MD-01 headings', () => {
  it('reads levels 1-6 and writes them back', () => {
    const md = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six\n';
    expect(types(md)).toEqual(['heading', 'heading', 'heading', 'heading', 'heading']);
    expect(canonical(md)).toBe(md);
  });
});

describe('MD-02 inline formatting', () => {
  it('round-trips bold, italic, strike, code, links and combinations', () => {
    const md = 'Plain **bold** *italic* ~~strike~~ `code` [link](https://x.com) ***both*** **bold *nested italic* end**\n';
    expect(roundTripStable(md)).toBe(md);
  });
  it('writes bare URLs bare', () => {
    expect(canonical('see https://example.com/a?b=1 now\n')).toBe('see https://example.com/a?b=1 now\n');
  });
  it('moves whitespace outside of marks', () => {
    const { doc } = load('x\n');
    const p = schema.nodes.paragraph.create(null, [
      schema.text('a'), schema.text(' bold ', [schema.marks.bold.create()]), schema.text('b'),
    ]);
    const d2 = doc.copy(Fragment.from(p));
    expect(new MarkdownWriter(schema, reader).serialize(d2)).toBe('a **bold** b\n');
  });
});

describe('MD-03 lists', () => {
  it('round-trips bullet, ordered (with start) and task lists, nested', () => {
    const md = '- one\n- two\n  - nested\n    - deeper\n- three\n\n3. c\n4. d\n\n- [ ] todo\n- [x] done\n  - [ ] sub\n';
    expect(canonical(md)).toBe(md);
    expect(types(md)).toEqual(['bulletList', 'orderedList', 'taskList']);
  });
  it('keeps two adjacent lists apart', () => {
    const md = '- a\n- b\n\n* c\n';
    expect(types(md)).toEqual(['bulletList', 'bulletList']);
    expect(roundTripStable(md)).toBe(md);
  });
  it('reads an empty task item', () => {
    const json = load('- [ ] \n- [x] done\n').parsed.json;
    expect(json.content?.[0].type).toBe('taskList');
  });
});

describe('MD-04 quotes', () => {
  it('round-trips multi-paragraph quotes with lists', () => {
    const md = '> first\n>\n> second\n>\n> - item\n';
    expect(canonical(md)).toBe(md);
  });
});

describe('MD-05 code blocks', () => {
  it('keeps the language', () => {
    const md = '```ts\nconst a = 1;\n\nreturn a;\n```\n';
    expect(canonical(md)).toBe(md);
  });
  it('uses a longer fence when the code contains ```', () => {
    const md = '````md\n```js\nx\n```\n````\n';
    expect(canonical(md)).toBe(md);
    expect(roundTripStable(md)).toBe(md);
  });
  it('reads ~~~ fences and plain blocks', () => {
    expect(canonical('~~~\nplain\n~~~\n')).toBe('```\nplain\n```\n');
  });
});

describe('MD-06 divider and images', () => {
  it('round-trips', () => {
    const md = 'a\n\n---\n\n![shot](../images/2026-10-03-141602.png)\n';
    expect(canonical(md)).toBe(md);
    const img = load(md).parsed.json.content?.[2];
    expect(img?.type).toBe('image');
    expect(img?.attrs?.path).toBe('../images/2026-10-03-141602.png');
    expect(img?.attrs?.src).toBe('https://img/../images/2026-10-03-141602.png');
  });
});

describe('MD-07 line breaks', () => {
  it('reads soft, backslash and two-space breaks as line breaks, written as plain new lines', () => {
    expect(canonical('one\ntwo\\\nthree  \nfour\n')).toBe('one\ntwo\nthree\nfour\n');
  });
  it('escapes a line that would otherwise become a list or heading', () => {
    const { doc } = load('x\n');
    const p = schema.nodes.paragraph.create(null, [schema.text('intro'), schema.nodes.hardBreak.create(), schema.text('- not a list'), schema.nodes.hardBreak.create(), schema.text('# not a heading')]);
    const out = new MarkdownWriter(schema, reader).serialize(doc.copy(Fragment.from(p)));
    expect(out).toBe('intro\n\\- not a list\n\\# not a heading\n');
    expect(canonical(out)).toBe(out);
  });
});

describe('MD-08 blank lines', () => {
  it('N blank lines ⇄ N-1 empty paragraphs', () => {
    const md = 'a\n\n\n\nb\n';
    expect(types(md)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(canonical(md)).toBe(md);
  });
  it('keeps leading blank lines and drops trailing ones', () => {
    expect(canonical('\n\nfirst\n\n\n\n')).toBe('\n\nfirst\n');
  });
});

describe('MD-09 unknown syntax kept byte for byte', () => {
  it('front matter, tables and definitions are raw blocks', () => {
    const md = '---\ntitle: x\ntags: [a, b]\n---\n\n| a  | b |\n|----|---|\n| 1  | 2 |\n\n[^1]: footnote text\n';
    expect(types(md)).toEqual(['rawBlock', 'rawBlock', 'rawBlock']);
    expect(canonical(md)).toBe(md);
  });
  it('XML-style prompt tags are text lines', () => {
    const md = '<instructions>\nDo X\n</instructions>\n\n<context>\n\nbody\n\n</context>\n';
    expect(types(md)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(canonical(md)).toBe(md);
  });
  it('inline tags stay unescaped', () => {
    expect(roundTripStable('Wrap it in <answer> tags & keep a < b.\n')).toBe('Wrap it in <answer> tags & keep a < b.\n');
  });
});

describe('MD-10 minimal diffs', () => {
  it('editing one block leaves the others byte-identical', () => {
    const md = '# Title\n\nSome  *odd*   spacing_here\n\n+ plus list\n+ item\n\nlast para\n';
    const { doc, writer } = load(md);
    expect(writer.serialize(doc)).toBe(md);
    const edited = editChild(doc, 3, (p) => p.copy(Fragment.from(schema.text('last para edited'))));
    const out = writer.serialize(edited);
    expect(out).toBe('# Title\n\nSome  *odd*   spacing_here\n\n+ plus list\n+ item\n\nlast para edited\n');
  });
});

describe('MD-11 escaping only when needed', () => {
  const cases = [
    'a * b and 2*3*4',
    'snake_case_name and _leading',
    'use `npm` with \\ backslash',
    '[not a link] and [x](y)',
    '1. at start',
    '> not a quote',
    '| pipe | text |',
    '# hash',
    '<tag> and &amp; literal',
    '~/home and ~~x',
  ];
  for (const text of cases) {
    it(`"${text}" survives as the same text`, () => {
      const { doc } = load('x\n');
      const p = schema.nodes.paragraph.create(null, schema.text(text));
      const md = new MarkdownWriter(schema, reader).serialize(doc.copy(Fragment.from(p)));
      const back = schema.nodeFromJSON(reader.parse(md, { mentions: {}, imageSrc: (s) => s }).json);
      expect(back.firstChild?.textContent).toBe(text);
    });
  }
});

describe('MD-12 mentions', () => {
  const inline = (md: string) => load(md).parsed.json.content?.[0].content ?? [];
  it('reads files, folders and quoted paths as chips', () => {
    const nodes = inline('See @src/a.ts and @src/config/ and @"docs/my notes.md".\n');
    const ids = nodes.filter((n) => n.type === 'mention').map((n) => n.attrs?.id);
    expect(ids).toEqual(['src/a.ts', 'src/config/', 'docs/my notes.md']);
    expect(nodes[nodes.length - 1]).toMatchObject({ type: 'text', text: '.' });
  });
  it('leaves @team and emails as text, but takes @README when it exists', () => {
    const nodes = inline('ask @team or mail a@b.com about @README\n');
    expect(nodes.filter((n) => n.type === 'mention').map((n) => n.attrs?.id)).toEqual(['README']);
  });
  it('reads mentions after "(" and at line start, never inside code', () => {
    const nodes = inline('@src/a.ts (@src/a.ts) `@src/a.ts`\n');
    expect(nodes.filter((n) => n.type === 'mention')).toHaveLength(2);
    expect(types('```\n@src/a.ts\n```\n')).toEqual(['codeBlock']);
  });
  it('writes them back unchanged', () => {
    const md = 'See @src/a.ts, @src/config/ and @"docs/my notes.md".\n';
    expect(canonical(md)).toBe(md);
  });
});

describe('MD-13 broken mentions', () => {
  it('path-like tokens that are missing are broken chips and are written back', () => {
    const md = 'Ignore @src/legacy-session.ts please\n';
    const nodes = load(md, { 'src/legacy-session.ts': { exists: false, kind: 'file' } }).parsed.json.content?.[0].content ?? [];
    expect(nodes.some((n) => n.type === 'mention')).toBe(true);
    expect(canonical(md)).toBe(md);
  });
});

describe('MD-14 deterministic', () => {
  const corpus = [
    '# T\n\nPara with **b** and @src/a.ts\n\n- [ ] a\n- [x] b\n\n```py\nprint(1)\n```\n\n> q\n',
    '\n\n\nlead\n\n\n\n\ntail\n',
    '1. a\n2. b\n\n1) c\n2) d\n',
    'Line one\nline two\n\n---\n\n![a](../images/x.png)\n\n<!-- comment -->\n',
  ];
  for (const md of corpus) it(JSON.stringify(md).slice(0, 40), () => { roundTripStable(md); });
});

describe('MD-15 empty documents', () => {
  it('an empty document is an empty file', () => {
    expect(canonical('')).toBe('');
    expect(canonical('\n\n\n')).toBe('');
  });
});
