// Checks the packaged extension: installs the .vsix into a throwaway profile (never your own VS Code),
// opens the sample fixture, makes and saves a prompt.   npm run package && node test/e2e/vsix-smoke.mjs
import { _electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { codeExecutable, BASE_SETTINGS } from './driver.mjs';
import { prepareWorkspace } from '../fixtures/prepare.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const vsix = readdirSync(root).find((f) => f.endsWith('.vsix'));
if (!vsix) throw new Error('run npm run package first');
const exe = await codeExecutable();
const tmp = mkdtempSync(join(tmpdir(), 'pc-vsix-'));
const ext = join(tmp, 'ext');
const ud = join(tmp, 'ud');
mkdirSync(join(ud, 'User'), { recursive: true });
writeFileSync(join(ud, 'User', 'settings.json'), JSON.stringify(BASE_SETTINGS));
// the CLI is Code.exe running cli.js as Node (what bin/code.cmd does); its folder may be versioned
const cliJs = [join(dirname(exe), 'resources', 'app', 'out', 'cli.js'), ...readdirSync(dirname(exe)).map((d) => join(dirname(exe), d, 'resources', 'app', 'out', 'cli.js'))].find((f) => existsSync(f));
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(VSCODE_|ELECTRON_)/i.test(k)) delete env[k];
execFileSync(exe, [cliJs, '--extensions-dir', ext, '--user-data-dir', ud, '--install-extension', join(root, vsix)], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
const { ws } = prepareWorkspace();
const app = await _electron.launch({
  executablePath: exe, env, timeout: 90_000,
  args: [ws, `--user-data-dir=${ud}`, `--extensions-dir=${ext}`, '--new-window', '--skip-welcome', '--disable-workspace-trust', '--enable-smoke-test-driver'],
});
const page = await app.firstWindow();
try {
  await page.waitForFunction(() => !!window.driver, null, { timeout: 90_000 });
  await page.evaluate(() => window.driver.whenWorkbenchRestored());
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setAlwaysOnTop(true); w.focus(); w.setAlwaysOnTop(false); });
  const palette = async (title) => {
    await page.keyboard.press('F1');
    await page.locator('.quick-input-widget input').waitFor();
    await page.keyboard.type(title, { delay: 5 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
  };
  await palette('Prompt Composer: New Prompt');
  const frame = page.locator('iframe.webview.ready[src*="extensionId=pavan-coding.prompt-composer"]:not([src*="purpose="])').filter({ visible: true }).first().contentFrame().locator('#active-frame').contentFrame();
  const pm = frame.locator('.ProseMirror');
  await pm.waitFor({ timeout: 20_000 });
  await pm.click();
  await pm.focus();
  await page.keyboard.type('# Packaged build works', { delay: 10 });
  await page.keyboard.press('Control+s');
  const month = join(ws, '.prompt-composer');
  for (let i = 0; i < 50 && !(existsSync(month) && readdirSync(month).some((d) => /^\d{4}-\d{2}$/.test(d))); i++) await page.waitForTimeout(100);
  const months = readdirSync(month).filter((d) => /^\d{4}-\d{2}$/.test(d));
  const files = readdirSync(join(month, months[0]));
  console.log('saved:', files);
  if (!files.some((f) => f.endsWith('-packaged-build-works.md'))) throw new Error('prompt not saved');
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'vsix-smoke.png') });
  console.log('VSIX smoke test passed');
} finally {
  await app.close();
}
