import { describe, expect, it } from 'vitest';
import { buildLibraryModel, dayLabel, searchItems, snippetOf, type LibraryItem } from '../../src/store/libraryModel';

const now = new Date(2026, 9, 3, 15, 0);
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d; };
let n = 0;
const item = (title: string, created: Date, extra: Partial<LibraryItem> = {}): LibraryItem => ({
  id: `p${n++}`, title, created, pinned: false, dirty: false, open: false, active: false, saved: true, tooltip: '', text: title, ...extra,
});

const items = [
  item('Refactor auth', at(0, 14, 15), { pinned: true, text: 'Refactor auth\nMove it into @src/server/token.ts' }),
  item('Add rate limit', at(0, 9, 2)),
  item('Fix flaky test', at(1, 18, 40)),
  item('Config order', at(2, 11, 20)),
  item('Split routes.ts', at(59, 8, 45), { text: 'Split routes.ts\n@src/server/routes.ts is 900 lines' }),
  item('Dark mode', at(35, 13, 15)),
];

describe('PN-03 default view: today only', () => {
  const m = buildLibraryModel(items, { query: '', show: 'today', now, folder: true });
  it("Pinned first, then today's prompts, newest first", () => {
    expect(m.show).toBe('today');
    expect(m.pinned.map((p) => p.title)).toEqual(['Refactor auth']);
    expect(m.months.map((x) => x.key)).toEqual(['2026-10']);
    expect(m.months[0].days.map((d) => d.label)).toEqual(['Today']);
    expect(m.months[0].days[0].prompts.map((p) => p.title)).toEqual(['Refactor auth', 'Add rate limit']);
  });
  it('says earlier prompts are hidden', () => {
    expect(m.hidden).toBe(true);
    expect(m.empty).toBe(false);
  });
  it('nothing hidden when every prompt is from today', () => {
    expect(buildLibraryModel(items.slice(0, 2), { query: '', show: 'today', now, folder: true }).hidden).toBe(false);
  });
});

describe('PN-02 This Month', () => {
  const m = buildLibraryModel(items, { query: '', show: 'month', now, folder: true });
  it('Pinned first, then the current month by day, newest first', () => {
    expect(m.pinned.map((p) => p.title)).toEqual(['Refactor auth']);
    expect(m.months.map((x) => x.key)).toEqual(['2026-10']);
    expect(m.months[0].days.map((d) => d.label)).toEqual(['Today', 'Yesterday', 'Thu, Oct 1']);
    expect(m.months[0].days[0].prompts.map((p) => p.title)).toEqual(['Refactor auth', 'Add rate limit']);
    expect(m.months[0].days[0].prompts[0].time).toBe('14:15');
  });
  it('PN-03 hides older months and says so', () => {
    expect(m.hidden).toBe(true);
    expect(m.months.some((x) => x.key !== '2026-10')).toBe(false);
  });
});

describe('PN-04 Show All Months', () => {
  it('lists older months with counts', () => {
    const m = buildLibraryModel(items, { query: '', show: 'all', now, folder: true });
    expect(m.months[0].key).toBe('2026-10');
    expect(m.months.map((x) => x.key)).toEqual(['2026-10', '2026-08']);
    expect(m.months[1].count).toBe(2);
    expect(m.hidden).toBe(false);
    expect(m.months[1].label).toBe('August 2026');
  });
});

describe('PN-05 search', () => {
  it('matches titles and text across all months, with a snippet, whatever the panel shows', () => {
    const m = buildLibraryModel(items, { query: 'routes', show: 'today', now, folder: true });
    expect(m.hidden).toBe(false);
    expect(m.found).toBe(1);
    expect(m.months.map((x) => x.key)).toEqual(['2026-08']);
    const p = m.months[0].days[0].prompts[0];
    expect(p.titleMatch).toEqual([6, 12]);
    expect(p.snippet?.[1]).toBe('routes');
    expect(m.pinned).toEqual([]);
  });
  it('finds @paths in the body', () => {
    const hits = searchItems(items, '@src/server/token');
    expect(hits.map((h) => h.item.title)).toEqual(['Refactor auth']);
    expect(hits[0].snippet?.join('')).toContain('@src/server/token.ts');
  });
  it('is case-insensitive and reports none found', () => {
    expect(buildLibraryModel(items, { query: 'DARK', show: 'today', now, folder: true }).found).toBe(1);
    expect(buildLibraryModel(items, { query: 'zzz', show: 'today', now, folder: true }).found).toBe(0);
  });
});

describe('PN-11 nothing yet', () => {
  it('today: says today is empty', () => {
    const m = buildLibraryModel([item('Yesterday', at(1, 9))], { query: '', show: 'today', now, folder: true });
    expect(m.empty).toBe(true);
    expect(m.hidden).toBe(true);
    expect(m.months).toEqual([]);
  });
  it('this month and all months: say the current month is empty', () => {
    for (const show of ['month', 'all'] as const) {
      const m = buildLibraryModel([item('Old', at(40, 9))], { query: '', show, now, folder: true });
      expect(m.empty).toBe(true);
      expect(m.hidden).toBe(show === 'month');
    }
  });
  it('an unsaved new prompt counts as today', () => {
    const m = buildLibraryModel([item('', at(0, 15), { saved: false })], { query: '', show: 'today', now, folder: true });
    expect(m.empty).toBe(false);
    expect(m.months[0].days[0].prompts[0].title).toBe('Untitled prompt');
  });
});

describe('PN-13 speed', () => {
  it('searches 5,000 prompts in under 30 ms', () => {
    const many: LibraryItem[] = [];
    for (let i = 0; i < 5000; i++) {
      const lines = [`Prompt number ${i}`, ...Array.from({ length: 30 }, (_, j) => `line ${j} of prompt ${i} mentions @src/file${j}.ts and some words`)];
      many.push(item(`Prompt number ${i}`, at(i % 90, i % 24, i % 60), { text: lines.join('\n') }));
    }
    buildLibraryModel(many, { query: 'warm up', show: 'today', now, folder: true });
    const t0 = performance.now();
    const m = buildLibraryModel(many, { query: 'file29.ts', show: 'today', now, folder: true });
    const ms = performance.now() - t0;
    expect(m.found).toBe(5000);
    expect(ms).toBeLessThan(30);
    console.log(`PN-13: search over 5,000 prompts took ${ms.toFixed(1)} ms`);
  });
});

describe('labels', () => {
  it('day labels', () => {
    expect(dayLabel(at(0, 1), now)).toBe('Today');
    expect(dayLabel(at(1, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(2, 1), now)).toBe('Thu, Oct 1');
  });
  it('snippets trim long lines', () => {
    const s = snippetOf('a'.repeat(40) + 'MATCH' + 'b'.repeat(80), 40, 5);
    expect(s[0].startsWith('…')).toBe(true);
    expect(s[1]).toBe('MATCH');
    expect(s[2].endsWith('…')).toBe(true);
  });
});
