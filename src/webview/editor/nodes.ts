// The document schema: StarterKit plus task lists, images that remember their file path, @mentions,
// highlighted code blocks and raw Markdown blocks. Used by the editor and, without UI, by unit tests.
import { Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Image } from '@tiptap/extension-image';
import { Mention } from '@tiptap/extension-mention';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

// highlight.js gives every keyword one class. VS Code's Dark+/Light+ (which Dark/Light Modern use)
// colour flow-control words differently (purple), so tag those to match.
const CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'throw',
  'try', 'catch', 'finally', 'await', 'yield', 'import', 'export', 'from', 'as', 'elif', 'except', 'raise', 'with', 'match', 'loop', 'goto']);
type HastNode = { properties?: { className?: string[] }; children?: HastNode[]; value?: string };
function tagControl<T>(tree: T): T {
  const walk = (n: HastNode) => {
    const cls = n.properties?.className;
    if (cls?.includes('hljs-keyword') && n.children?.length === 1 && CONTROL.has(n.children[0].value ?? '')) n.properties!.className = [...cls, 'hljs-control'];
    n.children?.forEach(walk);
  };
  walk(tree as HastNode);
  return tree;
}
const hl = createLowlight(common);
export const lowlight = {
  ...hl,
  highlight: (...a: Parameters<typeof hl.highlight>) => tagControl(hl.highlight(...a)),
  highlightAuto: (...a: Parameters<typeof hl.highlightAuto>) => tagControl(hl.highlightAuto(...a)),
} as typeof hl;

/** Markdown we don't edit structurally (front matter, tables, definitions): kept byte for byte, editable as text. */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML: () => [{ tag: 'pre[data-raw]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => ['pre', mergeAttributes(HTMLAttributes, { 'data-raw': '', class: 'raw-block' }), ['code', 0]],
});

/** Images keep the path written in the file separately from the URL they're displayed from. */
export const PathImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: { default: null, parseHTML: (el) => el.getAttribute('data-path'), renderHTML: (a) => (a.path ? { 'data-path': a.path } : {}) },
    };
  },
}).configure({ allowBase64: true, inline: false });

// the file stores the full path; the label is only for display
export const BaseMention = Mention.configure({ renderText: ({ node }) => '@' + node.attrs.id });

export const BaseCodeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null });

/** The schema extensions. The editor passes its own configured versions of mention/code block. */
export function schemaExtensions(overrides: { mention?: AnyExtension; codeBlock?: AnyExtension } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      underline: false,
      codeBlock: false,
      trailingNode: false,
      undoRedo: false,
    }),
    overrides.codeBlock ?? BaseCodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    PathImage,
    overrides.mention ?? BaseMention,
    RawBlock,
  ];
}
