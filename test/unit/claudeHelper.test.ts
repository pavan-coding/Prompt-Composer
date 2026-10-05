// The claude-prompt-composer helper (claude-code/) run as Claude Code runs it, with a stand-in `code` that plays
// VS Code + Prompt Composer: it records its arguments, "edits" the prompt and closes the tab (.done).
// setsid keeps the helper away from this terminal: it reads keys from /dev/tty.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const helper = path.resolve('claude-code/claude-prompt-composer');
let tmp = '';
let cwd = '';
let claude = '';
let registry = '';
const sleepers: ChildProcess[] = [];

const CODE_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB_DIR/code.args"
[ "$CODE_MODE" = fail ] && exit 3
[ "$CODE_MODE" = slow ] && sleep 2
for a; do f=$a; done
cat "$(dirname "$f")/.cwd" > "$STUB_DIR/cwd.seen"
printf 'edited:%s' "$(cat "$f")" > "$f"
[ "$CODE_MODE" = nodone ] || : > "$(dirname "$f")/.done"
`;

function stub(name: string, body: string): void {
  fs.writeFileSync(path.join(tmp, 'bin', name), body, { mode: 0o755 });
}

function run(file: string, env: Record<string, string> = {}) {
  return spawnSync('setsid', ['-w', helper, file], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
    env: { PATH: `${path.join(tmp, 'bin')}:/usr/bin:/bin`, HOME: tmp, XDG_CACHE_HOME: path.join(tmp, 'cache'), STUB_DIR: tmp, EDITOR: 'fake-editor', ...env },
  });
}

function claudeFile(text: string): string {
  const file = path.join(claude, 'claude-prompt-8f3a.md');
  fs.writeFileSync(file, text);
  return file;
}

const codeArgs = () => fs.readFileSync(path.join(tmp, 'code.args'), 'utf8').trimEnd().split('\n');
const promptPath = () => path.join(claude, 'claude-prompt-8f3a', 'Claude - app.prompt');

/** A registry entry for a live process (a sleeper), like a VS Code window's extension host. */
function windowEntry(root: string, open = root, pid?: number): number {
  if (pid === undefined) {
    const s = spawn('sleep', ['60'], { stdio: 'ignore' });
    sleepers.push(s);
    pid = s.pid!;
  }
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, String(pid)), `${root}\n${open}\n`);
  return pid;
}

describe.skipIf(process.platform !== 'linux')('CL-07 the claude-prompt-composer helper', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-helper-'));
    cwd = path.join(tmp, 'project', 'app');
    claude = path.join(tmp, 'claude');
    registry = path.join(tmp, 'cache', 'prompt-composer', 'windows');
    for (const d of [cwd, claude, path.join(tmp, 'bin')]) fs.mkdirSync(d, { recursive: true });
    stub('code', CODE_STUB);
    stub('fake-editor', `#!/usr/bin/env bash\nprintf '%s' "$1" > "$STUB_DIR/fallback.seen"\n`);
  });
  afterEach(() => {
    for (const s of sleepers.splice(0)) s.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("opens the prompt as a .prompt, hands back what the editor wrote and cleans up", () => {
    const file = claudeFile('Fix the login bug\n');
    const r = run(file);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('edited:Fix the login bug');
    expect(codeArgs()).toEqual(['--wait', cwd, promptPath()]);
    expect(fs.readFileSync(path.join(tmp, 'cwd.seen'), 'utf8')).toBe(cwd);
    expect(fs.existsSync(path.join(claude, 'claude-prompt-8f3a'))).toBe(false);
  });

  it("leaves Claude's last response out of the editor", () => {
    const file = claudeFile(
      "# ─── Claude's last response (for reference; removed on save) ───\n# Done.\n" +
      '# ─── Write your reply below this line ──────────\n\nMy reply\n',
    );
    expect(run(file).status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('edited:My reply');
  });

  it("picks the window open on Claude's folder or above it, and drops windows that are gone", () => {
    windowEntry('/elsewhere');
    windowEntry(path.join(tmp, 'project'));
    windowEntry(tmp);
    windowEntry('/gone', '/gone', 999_999_9);
    expect(run(claudeFile('x\n')).status).toBe(0);
    expect(codeArgs()[1]).toBe(path.join(tmp, 'project'));
    expect(fs.existsSync(path.join(registry, '9999999'))).toBe(false);
  });

  it('otherwise uses the window used last (its workspace file when it has one)', () => {
    const older = windowEntry('/elsewhere/a');
    windowEntry('/elsewhere/b', '/elsewhere/b.code-workspace');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(registry, String(older)), past, past);
    expect(run(claudeFile('x\n')).status).toBe(0);
    expect(codeArgs()[1]).toBe('/elsewhere/b.code-workspace');
  });

  it('takes the file as it is when no .done comes (older Prompt Composer, plain text editor)', () => {
    const file = claudeFile('Draft\n');
    expect(run(file, { CODE_MODE: 'nodone' }).status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('edited:Draft');
  });

  it("fails without touching Claude's file when VS Code can't open it", () => {
    const file = claudeFile('Keep me\n');
    expect(run(file, { CODE_MODE: 'fail' }).status).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('Keep me\n');
    expect(fs.existsSync(path.join(claude, 'claude-prompt-8f3a'))).toBe(false);
  });

  /** Run in a terminal of its own (script's pty) and press `keys` while the prompt is open in "VS Code". */
  function runInTerminal(file: string, keys: string): Promise<number | null> {
    const env = { PATH: `${path.join(tmp, 'bin')}:/usr/bin:/bin`, HOME: tmp, XDG_CACHE_HOME: path.join(tmp, 'cache'), STUB_DIR: tmp, CODE_MODE: 'slow' };
    const child = spawn('script', ['-qec', `'${helper}' '${file}'`, '/dev/null'], { cwd, env, stdio: ['pipe', 'ignore', 'ignore'] });
    setTimeout(() => child.stdin.write(keys), 700);
    return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  }

  it("Esc or Ctrl+C in the terminal cancels: Claude's file stays as it was", async () => {
    for (const key of ['\x1b', '\x03']) {
      const file = claudeFile('Keep me\n');
      expect(await runInTerminal(file, key)).toBe(0);
      expect(fs.readFileSync(file, 'utf8')).toBe('Keep me\n');
      expect(fs.existsSync(path.join(claude, 'claude-prompt-8f3a'))).toBe(false);
    }
  });

  it("an arrow key isn't Esc: the prompt still comes back", async () => {
    const file = claudeFile('Draft\n');
    expect(await runInTerminal(file, '\x1b[A')).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('edited:Draft');
  });

  it('sends any other file to $EDITOR', () => {
    const file = path.join(tmp, 'COMMIT_EDITMSG');
    fs.writeFileSync(file, 'msg\n');
    expect(run(file).status).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'fallback.seen'), 'utf8')).toBe(file);
    expect(fs.existsSync(path.join(tmp, 'code.args'))).toBe(false);
  });
});
