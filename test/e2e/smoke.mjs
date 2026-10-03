// Quick look: launch VS Code with the extension, make a prompt, save it, take screenshots.
//   node test/e2e/smoke.mjs
import { launch } from './driver.mjs';
import { prepareWorkspace } from '../fixtures/prepare.mjs';
import { join, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const out = resolve(import.meta.dirname, '..', '..', 'test-results', 'smoke');
const { ws } = prepareWorkspace();
const vsc = await launch({ ws });
try {
  await vsc.openPanel();
  await vsc.shot(out, '01-panel');
  await vsc.command('promptComposer.newPrompt');
  await vsc.focusEditor();
  await vsc.type('# Smoke test prompt');
  await vsc.press('Enter');
  await vsc.type('Look at @');
  await vsc.sleep(800);
  await vsc.shot(out, '02-picker');
  await vsc.press('Escape');
  await vsc.type('src/server/auth.ts please');
  await vsc.sleep(400);
  await vsc.shot(out, '03-typed');
  await vsc.press('Control+s');
  await vsc.sleep(800);
  const st = await vsc.state();
  console.log(JSON.stringify(st.docs, null, 1));
  const store = join(ws, '.prompt-composer');
  console.log('store exists:', existsSync(store), existsSync(store) ? readdirSync(store) : '');
  await vsc.shot(out, '04-saved');
  console.log(vsc.logs.filter((l) => /error|warn/i.test(l)).slice(-20).join('\n'));
} finally {
  await vsc.close();
}
