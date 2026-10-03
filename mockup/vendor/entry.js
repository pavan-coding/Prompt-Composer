// Entry for vendor/tiptap.js: Tiptap 3.31.4 bundled into one IIFE (window.Tiptap) so the
// mockup has a single ProseMirror instance and works offline from file://.
// Rebuild (in any scratch folder with these packages installed; Tiptap at 3.31.4, lowlight 3.3.0):
//   npx esbuild entry.js --bundle --format=iife --global-name=Tiptap --minify --legal-comments=none --outfile=tiptap.js
// codicon.css / codicon.ttf are copied from @vscode/codicons@0.0.36/dist; icons.css is generated from lucide-static;
// fonts come from @fontsource-variable/dm-sans and @fontsource-variable/inter.
export { Editor, Extension, mergeAttributes } from '@tiptap/core';
export { NodeSelection, TextSelection, PluginKey } from '@tiptap/pm/state';
export { StarterKit } from '@tiptap/starter-kit';
export { Mention } from '@tiptap/extension-mention';
export { Image } from '@tiptap/extension-image';
export { Placeholder } from '@tiptap/extensions';
export { TaskList, TaskItem } from '@tiptap/extension-list';
export { BubbleMenu } from '@tiptap/extension-bubble-menu';
export { Suggestion } from '@tiptap/suggestion';
export { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
export { createLowlight, common } from 'lowlight';
