// Builds what the Prompts panel shows: Pinned, then months → days → prompts, or search results.
// Pure (no VS Code API), so it's unit-tested directly.
import type { DayGroup, LibraryModel, MonthGroup, PromptRow } from '../common/protocol';
import { dayKey, monthKey, timeOf } from '../common/naming';

export interface LibraryItem {
  id: string;
  title: string;
  created: Date;
  pinned: boolean;
  dirty: boolean;
  open: boolean;
  active: boolean;
  saved: boolean;
  tooltip: string;
  /** Plain text of the prompt, one line per block line (searchLines joined by "\n"), for search and snippets. */
  text: string;
  /** text.toLowerCase(), computed once per prompt (searching thousands of prompts stays fast). */
  lower?: string;
}

export interface ModelOptions {
  query: string;
  showAllMonths: boolean;
  now: Date;
  folder: boolean;
  locale?: string;
}

const UNTITLED = 'Untitled prompt';

// Intl formatters are slow to create and fast to reuse (thousands of rows per render).
const FORMATS = {
  day: { weekday: 'short', month: 'short', day: 'numeric' },
  date: { month: 'short', day: 'numeric' },
  month: { month: 'long', year: 'numeric' },
} as const;
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string | undefined, kind: keyof typeof FORMATS): Intl.DateTimeFormat {
  const key = `${locale ?? 'en-US'}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale ?? 'en-US', FORMATS[kind]); } catch { f = new Intl.DateTimeFormat('en-US', FORMATS[kind]); }
    formatters.set(key, f);
  }
  return f;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", else "Thu, Oct 1". */
export function dayLabel(d: Date, now: Date, locale?: string): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmt(locale, 'day').format(d);
}

/** A short piece of `line` around the match: up to 22 characters before and 48 after. */
export function snippetOf(line: string, index: number, length: number): [string, string, string] {
  const from = Math.max(0, index - 22);
  const to = Math.min(line.length, index + length + 48);
  return [
    (from > 0 ? '…' : '') + line.slice(from, index),
    line.slice(index, index + length),
    line.slice(index + length, to) + (to < line.length ? '…' : ''),
  ];
}

interface Hit { item: LibraryItem; titleAt: number; snippet?: [string, string, string] }

/** Case-insensitive substring search over titles and text. */
export function searchItems(items: LibraryItem[], query: string): Hit[] {
  const q = query.trim().toLowerCase();
  const hits: Hit[] = [];
  for (const item of items) {
    const title = item.title || UNTITLED;
    const titleAt = title.toLowerCase().indexOf(q);
    const text = item.text;
    const lower = item.lower ?? (item.lower = text.toLowerCase());
    let snippet: [string, string, string] | undefined;
    // The body: skip the line the title came from, the title row already shows it.
    const firstEnd = text.indexOf('\n');
    const from = item.title && text.slice(0, firstEnd < 0 ? text.length : firstEnd) === item.title ? (firstEnd < 0 ? text.length : firstEnd + 1) : 0;
    const at = lower.indexOf(q, from);
    if (at >= 0) {
      if (lower.length === text.length) {
        const start = lower.lastIndexOf('\n', at - 1) + 1;
        const end = lower.indexOf('\n', at);
        snippet = snippetOf(text.slice(start, end < 0 ? text.length : end), at - start, q.length);
      } else {
        // lower-casing changed the length (rare letters): find the line the slow way
        for (const line of text.slice(from).split('\n')) {
          const i = line.toLowerCase().indexOf(q);
          if (i >= 0) { snippet = snippetOf(line, i, q.length); break; }
        }
      }
    }
    if (titleAt >= 0 || snippet) hits.push({ item, titleAt, snippet });
  }
  return hits;
}

function row(item: LibraryItem, locale: string | undefined, hit?: Hit, qlen = 0): PromptRow {
  return {
    id: item.id,
    title: item.title || UNTITLED,
    time: timeOf(item.created),
    date: fmt(locale, 'date').format(item.created),
    pinned: item.pinned,
    dirty: item.dirty,
    open: item.open,
    active: item.active,
    saved: item.saved,
    tooltip: item.tooltip,
    snippet: hit?.snippet,
    titleMatch: hit && hit.titleAt >= 0 ? [hit.titleAt, hit.titleAt + qlen] : undefined,
  };
}

export function buildLibraryModel(items: LibraryItem[], opts: ModelOptions): LibraryModel {
  const { now, locale } = opts;
  const query = opts.query.trim();
  const sorted = items.slice().sort((a, b) => b.created.getTime() - a.created.getTime() || a.id.localeCompare(b.id));
  const thisMonth = monthKey(now);
  const model: LibraryModel = {
    folder: opts.folder,
    total: items.length,
    query,
    found: 0,
    pinned: [],
    months: [],
    hiddenOlder: false,
    showAllMonths: opts.showAllMonths,
    emptyCurrentMonth: false,
  };

  let listed: { item: LibraryItem; hit?: Hit }[];
  if (query) {
    listed = searchItems(sorted, query).map((hit) => ({ item: hit.item, hit }));
    model.found = listed.length;
  } else {
    listed = sorted.map((item) => ({ item }));
    model.pinned = sorted.filter((i) => i.pinned).map((i) => row(i, locale));
  }

  const months = new Map<string, MonthGroup>();
  const days = new Map<string, DayGroup>();
  for (const { item, hit } of listed) {
    const mk = monthKey(item.created);
    if (!query && !opts.showAllMonths && mk !== thisMonth) { model.hiddenOlder = true; continue; }
    let month = months.get(mk);
    if (!month) {
      month = {
        key: mk,
        label: fmt(locale, 'month').format(item.created),
        count: 0,
        current: mk === thisMonth,
        days: [],
      };
      months.set(mk, month);
    }
    month.count++;
    const dk = dayKey(item.created);
    let day = days.get(dk);
    if (!day) {
      day = { key: dk, label: dayLabel(item.created, now, locale), prompts: [] };
      days.set(dk, day);
      month.days.push(day);
    }
    day.prompts.push(row(item, locale, hit, query.length));
  }
  model.months = [...months.values()];
  model.emptyCurrentMonth = !query && !months.has(thisMonth);
  return model;
}
