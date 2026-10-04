// Build: the extension host bundle (CommonJS, Node), one IIFE per webview, and the webview assets.
//   node esbuild.mjs               development build
//   node esbuild.mjs --production  minified, no source maps
//   node esbuild.mjs --watch       rebuild on change
//   node esbuild.mjs --tests       integration tests → out/test/integration
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');

// Lucide icons used by the editor UI, turned into CSS masks (<span class="ic i-NAME">) that take currentColor.
const ICONS = [
  'heading', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'pilcrow', 'chevron-down',
  'list', 'list-ordered', 'list-todo', 'text-quote', 'square-code', 'bold', 'italic', 'strikethrough', 'code', 'link',
  'image-plus', 'at-sign', 'file', 'folder', 'file-symlink', 'folder-symlink', 'file-text', 'file-code', 'file-json',
  'file-image', 'triangle-alert', 'remove-formatting', 'arrow-right', 'link-2', 'minus', 'grip-vertical', 'arrow-up',
  'arrow-down', 'copy', 'trash-2', 'check', 'braces', 'zoom-in', 'zoom-out', 'x',
];

function writeIfChanged(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  try { if (readFileSync(file, 'utf8') === content) return; } catch { /* new file */ }
  writeFileSync(file, content);
}

function buildAssets() {
  let css = '/* Lucide icons (ISC license, lucide.dev) as CSS masks: <span class="ic i-NAME"></span> takes currentColor. */\n' +
    '.ic { display: inline-block; width: 16px; height: 16px; flex: none; background-color: currentColor;\n' +
    '  -webkit-mask: var(--i) center / contain no-repeat; mask: var(--i) center / contain no-repeat; vertical-align: -3px; }\n';
  for (const n of ICONS) {
    const svg = readFileSync(`node_modules/lucide-static/icons/${n}.svg`, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/\s*class="[^"]*"/, '').replace(/stroke="currentColor"/, 'stroke="black"')
      .replace(/\s+/g, ' ').trim();
    css += `.i-${n} { --i: url("data:image/svg+xml,${encodeURIComponent(svg)}"); }\n`;
  }
  writeIfChanged('dist/media/icons.css', css);
  const copies = [
    ['node_modules/@vscode/codicons/dist/codicon.css', 'dist/media/codicon.css'],
    ['node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/media/codicon.ttf'],
    ['node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2', 'dist/media/dm-sans-normal.woff2'],
    ['node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-italic.woff2', 'dist/media/dm-sans-italic.woff2'],
    ['node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'dist/media/inter-normal.woff2'],
  ];
  for (const [from, to] of copies) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

/** Log each output file's size, raw and gzipped (PF-04). */
const sizeReport = {
  name: 'size-report',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      for (const file of Object.keys(result.metafile?.outputs ?? {})) {
        if (file.endsWith('.map')) continue;
        const buf = readFileSync(file);
        console.log(`  ${file.padEnd(28)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${(gzipSync(buf).length / 1024).toFixed(1).padStart(6)} KB gzip`);
      }
    });
  },
};

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  metafile: true,
  logLevel: 'warning',
  legalComments: 'none',
  plugins: [sizeReport],
};

function testEntries(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testEntries(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const configs = tests
  ? [{
      ...common,
      plugins: [],
      entryPoints: testEntries('test/integration'),
      outdir: 'out/test/integration',
      outbase: 'test/integration',
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['vscode', 'mocha'],
      sourcemap: 'inline',
    }]
  : [
      {
        ...common,
        entryPoints: { extension: 'src/extension.ts' },
        outdir: 'dist',
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['vscode'],
      },
      {
        ...common,
        entryPoints: { editor: 'src/webview/editor/main.ts', library: 'src/webview/library/main.ts' },
        outdir: 'dist',
        platform: 'browser',
        format: 'iife',
        target: 'chrome120',
        loader: { '.css': 'css' },
      },
    ];

if (!tests) buildAssets();
if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('watching…');
} else {
  for (const c of configs) await esbuild.build(c);
}
