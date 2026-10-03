import { describe, expect, it } from 'vitest';
import { fuzzy, searchIndex, type IndexEntry } from '../../src/mentions/fuzzy';

const entry = (path: string, kind: 'file' | 'dir' = 'file', extra: Partial<IndexEntry> = {}): IndexEntry => ({
  path, lower: path.toLowerCase(), nameAt: path.lastIndexOf('/') + 1, kind, depth: path.split('/').length - 1, ...extra,
});

const entries = [
  entry('src', 'dir'), entry('src/server', 'dir'), entry('src/client', 'dir'), entry('docs', 'dir'),
  entry('src/server/auth.ts'), entry('src/server/routes.ts'), entry('src/server/index.ts'), entry('src/client/index.ts'),
  entry('src/client/hooks/useSession.ts'), entry('docs/authoring.md'), entry('README.md'), entry('package.json'),
  entry('shared', 'dir', { link: '../shared-libs/common' }), entry('shared/utils/date.ts', 'file', { via: { name: 'shared', link: '../shared-libs/common' } }),
];

describe('MN-06 fuzzy matching', () => {
  it('letters must be consecutive or start a word', () => {
    expect(fuzzy('ust', 'useSession.ts')).toBeTruthy();       // u + S(ession hump) + t? → "ust" consecutive "us" then "t" at word start ".ts"
    expect(fuzzy('uses', 'useSession.ts')).toBeTruthy();
    expect(fuzzy('xyz', 'useSession.ts')).toBeNull();
    expect(fuzzy('ae', 'auth.ts')).toBeNull();                 // "e" isn't at a word start or after "a"
  });
  it('names rank above path-only matches; shallow above deep', () => {
    const hits = searchIndex(entries, 'auth', []);
    expect(hits.map((h) => h.path).slice(0, 2)).toEqual(['src/server/auth.ts', 'docs/authoring.md']);
  });
  it('marks matched letters for highlighting', () => {
    const [hit] = searchIndex(entries, 'routes', []);
    expect(hit.path).toBe('src/server/routes.ts');
    expect(hit.match).toEqual([11, 12, 13, 14, 15, 16]);
  });
  it('a path query lists what is inside that folder', () => {
    const hits = searchIndex(entries, 'src/', []);
    expect(hits.map((h) => h.path).sort()).toEqual(['src/client', 'src/server']);
    expect(hits[0].group).toBe('In src');
    const deeper = searchIndex(entries, 'src/server/ro', []);
    expect(deeper[0].path).toBe('src/server/routes.ts');
  });
  it('symlink details travel with results', () => {
    const [link] = searchIndex(entries, 'shared', []);
    expect(link).toMatchObject({ path: 'shared', kind: 'dir', link: '../shared-libs/common' });
    const [inside] = searchIndex(entries, 'date', []);
    expect(inside.via?.name).toBe('shared');
  });
});

describe('MN-07 empty query', () => {
  it('shows recently opened files first, then top-level entries', () => {
    const hits = searchIndex(entries, '', ['src/server/routes.ts', 'README.md', 'gone.ts']);
    expect(hits.slice(0, 2).map((h) => [h.path, h.group])).toEqual([['src/server/routes.ts', 'Recent'], ['README.md', 'Recent']]);
    expect(hits[2].group).toBe('Files and folders');
    expect(hits.every((h) => h.path !== 'gone.ts')).toBe(true);
  });
  it('recent files get a boost in normal searches too', () => {
    const plain = searchIndex(entries, 'index', []);
    const boosted = searchIndex(entries, 'index', ['src/server/index.ts']);
    expect(plain[0].path).toBe('src/client/index.ts'); // a tie: alphabetical
    expect(boosted[0].path).toBe('src/server/index.ts');
  });
});

describe('MN-12 speed', () => {
  it('searches 100k entries in under 30 ms', () => {
    const big: IndexEntry[] = [];
    const words = ['alpha', 'beta', 'gamma', 'delta', 'service', 'handler', 'model', 'view', 'controller', 'utils'];
    for (let i = 0; i < 100_000; i++) {
      const p = `pkg${i % 100}/${words[i % 10]}/${words[(i * 7) % 10]}${i}.ts`;
      big.push(entry(p));
    }
    searchIndex(big, 'warm', []);
    for (const q of ['handler', 'svc', 'gammadelta', 'pkg42/mo']) {
      const t0 = performance.now();
      searchIndex(big, q, []);
      const ms = performance.now() - t0;
      console.log(`MN-12: "${q}" over 100k entries took ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(30);
    }
  });
});
