import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { rebaseMentions, rebasePath } from '../../src/claude/claudePaths';

const root = '/work/app';
const existing = new Set([
  '/work/app/src/server/auth.ts',
  '/work/app/src/config',
  '/work/app/README.md',
  '/work/app/docs/my notes.md',
  '/work/app/.prompt-composer/images/shot.png',
]);
const exists = (abs: string) => existing.has(abs);

describe('CL-04 @paths for Claude Code running in another folder', () => {
  it('leaves the prompt alone when Claude runs in the workspace folder', () => {
    const md = 'See @src/server/auth.ts';
    expect(rebaseMentions(md, root, '/work/app/', exists, path.posix)).toBe(md);
  });

  it('makes paths inside Claude\'s folder relative to it, and the rest absolute', () => {
    const md = 'See @src/server/auth.ts and @README.md.\n(@src/config/) and @"docs/my notes.md"';
    expect(rebaseMentions(md, root, '/work/app/src', exists, path.posix)).toBe(
      'See @server/auth.ts and @/work/app/README.md.\n(@config/) and @"/work/app/docs/my notes.md"',
    );
  });

  it('works from a folder above the workspace too', () => {
    expect(rebaseMentions('@src/server/auth.ts', root, '/work', exists, path.posix)).toBe('@app/src/server/auth.ts');
  });

  it('keeps @words that are not files, emails and code as written', () => {
    const md = 'ask @team, mail a@b.com, `@src/server/auth.ts`\n\n```\n@README.md\n```\nthen @README.md';
    expect(rebaseMentions(md, root, '/work/app/src', exists, path.posix)).toBe(
      'ask @team, mail a@b.com, `@src/server/auth.ts`\n\n```\n@README.md\n```\nthen @/work/app/README.md',
    );
  });

  it('turns image @paths from Copy as Prompt around like any other path', () => {
    expect(rebaseMentions('@.prompt-composer/images/shot.png', root, '/elsewhere', exists, path.posix))
      .toBe('@/work/app/.prompt-composer/images/shot.png');
  });

  it('writes forward slashes on Windows', () => {
    const win = new Set(['C:\\work\\app\\src\\server\\auth.ts', 'C:\\work\\app\\README.md']);
    const winExists = (abs: string) => win.has(abs);
    expect(rebasePath('src/server/auth.ts', 'C:\\work\\app', 'C:\\work\\app\\src', winExists, path.win32)).toBe('server/auth.ts');
    expect(rebasePath('README.md', 'C:\\work\\app', 'D:\\other', winExists, path.win32)).toBe('C:/work/app/README.md');
  });

  it('never touches absolute paths', () => {
    expect(rebasePath('/etc/hosts', root, '/work/app/src', () => true, path.posix)).toBeUndefined();
  });
});
