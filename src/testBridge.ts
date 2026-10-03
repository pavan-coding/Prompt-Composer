// End-to-end test bridge: only started when PROMPT_COMPOSER_E2E_PORT is set and the extension runs in
// development mode (Playwright launches VS Code with it). Listens on 127.0.0.1 only. It lets the test
// runner read extension state and run commands; it can't run arbitrary code.
import * as vscode from 'vscode';
import * as http from 'node:http';
import type { PromptComposerApi } from './extension';

export function startTestBridge(api: PromptComposerApi, port: number, log: vscode.LogOutputChannel): vscode.Disposable {
  const state = () => ({
    active: api.editors.activeDoc?.id,
    docs: api.editors.allDocs().map((d) => ({
      id: d.id, rel: d.rel, title: d.title, dirty: d.dirty, open: !!d.panel, preview: d.preview, current: d.current, saved: d.savedText,
    })),
    model: api.libraryView.model(),
    status: api.statusBar.texts(),
    swaps: api.untitled.swaps,
    indexSize: api.index.size,
    windowFocused: vscode.window.state.focused,
  });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        let out: unknown;
        const input = body ? JSON.parse(body) : {};
        if (req.method === 'GET' && req.url === '/state') out = state();
        else if (req.method === 'POST' && req.url === '/command') out = await vscode.commands.executeCommand(input.command, ...(input.args ?? []));
        else if (req.method === 'POST' && req.url === '/config') {
          await vscode.workspace.getConfiguration(input.section).update(input.key, input.value, vscode.ConfigurationTarget.Global);
          out = true;
        } else if (req.method === 'POST' && req.url === '/openFile') {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(input.path));
          out = true;
        } else if (req.method === 'POST' && req.url === '/focus') {
          const d = api.editors.activeDoc;
          if (d) api.editors.post(d, { type: 'focus', at: input.at });
          out = !!d;
        } else if (req.method === 'POST' && req.url === '/open') {
          out = !!(await api.editors.open(input.rel, { focus: true }));
        } else {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? null));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
      }
    });
  });
  server.listen(port, '127.0.0.1', () => log.info(`test bridge on 127.0.0.1:${port}`));
  return { dispose: () => server.close() };
}
