// Checks Claude Code's Ctrl+G path end to end with the packaged extension (Linux/macOS): installs the .vsix into a
// throwaway profile (never your own VS Code), opens the fixture, then runs claude-code/claude-prompt-composer the
// way Claude Code does, from a subfolder. The helper must find the window through the registry, `code --wait` must
// open the prompt there, typing and Ctrl+W must hand the text back.
//   npm run package && node test/e2e/claude-smoke.mjs
import { _electron } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { codeExecutable, BASE_SETTINGS, VSCode } from './driver.mjs';
import { prepareWorkspace } from '../fixtures/prepare.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const vsix = readdirSync(root).find((f) => f.endsWith('.vsix'));
if (!vsix) throw new Error('run npm run package first');
const exe = await codeExecutable();
const cliJs = [join(dirname(exe), 'resources', 'app', 'out', 'cli.js'), ...readdirSync(dirname(exe)).map((d) => join(dirname(exe), d, 'resources', 'app', 'out', 'cli.js'))].find((f) => existsSync(f));
const tmp = mkdtempSync(join(tmpdir(), 'pc-claude-smoke-'));
const ext = join(tmp, 'ext');
const ud = join(tmp, 'ud');
const cache = join(tmp, 'cache');
mkdirSync(join(ud, 'User'), { recursive: true });
writeFileSync(join(ud, 'User', 'settings.json'), JSON.stringify(BASE_SETTINGS));
const env = { ...process.env, XDG_CACHE_HOME: cache };
for (const k of Object.keys(env)) if (/^(VSCODE_|ELECTRON_)/i.test(k)) delete env[k];
execFileSync(exe, [cliJs, '--extensions-dir', ext, '--user-data-dir', ud, '--install-extension', join(root, vsix)], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });

// `code` for the helper: VS Code's CLI aimed at this throwaway instance
const bin = join(tmp, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'code'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${cliJs}" --user-data-dir "${ud}" --extensions-dir "${ext}" "$@"\n`);
chmodSync(join(bin, 'code'), 0o755);

const { ws } = prepareWorkspace();
const app = await _electron.launch({
  executablePath: exe, env, timeout: 90_000,
  args: [ws, `--user-data-dir=${ud}`, `--extensions-dir=${ext}`, '--new-window', '--skip-welcome', '--disable-workspace-trust', '--enable-smoke-test-driver'],
});
const page = await app.firstWindow();
const vsc = new VSCode(app, page, 0, tmp, ws);
let helper;
try {
  await page.waitForFunction(() => !!window.driver, null, { timeout: 90_000 });
  await page.evaluate(() => window.driver.whenWorkbenchRestored());
  const registry = join(cache, 'prompt-composer', 'windows');
  await vsc.waitFor(() => existsSync(registry) && readdirSync(registry).length > 0, 30_000, 'the window to register');
  const entry = readFileSync(join(registry, readdirSync(registry)[0]), 'utf8');
  assert.equal(entry, `${ws}\n${ws}\n`, 'registry entry: folder, then what code opens');

  // Claude's side: its temp file, and the helper run from a subfolder of the open project
  const claude = join(tmp, 'claude');
  mkdirSync(claude);
  const md = join(claude, 'claude-prompt-smoke.md');
  writeFileSync(md, 'Hello from Claude\n');
  const helperPath = join(root, 'claude-code', 'claude-prompt-composer');
  helper = spawn('setsid', ['-w', helperPath, md], { cwd: join(ws, 'src'), env: { ...env, PATH: `${bin}:${env.PATH}` }, stdio: ['ignore', 'ignore', 'inherit'] });
  let exitCode;
  helper.on('exit', (c) => { exitCode = c; });

  await vsc.editorFrame().locator('.ProseMirror', { hasText: 'Hello from Claude' }).waitFor({ timeout: 30_000 });
  const tab = await page.locator('.tabs-container .tab.active .label-name').first().innerText();
  assert.equal(tab, 'Hello from Claude', 'the tab shows the prompt title');
  assert.ok(existsSync(join(claude, 'claude-prompt-smoke', 'Claude - src.prompt')), 'the helper made its .prompt');
  await vsc.shot(join(root, 'test-results', 'claude-smoke'), 'open');
  await vsc.focusEditor();
  await vsc.press('Control+End');
  await vsc.type(' and back');
  await vsc.sleep(300);
  assert.equal(exitCode, undefined, 'the helper waits while the tab is open');
  await vsc.press('Control+w');
  await vsc.waitFor(() => exitCode !== undefined, 15_000, 'the helper to finish');
  assert.equal(exitCode, 0);
  assert.equal(readFileSync(md, 'utf8'), 'Hello from Claude and back\n');
  assert.ok(!existsSync(join(claude, 'claude-prompt-smoke')), 'the helper cleaned up');
  console.log('Claude Ctrl+G smoke test passed');
} finally {
  helper?.kill();
  await app.close().catch(() => undefined);
}
