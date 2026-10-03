// End-to-end UI tests: a real VS Code window (Playwright's Electron driver) with the extension loaded,
// on a temporary copy of the fixture workspace. Each test's name starts with its case ID (docs/TEST-CASES.md).
// Screenshots and a results file go to test-results/e2e/.
//   node test/e2e/run.mjs              all tests
//   node test/e2e/run.mjs ED-14 SV     only tests whose name contains one of the words
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './driver.mjs';
import { prepareWorkspace } from '../fixtures/prepare.mjs';
import { tests } from './tests.mjs';

const out = resolve(import.meta.dirname, '..', '..', 'test-results', 'e2e');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const filters = process.argv.slice(2);
const selected = tests.filter((t) => !filters.length || filters.some((f) => t.name.includes(f)));

const fixture = prepareWorkspace();
let vsc = await launch({ ws: fixture.ws });
const results = [];
const started = Date.now();
try {
  for (const t of selected) {
    const t0 = Date.now();
    const shots = join(out, t.name.split(' ')[0]);
    const ctx = {
      vsc,
      ws: fixture.ws,
      fixture,
      out: shots,
      shot: (name) => vsc.shot(shots, name),
      note: (msg) => { (result.notes ??= []).push(msg); },
      skip: (reason) => { const e = new Error(reason); e.skip = true; throw e; },
      relaunch: async () => {
        await vsc.close();
        vsc = await launch({ ws: fixture.ws, userData: vsc.tmp });
        ctx.vsc = vsc;
        return vsc;
      },
    };
    const result = { name: t.name };
    process.stdout.write(`… ${t.name}`);
    try {
      await t.fn(ctx);
      result.ok = true;
    } catch (e) {
      if (e?.skip) {
        result.ok = true;
        result.skipped = e.message;
      } else {
        result.ok = false;
        result.error = String(e?.stack ?? e).split('\n').slice(0, 6).join('\n');
        await vsc.shot(shots, 'failure');
      }
    }
    result.ms = Date.now() - t0;
    results.push(result);
    process.stdout.write(`\r${result.skipped ? '○' : result.ok ? '✔' : '✘'} ${t.name} (${result.ms} ms)${result.skipped ? '  — skipped: ' + result.skipped : ''}${result.notes ? '  — ' + result.notes.join('; ') : ''}\n`);
    if (!result.ok) process.stdout.write(`    ${result.error.replace(/\n/g, '\n    ')}\n`);
    // reset between tests
    try {
      await vsc.page.keyboard.press('Escape');
      await vsc.closeAllEditors();
      await vsc.answerDialog("Don't Save", 800).catch(() => undefined);
    } catch { /* window may be gone */ }
  }
} finally {
  writeFileSync(join(out, 'console.log'), vsc.logs.join('\n'));
  await vsc.close();
}
const passed = results.filter((r) => r.ok && !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, skipped, failed: results.length - passed - skipped, ms: Date.now() - started, results }, null, 2));
console.log(`\n${passed} passed, ${skipped} skipped, ${results.length - passed - skipped} failed (${Math.round((Date.now() - started) / 1000)} s). Screenshots: ${out}`);
process.exit(passed + skipped === results.length ? 0 : 1);
void readFileSync; void existsSync; void readdirSync;
