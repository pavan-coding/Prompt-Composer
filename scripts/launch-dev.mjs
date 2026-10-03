// `npm run dev`: build, then open a VS Code window with this extension loaded on sample-workspace/ws,
// without the debugger. (Starting it with F5 can crash the window: VS Code bug microsoft/vscode#336233.)
// Extra arguments are passed to VS Code, e.g. `npm run dev -- --disable-extensions` or another folder path.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
await import('./prepare-dev.mjs');
const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('-')) ?? join(root, 'sample-workspace', 'ws');
const rest = args.filter((a) => a !== folder);
if (!existsSync(folder)) throw new Error(`no such folder: ${folder}`);
const argv = [`--extensionDevelopmentPath=${root}`, '--new-window', ...rest, folder];
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(VSCODE_|ELECTRON_RUN_AS_NODE)/i.test(k)) delete env[k];

/** VS Code's CLI is Code.exe running cli.js as Node; find them from the `code` command on PATH. */
function findCli() {
  if (process.env.CODE_EXE) return locate(process.env.CODE_EXE);
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const shim = join(dir, process.platform === 'win32' ? 'code.cmd' : 'code');
    if (existsSync(shim) && process.platform === 'win32') return locate(join(dir, '..', 'Code.exe'));
  }
  return undefined;
}
function locate(exe) {
  if (!existsSync(exe)) return undefined;
  const base = dirname(exe);
  const cliJs = [join(base, 'resources', 'app', 'out', 'cli.js'), ...readdirSync(base).map((d) => join(base, d, 'resources', 'app', 'out', 'cli.js'))].find((f) => existsSync(f));
  return cliJs ? { exe, cliJs } : undefined;
}

const cli = findCli();
const child = cli
  ? spawn(cli.exe, [cli.cliJs, ...argv], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', detached: true })
  : spawn('code', argv, { env, stdio: 'inherit', detached: true });
child.on('error', (e) => console.error(`Couldn't start VS Code: ${e.message}. Is the "code" command on PATH? (or set CODE_EXE)`));
child.unref();
console.log(`Opening VS Code with Prompt Composer on ${folder}`);
