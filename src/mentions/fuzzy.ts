// Quick Open-style matching for the @ picker (pure; runs on the extension host).
// After the first letter, each query letter must continue the previous match or start a word
// (after / . _ - space, or a camelCase hump). Names rank above paths; shallow above deep.
import type { MentionItem } from '../common/protocol';

export interface IndexEntry {
  /** Workspace-relative path with "/" separators, no trailing slash. */
  path: string;
  /** path.toLowerCase(), precomputed. */
  lower: string;
  /** Where the name starts in `path`. */
  nameAt: number;
  kind: 'file' | 'dir';
  depth: number;
  link?: string;
  broken?: boolean;
  via?: { name: string; link: string };
}

interface Match { score: number; pos: number[] }

const SEPARATORS = '/._- ';

/** Fuzzy-match lower-case `q` against `orig` (its lower-case form is `low`). */
export function fuzzy(q: string, orig: string, low = orig.toLowerCase()): Match | null {
  if (!q) return { score: 0, pos: [] };
  // quick reject: every letter must appear in order
  for (let i = 0, j = 0; i < q.length; i++, j++) {
    j = low.indexOf(q[i], j);
    if (j < 0) return null;
  }
  const isStart = (j: number) => j === 0 || SEPARATORS.includes(low[j - 1]) || (orig[j] !== low[j] && orig[j - 1] === low[j - 1]);
  const pos: number[] = [];
  let best: Match | null = null;
  let budget = 2000; // backtracking steps; plenty for real names, a hard stop for pathological ones
  const go = (qi: number, from: number, score: number): void => {
    if (--budget < 0) return;
    if (best && best.score >= score + (q.length - qi) * 14) return;
    if (qi === q.length) {
      if (!best || score > best.score) best = { score, pos: pos.slice() };
      return;
    }
    for (let j = low.indexOf(q[qi], from); j >= 0; j = low.indexOf(q[qi], j + 1)) {
      const consecutive = qi > 0 && j === pos[qi - 1] + 1;
      const start = isStart(j);
      if (qi > 0 && !consecutive && !start) continue;
      pos.push(j);
      go(qi + 1, j + 1, score + 1 + (consecutive ? 5 : 0) + (start ? 8 : 0));
      pos.pop();
    }
  };
  go(0, 0, 0);
  if (!best) return null;
  const m = best as Match;
  if (low.startsWith(q)) m.score += 10;
  m.score -= (low.length - q.length) * 0.05;
  return m;
}

function item(e: IndexEntry, match: number[], group?: string): MentionItem {
  return {
    path: e.path, name: e.path.slice(e.nameAt), kind: e.kind, link: e.link, via: e.via, broken: e.broken, match, group,
  };
}

/**
 * Search the index. Empty query: recent files first, then shallow entries. "src/ser" lists what's
 * under src/ fuzzy-matched on "ser". Otherwise names first, then whole paths.
 */
export function searchIndex(entries: IndexEntry[], query: string, recent: string[], limit = 50): MentionItem[] {
  const q = query.toLowerCase().replace(/^@/, '').replace(/^"/, '');
  if (!q) {
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const out: MentionItem[] = [];
    const seen = new Set<string>();
    for (const p of recent) {
      const e = byPath.get(p);
      if (e && !seen.has(p)) { out.push(item(e, [], 'Recent')); seen.add(p); }
      if (out.length >= 8) break;
    }
    const rest = entries.filter((e) => e.depth <= 1 && !seen.has(e.path))
      .sort((a, b) => a.depth - b.depth || (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'dir' ? -1 : 1));
    for (const e of rest) {
      if (out.length >= limit) break;
      out.push(item(e, [], 'Files and folders'));
    }
    return out;
  }

  const recentSet = new Set(recent);
  const slash = q.lastIndexOf('/');
  if (slash >= 0) {
    const base = q.slice(0, slash + 1);
    const term = q.slice(slash + 1);
    const folder = base.slice(0, -1).split('/').pop() || base;
    const scored: { e: IndexEntry; score: number; pos: number[] }[] = [];
    for (const e of entries) {
      if (!e.lower.startsWith(base) || e.lower.length === base.length) continue;
      const rest = e.path.slice(base.length);
      const depth = rest.split('/').length - 1;
      if (!term) {
        if (depth === 0) scored.push({ e, score: 100 + (e.kind === 'dir' ? 1 : 0), pos: [] });
        continue;
      }
      const m = fuzzy(term, rest, e.lower.slice(base.length));
      if (m) scored.push({ e, score: m.score - depth * 3, pos: m.pos.map((p) => p + base.length) });
    }
    if (scored.length) {
      scored.sort((a, b) => b.score - a.score || a.e.path.localeCompare(b.e.path));
      return scored.slice(0, limit).map((s) => item(s.e, s.pos, `In ${folder}`));
    }
  }

  const scored: { e: IndexEntry; score: number; pos: number[] }[] = [];
  for (const e of entries) {
    const lowName = e.lower.slice(e.nameAt);
    const mn = fuzzy(q, e.path.slice(e.nameAt), lowName);
    let r: { e: IndexEntry; score: number; pos: number[] } | null = null;
    if (mn) {
      // the query is the whole name (or the name without its extension): the best kind of match
      const stem = lowName.includes('.') ? lowName.slice(0, lowName.lastIndexOf('.')) : lowName;
      const exact = lowName === q || stem === q ? 20 : 0;
      r = { e, pos: mn.pos.map((p) => p + e.nameAt), score: 1000 + mn.score + exact - e.depth * 0.5 };
    }
    else {
      const mp = fuzzy(q, e.path, e.lower);
      if (mp) r = { e, pos: mp.pos, score: mp.score - e.depth };
    }
    if (r) {
      if (recentSet.has(e.path)) r.score += 30;
      scored.push(r);
    }
  }
  scored.sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length || a.e.path.localeCompare(b.e.path));
  return scored.slice(0, limit).map((s) => item(s.e, s.pos));
}
