// Drives a real VS Code window with the extension loaded (Playwright's Electron driver, as VS Code's own
// smoke tests do). Used by run.mjs; also handy on its own for debugging: it saves screenshots and logs.
import { _electron } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export const EXT_ID = 'pavan-coding.prompt-composer';
const root = resolve(import.meta.dirname, '..', '..');

export async function codeExecutable() {
  if (process.env.CODE_EXE) return process.env.CODE_EXE;
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
  return downloadAndUnzipVSCode({ version: process.env.CODE_VERSION ?? 'stable', cachePath: join(root, '.vscode-test') });
}

async function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

export const BASE_SETTINGS = {
  'window.dialogStyle': 'custom',
  'workbench.startupEditor': 'none',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'chat.disableAIFeatures': true,
  'workbench.tips.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'workbench.enableExperiments': false,
  'git.enabled': false,
  'workbench.colorTheme': 'Default Dark Modern',
  'security.workspace.trust.enabled': false,
  'workbench.editor.enablePreview': true,
  'files.hotExit': 'onExitAndWindowClose',
  'window.restoreWindows': 'all',
};

/** Launch VS Code on `ws` with the extension from this repo. */
export async function launch({ ws, settings = {}, userData, scale = 1.25, size = [1500, 950] } = {}) {
  const exe = await codeExecutable();
  const tmp = userData ?? mkdtempSync(join(tmpdir(), 'pc-e2e-'));
  mkdirSync(join(tmp, 'ud', 'User'), { recursive: true });
  const settingsFile = join(tmp, 'ud', 'User', 'settings.json');
  if (!existsSync(settingsFile)) writeFileSync(settingsFile, JSON.stringify({ ...BASE_SETTINGS, ...settings }, null, 2));
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(VSCODE_|ELECTRON_)/i.test(k)) delete env[k];
  env.PROMPT_COMPOSER_E2E_PORT = String(port);
  env.XDG_CACHE_HOME = join(tmp, 'cache'); // the window registry for Claude Code's Ctrl+G: never your real one
  const app = await _electron.launch({
    executablePath: exe,
    env,
    timeout: 90_000,
    args: [
      ...(ws ? [ws] : []),
      `--extensionDevelopmentPath=${root}`,
      `--user-data-dir=${join(tmp, 'ud')}`,
      `--extensions-dir=${join(tmp, 'ext')}`,
      '--disable-extensions',
      '--new-window',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
      '--disable-telemetry',
      '--disable-experiments',
      '--no-cached-data',
      '--enable-smoke-test-driver',
      `--force-device-scale-factor=${scale}`,
    ],
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(w, h);
    win.center();
    // Keyboard focus only follows clicks when the OS window itself is focused.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.setAlwaysOnTop(false);
  }, size).catch(() => undefined);
  const vsc = new VSCode(app, page, port, tmp, ws);
  await vsc.ready();
  return vsc;
}

export class VSCode {
  constructor(app, page, port, tmp, ws) {
    Object.assign(this, { app, page, port, tmp, ws });
    this.logs = [];
    page.on('console', (m) => this.logs.push(`[${m.type()}] ${m.text()}`));
  }

  async ready() {
    await this.page.waitForFunction(() => !!window.driver, null, { timeout: 90_000 });
    await this.page.evaluate(() => window.driver.whenWorkbenchRestored());
    // without a folder the extension has no test bridge
    if (this.ws) await this.waitFor(async () => (await this.state().catch(() => null)) !== null, 30_000, 'extension test bridge');
  }

  // ---- extension bridge
  async call(method, path, body) {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(`${path}: ${json?.error ?? res.status}`);
    return json;
  }
  state() { return this.call('GET', '/state'); }
  command(command, ...args) { return this.call('POST', '/command', { command, args }); }
  config(section, key, value) { return this.call('POST', '/config', { section, key, value }); }

  // ---- waiting
  async waitFor(fn, timeout = 10_000, what = 'condition') {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await fn(); if (last) return last; } catch (e) { last = e; }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
  }
  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---- webviews
  /** The visible prompt editor webview (panel webviews have no "purpose" in their URL). */
  editorFrame() {
    return this.page.locator(`iframe.webview.ready[src*="extensionId=${EXT_ID}"]:not([src*="purpose="])`).filter({ visible: true }).first().contentFrame().locator('#active-frame').contentFrame();
  }
  libraryFrame() {
    return this.page.locator(`iframe.webview.ready[src*="extensionId=${EXT_ID}"][src*="purpose=webviewView"]`).filter({ visible: true }).first().contentFrame().locator('#active-frame').contentFrame();
  }
  async visibleEditorCount() {
    return this.page.locator(`iframe.webview.ready[src*="extensionId=${EXT_ID}"]:not([src*="purpose="])`).filter({ visible: true }).count();
  }

  /** Click into the editor and wait until keystrokes will really land there (focus moves to the frame asynchronously). */
  async focusEditor() {
    const pm = this.editorFrame().locator('.ProseMirror');
    await pm.waitFor({ timeout: 15_000 });
    await pm.click({ position: { x: 5, y: 5 } }).catch(() => pm.click());
    await pm.focus();
    await pm.evaluate((el) => new Promise((r) => {
      const t = setInterval(() => { if (el.contains(document.activeElement)) { clearInterval(t); r(); } }, 20);
      setTimeout(() => { clearInterval(t); r(); }, 3000);
    }));
    return pm;
  }

  async type(text, delay = 10) {
    await this.page.keyboard.type(text, { delay });
  }
  async press(keys) {
    for (const k of keys.split(' ')) await this.page.keyboard.press(k);
  }

  async openPanel() {
    await this.command('workbench.view.extension.promptComposer');
    await this.libraryFrame().locator('#tree').waitFor({ timeout: 15_000 });
  }

  /** Run a command through the Command Palette like a user would. */
  async palette(title) {
    await this.page.keyboard.press('F1');
    await this.page.locator('.quick-input-widget input').waitFor();
    await this.page.keyboard.type(title, { delay: 5 });
    await this.sleep(300);
    await this.page.keyboard.press('Enter');
  }

  async closeAllEditors() {
    await this.command('workbench.action.closeAllEditors').catch(() => undefined);
    await this.sleep(200);
    await this.answerDialog("Don't Save").catch(() => undefined);
  }

  /** Click a button in VS Code's custom (in-window) dialog, if one is showing. */
  async answerDialog(label, timeout = 1500) {
    const dialog = this.page.locator('.monaco-dialog-box');
    await dialog.waitFor({ timeout });
    const text = await dialog.innerText();
    if (label === 'Cancel') await this.page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: label, exact: true }).click();
    return text;
  }

  async shot(dir, name) {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}.png`);
    await this.page.screenshot({ path, timeout: 20_000 }).catch(() => undefined);
    return path;
  }

  async close() {
    await this.app.close().catch(() => undefined);
  }

  readFile(rel) {
    return readFileSync(join(this.ws, ...rel.split('/')), 'utf8');
  }
}
