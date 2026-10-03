import { describe, expect, it } from 'vitest';
import {
  createdFromName, dayKey, extForMime, isPromptFileName, monthKey, pastedImageBase, promptFileName, safeImageName, slugify, uniqueName,
} from '../../src/common/naming';

describe('ST-04 file names', () => {
  it('DD-HHmm-<slug>.md from the creation time', () => {
    const d = new Date(2026, 9, 3, 14, 5);
    expect(promptFileName(d, 'refactor-auth')).toBe('03-1405-refactor-auth.md');
    expect(monthKey(d)).toBe('2026-10');
    expect(dayKey(d)).toBe('2026-10-03');
  });
});

describe('ST-05 slugs', () => {
  it('lower case, words joined by -, trimmed', () => {
    expect(slugify('Refactor auth token refresh!')).toBe('refactor-auth-token-refresh');
    expect(slugify('  --Hello,   World--  ')).toBe('hello-world');
    expect(slugify('@src/server/auth.ts: fix')).toBe('src-server-auth-ts-fix');
  });
  it('keeps letters and digits of any script', () => {
    expect(slugify('Ünïcode café 日本語 テスト 2')).toBe('ünïcode-café-日本語-テスト-2');
    expect(slugify('తెలుగు శీర్షిక')).not.toBe('untitled');
  });
  it('is at most 48 characters, never ending in -', () => {
    const s = slugify('a'.repeat(47) + ' bcdef');
    expect(Array.from(s).length).toBeLessThanOrEqual(48);
    expect(s.endsWith('-')).toBe(false);
  });
  it('empty → untitled', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('!!! ???')).toBe('untitled');
  });
});

describe('ST-06 numbering', () => {
  it('adds -2, -3 for the same minute and title', () => {
    const d = new Date(2026, 9, 3, 9, 2);
    expect(promptFileName(d, 'x', 2)).toBe('03-0902-x-2.md');
    expect(promptFileName(d, 'x', 3)).toBe('03-0902-x-3.md');
  });
});

describe('ST-08 temporary files are not prompts', () => {
  it('only visible .md files count', () => {
    expect(isPromptFileName('03-1415-x.md')).toBe(true);
    expect(isPromptFileName('notes.MD')).toBe(true);
    expect(isPromptFileName('.03-1415-x.md.ab12.tmp')).toBe(false);
    expect(isPromptFileName('.hidden.md')).toBe(false);
    expect(isPromptFileName('image.png')).toBe(false);
  });
});

describe('ST-10 created time from the name', () => {
  it('reads month folder + DD-HHmm', () => {
    expect(createdFromName('2026-10', '03-1415-x.md')).toEqual(new Date(2026, 9, 3, 14, 15));
  });
  it('rejects names that do not follow the pattern', () => {
    expect(createdFromName('2026-10', 'notes.md')).toBeUndefined();
    expect(createdFromName('2026-13', '03-1415-x.md')).toBeUndefined();
    expect(createdFromName('2026-02', '31-1415-x.md')).toBeUndefined();
    expect(createdFromName('2026-10', '03-2575-x.md')).toBeUndefined();
  });
});

describe('IM image names', () => {
  it('pasted images are named by date and time', () => {
    expect(pastedImageBase(new Date(2026, 9, 3, 14, 16, 2))).toBe('2026-10-03-141602');
  });
  it('dropped files keep a safe version of their name', () => {
    expect(safeImageName('My Shot (1).PNG')).toEqual({ base: 'My-Shot-1', ext: 'png' });
    expect(safeImageName('photo.jpeg')).toEqual({ base: 'photo', ext: 'jpg' });
    expect(safeImageName('../../evil.png').base).toBe('evil');
  });
  it('MIME types map to extensions', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/svg+xml')).toBe('svg');
  });
  it('IM-02 never overwrites: -1, -2…', () => {
    const taken = new Set(['a.png', 'a-1.png']);
    expect(uniqueName('a', 'png', (n) => taken.has(n))).toBe('a-2.png');
    expect(uniqueName('b', 'png', (n) => taken.has(n))).toBe('b.png');
  });
});
