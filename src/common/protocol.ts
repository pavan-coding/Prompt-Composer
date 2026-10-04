// Messages between the extension host and the two webviews. Type-only; shared by both sides.

/** What the host knows about one @mention path. */
export interface MentionInfo {
  exists: boolean;
  kind: 'file' | 'dir';
  /** Symlink target as written on disk, when the path itself is a link. */
  link?: string;
  /** The nearest symlinked folder above the path: its name and target. */
  via?: { name: string; link: string };
  /** Webview URL for image files, used for hover thumbnails. */
  thumb?: string;
}
export type MentionMap = Record<string, MentionInfo>;

/** One row of @ picker results. */
export interface MentionItem {
  path: string;        // "src/server/auth.ts", folders without trailing slash
  name: string;
  kind: 'file' | 'dir';
  link?: string;
  via?: { name: string; link: string };
  broken?: boolean;
  /** Indexes into `path` of matched letters. */
  match: number[];
  group?: string;
}

export interface EditorSettings {
  colors: 'theme' | 'tiptap';
  mentionStyle: 'icon' | 'at' | 'plain';
  toolbar: 'mid' | 'full' | 'off';
  width: 'full' | 'readable';
  caret: 'smooth' | 'native';
  lineNumbers: boolean;
  /** VS Code's editor.cursorBlinking ("blink" | "smooth" | "phase" | "expand" | "solid"); expand when unset. */
  cursorBlinking: string;
}

/** What a prompt tab remembers across reloads (webview state). */
export interface PersistState {
  docId: string;
  rel?: string;
  created: number;
  /** The editor's Markdown at the time (unsaved changes survive a reload). */
  markdown?: string;
}

export interface EditorInit {
  docId: string;
  state: PersistState;
  markdown: string;
  mentions: MentionMap;
  settings: EditorSettings;
  /** Webview URL of the prompt's folder, ending in "/": relative image links resolve against it. */
  promptDirUrl: string;
  /** Webview URL of the workspace folder, ending in "/". */
  workspaceUrl: string;
  /** file: URI of the workspace folder, ending in "/" (to turn dropped Explorer files into @paths). */
  workspaceFileUri: string;
  /** Focus the editor and put the caret at the end once loaded. */
  focus: boolean;
  isMac: boolean;
}

export interface EditorStats { mentions: number; broken: number; images: number; words: number; chars: number }

export type HostToEditor =
  | { type: 'init'; init: EditorInit }
  | { type: 'settings'; settings: EditorSettings }
  | { type: 'flush'; requestId: number }
  | { type: 'reload'; markdown: string; mentions: MentionMap }
  | { type: 'mentionResults'; seq: number; items: MentionItem[]; indexing: boolean }
  | { type: 'mentionInfo'; mentions: MentionMap }
  | { type: 'imageSaved'; requestId: number; path?: string; error?: string }
  | { type: 'insertImages'; paths: string[] }
  | { type: 'linkResult'; requestId: number; href: string | null }
  | { type: 'focus'; at?: 'start' | 'end' }
  | { type: 'goToBroken' }
  | { type: 'state'; state: PersistState }
  | { type: 'command'; name: 'link' };

export type EditorToHost =
  | { type: 'ready' }
  | { type: 'changed'; markdown: string; title: string; stats: EditorStats }
  | { type: 'content'; requestId: number; markdown: string; title: string }
  | { type: 'mentionQuery'; seq: number; query: string }
  | { type: 'resolveMentions'; paths: string[] }
  | { type: 'saveImage'; requestId: number; name?: string; mime: string; bytes: Uint8Array; origin: 'paste' | 'drop' }
  | { type: 'pickImage' }
  | { type: 'askLink'; requestId: number; current: string }
  | { type: 'openLink'; href: string }
  | { type: 'openMention'; path: string }
  | { type: 'focusChanged'; focused: boolean }
  | { type: 'noBroken' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

// ---------------------------------------------------------------- library panel

export interface PromptRow {
  id: string;            // saved: "2026-10/03-1415-x.prompt"; unsaved: "doc:<docId>"
  title: string;
  time: string;          // "14:15"
  date: string;          // "Oct 3"
  pinned: boolean;
  dirty: boolean;
  open: boolean;
  active: boolean;
  saved: boolean;
  tooltip: string;
  /** Search hit inside the body: text before, the match, text after. */
  snippet?: [string, string, string];
  /** Where the title matched the search. */
  titleMatch?: [number, number];
}

export interface DayGroup { key: string; label: string; prompts: PromptRow[] }
export interface MonthGroup { key: string; label: string; count: number; current: boolean; days: DayGroup[] }

/** What the panel lists when not searching (setting promptComposer.panel.show). */
export type PanelShow = 'today' | 'month' | 'all';

export interface LibraryModel {
  folder: boolean;
  total: number;
  query: string;
  found: number;
  pinned: PromptRow[];
  months: MonthGroup[];
  show: PanelShow;
  /** Some prompts aren't listed because of `show` (a quiet line says so). */
  hidden: boolean;
  /** Nothing to list for today (`show` is today) or this month (otherwise): shown as a quiet row. */
  empty: boolean;
}

export type HostToLibrary =
  | { type: 'model'; model: LibraryModel }
  | { type: 'collapseAll' }
  | { type: 'focusSearch' }
  | { type: 'folds'; collapsed: string[] };

export type LibraryToHost =
  | { type: 'ready' }
  | { type: 'search'; query: string }
  | { type: 'open'; id: string; preview: boolean; focus: boolean; side?: boolean }
  | { type: 'newPrompt' }
  | { type: 'delete'; id: string }
  | { type: 'folds'; collapsed: string[] }
  | { type: 'show'; show: PanelShow }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
