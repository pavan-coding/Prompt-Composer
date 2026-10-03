import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { decodeEntities, imagePaths, mentionPaths, normalizeRel, searchLines, titleOf, toPromptText } from '../../src/common/markdownText';
import { findMentions, formatMention, looksLikePath, mentionLabel, stripCode } from '../../src/common/mentionSyntax';
import { MarkdownReader } from '../../src/webview/editor/markdown';
import { schemaExtensions } from '../../src/webview/editor/nodes';

describe('MD-16 titles', () => {
  it('first heading or first line, Markdown removed', () => {
    expect(titleOf('# Refactor **auth**\n\nbody')).toBe('Refactor auth');
    expect(titleOf('\n\nFix the [login](https://x) bug in `auth.ts`\nmore')).toBe('Fix the login bug in auth.ts');
    expect(titleOf('- [ ] task one\n- two')).toBe('task one');
    expect(titleOf('> quoted *start*')).toBe('quoted start');
    expect(titleOf('---\ntitle: x\n---\n\n## Real title')).toBe('Real title');
    expect(titleOf('![shot](../images/a.png)\n\nAfter the image')).toBe('After the image');
    expect(titleOf('Look at @"docs/my notes.md" now')).toBe('Look at @docs/my notes.md now');
    expect(titleOf('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
    expect(titleOf('<instructions>\nDo X')).toBe('<instructions>');
  });
  it('is at most 80 characters and empty for an empty prompt', () => {
    expect(titleOf('x'.repeat(120)).length).toBe(80);
    expect(titleOf('')).toBe('');
    expect(titleOf('\n\n---\n\n')).toBe('');
  });
  it('agrees with the editor on everyday prompts', () => {
    // The editor computes titles from its document; the host from Markdown. They must match for the panel.
    const schema = getSchema(schemaExtensions());
    const reader = new MarkdownReader();
    const editorTitle = (md: string) => {
      const doc = schema.nodeFromJSON(reader.parse(md, { mentions: {}, imageSrc: (s) => s }).json);
      let t = '';
      doc.descendants((n) => {
        if (t) return false;
        if (n.isTextblock && n.type.name !== 'rawBlock') {
          let line = '';
          n.forEach((c) => { if (c.type.name === 'mention') line += '@' + c.attrs.id; else if (c.type.name === 'hardBreak') line += '\n'; else line += c.text ?? ''; });
          t = line.split('\n')[0].replace(/\s+/g, ' ').trim();
          return false;
        }
        return true;
      });
      return t;
    };
    for (const md of ['# Title here\n', 'Fix **bold** and *it* in @src/a.ts\n', '1. first item\n', '> quote\n', 'line one\nline two\n', '## A `code` title\n']) {
      expect(titleOf(md)).toBe(editorTitle(md));
    }
  });
});

describe('MD-17 search text', () => {
  it('has headings, body, list items, code and @paths', () => {
    const lines = searchLines('# Title\n\nUse @src/server/routes.ts\n\n- item **one**\n\n```bash\nnpm test\n```\n\n![shot](../images/x.png)');
    expect(lines).toEqual(['Title', 'Use @src/server/routes.ts', 'item one', 'npm test', 'shot ../images/x.png']);
  });
});

describe('mention syntax', () => {
  it('finds mentions after whitespace, "(" and at line start; not in emails', () => {
    expect(findMentions('@a.ts (@b/c) x@y.com @"d e.md". end').map((m) => m.path)).toEqual(['a.ts', 'b/c', 'd e.md']);
  });
  it('drops trailing sentence punctuation', () => {
    expect(findMentions('see @src/a.ts. And @src/b.ts:').map((m) => m.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
  it('MN-10 writes quoted paths only when needed', () => {
    expect(formatMention('src/a.ts')).toBe('@src/a.ts');
    expect(formatMention('src/config/')).toBe('@src/config/');
    expect(formatMention('docs/my notes.md')).toBe('@"docs/my notes.md"');
    expect(formatMention('weird(1).ts')).toBe('@"weird(1).ts"');
  });
  it('labels and path-likeness', () => {
    expect(mentionLabel('src/config/')).toBe('config');
    expect(mentionLabel('src/a.ts')).toBe('a.ts');
    expect(looksLikePath('team')).toBe(false);
    expect(looksLikePath('README.md')).toBe(true);
    expect(looksLikePath('src/x')).toBe(true);
    expect(looksLikePath('.env')).toBe(true);
  });
  it('ignores code', () => {
    expect(mentionPaths('real @a.ts `@b.ts`\n\n```\n@c.ts\n```\n@d.ts')).toEqual(['a.ts', 'd.ts']);
    expect(stripCode('x `y` z')).toBe('x  z');
  });
});

describe('IM-06 Copy as Prompt', () => {
  it('turns local images into @paths and leaves code and web images alone', () => {
    const md = 'See ![shot](../images/2026-10-03-141602.png) and ![web](https://x/y.png)\n\n```md\n![keep](../images/k.png)\n```\n';
    const r = toPromptText(md, '.prompt-composer/2026-10');
    expect(r.images).toBe(1);
    expect(r.text).toBe('See @.prompt-composer/images/2026-10-03-141602.png and ![web](https://x/y.png)\n\n```md\n![keep](../images/k.png)\n```\n');
  });
  it('lists image paths for cleanup', () => {
    expect(imagePaths('![a](../images/a.png) ![b](../images/My%20Shot.png) ![c](https://x)', '.prompt-composer/2026-10'))
      .toEqual(['.prompt-composer/images/a.png', '.prompt-composer/images/My Shot.png']);
  });
  it('normalizes relative paths', () => {
    expect(normalizeRel('a/b/../c/./d')).toBe('a/c/d');
    expect(normalizeRel('../x')).toBeUndefined();
  });
  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#65;&#x42; &unknown;')).toBe('a & b <c> AB &unknown;');
  });
});
