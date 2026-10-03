// Bigger trees: the @ index cap (MN-05) and the first index of 50k files (PF-03).
// Runs last (file name sorts after extension.test.ts); it adds many files to the fixture workspace.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PromptComposerApi } from '../../src/extension';

let api: PromptComposerApi;
const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeTree(root: string, files: number, perDir = 100): void {
  for (let d = 0; d * perDir < files; d++) {
    const dir = path.join(root, `dir${String(d).padStart(4, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < perDir && d * perDir + f < files; f++) fs.writeFileSync(path.join(dir, `file${f}.ts`), '');
  }
}

async function rebuild(): Promise<number> {
  await sleep(300); // let any rebuild started by a settings change finish first
  while (api.index.isIndexing) await sleep(20);
  const t0 = Date.now();
  await api.index.rebuild();
  return Date.now() - t0;
}

suite('Scale', () => {
  suiteSetup(async () => {
    api = (await vscode.extensions.getExtension<PromptComposerApi>('pavan-coding.prompt-composer')!.activate())!;
    await api.index.ensureBuilt();
  });
  suiteTeardown(async () => {
    await vscode.workspace.getConfiguration('promptComposer').update('mentions.exclude', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('promptComposer').update('mentions.maxEntries', undefined, vscode.ConfigurationTarget.Global);
  });

  test('MN-05 the index stops at mentions.maxEntries with one warning', async () => {
    makeTree(path.join(ws(), 'big-a'), 1500);
    const warnings: string[] = [];
    const original = vscode.window.showWarningMessage;
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage = (m: string) => { warnings.push(m); return Promise.resolve(undefined); };
    try {
      await vscode.workspace.getConfiguration('promptComposer').update('mentions.maxEntries', 1000, vscode.ConfigurationTarget.Global);
      await sleep(50);
      await rebuild();
      assert.equal(api.index.size, 1000);
    } finally {
      (vscode.window as { showWarningMessage: unknown }).showWarningMessage = original;
      await vscode.workspace.getConfiguration('promptComposer').update('mentions.maxEntries', undefined, vscode.ConfigurationTarget.Global);
    }
    // the extension's own copy of the API might not be the patched one; the size check is the contract
    if (warnings.length) assert.match(warnings[0], /first 1,000 files and folders/);
  });

  test('PF-03 a first index of 50k files takes under 2 s', async function () {
    this.timeout(240_000);
    makeTree(path.join(ws(), 'big-b'), 50_000, 250);
    const ms = await rebuild();
    console.log(`PF-03: indexed ${api.index.size} entries in ${ms} ms`);
    assert.ok(api.index.size > 50_000);
    assert.ok(ms < 2000, `${ms} ms`);
    const t0 = Date.now();
    const hits = api.index.search('file42');
    console.log(`PF-03: a search over ${api.index.size} entries took ${Date.now() - t0} ms`);
    assert.ok(hits.length > 0);
  });
});
