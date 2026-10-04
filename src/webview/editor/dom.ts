// The editor page skeleton: toolbar, editor area, gutter, drag handle, and the floating menus.
export const SKELETON = `
<div class="tt-toolbar" id="toolbar"><div class="tt-bar" role="toolbar" aria-label="Formatting">
  <div class="tt-group">
    <button class="tt-btn" data-dd="heading" title="Heading"><span class="ic i-heading" data-icon></span><span class="ic sm i-chevron-down"></span></button>
    <button class="tt-btn" data-dd="list" title="List"><span class="ic i-list" data-icon></span><span class="ic sm i-chevron-down"></span></button>
    <button class="tt-btn" data-cmd="blockquote" title="Quote"><span class="ic i-text-quote"></span></button>
    <button class="tt-btn" data-cmd="codeBlock" title="Code block"><span class="ic i-square-code"></span></button>
  </div>
  <span class="tt-sep"></span>
  <div class="tt-group">
    <button class="tt-btn" data-cmd="bold" title="Bold (Ctrl+B)"><span class="ic i-bold"></span></button>
    <button class="tt-btn" data-cmd="italic" title="Italic (Ctrl+I)"><span class="ic i-italic"></span></button>
    <button class="tt-btn" data-cmd="strike" title="Strikethrough (Ctrl+Shift+S)"><span class="ic i-strikethrough"></span></button>
    <button class="tt-btn" data-cmd="code" title="Inline code (Ctrl+E)"><span class="ic i-code"></span></button>
    <button class="tt-btn" data-cmd="link" title="Link (Ctrl+K)"><span class="ic i-link"></span></button>
  </div>
  <span class="tt-sep"></span>
  <div class="tt-group">
    <button class="tt-btn" data-cmd="mention" title="Mention a file or folder (@)"><span class="ic i-at-sign"></span></button>
    <button class="tt-btn" data-cmd="image" title="Add image"><span class="ic i-image-plus"></span></button>
  </div>
</div></div>
<div class="scroller" id="scroller">
  <div class="composer" id="composer">
    <div class="ln-gutter" id="lnGutter" aria-hidden="true"></div>
    <button class="drag-handle" id="dragHandle" draggable="true" title="Drag to move · Click for options" tabindex="-1"><span class="ic i-grip-vertical"></span></button>
    <div id="editor"><div class="loading">Loading…</div></div>
  </div>
</div>
<div class="drop-hint" id="dropHint"><span class="tt-pop" id="dropHintText"></span></div>
<div class="picker tt-pop" id="picker" role="listbox"><div class="list" id="pickerList"></div><div class="hint"><span>↵ insert</span><span>Tab open folder</span><span>Esc close</span></div></div>
<div class="hover tt-pop" id="hover"></div>
<div class="iv" id="imgView" role="dialog" aria-label="Image" tabindex="-1" hidden>
  <div class="iv-scroll" id="ivScroll"><img id="ivImg" alt="" draggable="false"></div>
  <div class="iv-bar tt-pop">
    <button class="tt-btn" data-iv="out" title="Zoom out"><span class="ic i-zoom-out"></span></button>
    <span class="iv-pct" id="ivPct">100%</span>
    <button class="tt-btn" data-iv="in" title="Zoom in"><span class="ic i-zoom-in"></span></button>
    <span class="tt-sep"></span>
    <button class="tt-btn" data-iv="close" title="Close (Esc)"><span class="ic i-x"></span></button>
  </div>
</div>
<div class="tt-menu tt-pop" id="menu-heading" data-menu="heading">
  <button data-cmd="paragraph"><span class="ic i-pilcrow"></span><span class="lbl">Text</span></button>
  <button data-cmd="h1"><span class="ic i-heading-1"></span><span class="lbl">Heading 1</span><kbd>#</kbd></button>
  <button data-cmd="h2"><span class="ic i-heading-2"></span><span class="lbl">Heading 2</span><kbd>##</kbd></button>
  <button data-cmd="h3"><span class="ic i-heading-3"></span><span class="lbl">Heading 3</span><kbd>###</kbd></button>
</div>
<div class="tt-menu tt-pop" id="menu-list" data-menu="list">
  <button data-cmd="bulletList"><span class="ic i-list"></span><span class="lbl">Bullet list</span><kbd>-</kbd></button>
  <button data-cmd="orderedList"><span class="ic i-list-ordered"></span><span class="lbl">Ordered list</span><kbd>1.</kbd></button>
  <button data-cmd="taskList"><span class="ic i-list-todo"></span><span class="lbl">Task list</span><kbd>[ ]</kbd></button>
</div>
<div class="tt-menu tt-pop" id="menu-block" data-menu="block">
  <button data-bcmd="up"><span class="ic i-arrow-up"></span><span class="lbl">Move up</span><kbd>Alt+↑</kbd></button>
  <button data-bcmd="down"><span class="ic i-arrow-down"></span><span class="lbl">Move down</span><kbd>Alt+↓</kbd></button>
  <button data-bcmd="duplicate"><span class="ic i-copy"></span><span class="lbl">Duplicate</span></button>
  <button data-bcmd="delete"><span class="ic i-trash-2"></span><span class="lbl">Delete</span></button>
</div>
<div class="tt-menu tt-pop lang-menu" id="menu-lang" data-menu="lang"></div>
<div hidden id="holder"><div class="bubble tt-pop" id="bubble" role="toolbar" aria-label="Format selection">
  <button class="tt-btn" data-cmd="bold" title="Bold"><span class="ic i-bold"></span></button>
  <button class="tt-btn" data-cmd="italic" title="Italic"><span class="ic i-italic"></span></button>
  <button class="tt-btn" data-cmd="strike" title="Strikethrough"><span class="ic i-strikethrough"></span></button>
  <button class="tt-btn" data-cmd="code" title="Inline code"><span class="ic i-code"></span></button>
  <button class="tt-btn" data-cmd="link" title="Link"><span class="ic i-link"></span></button>
  <span class="tt-sep"></span>
  <button class="tt-btn" data-cmd="h2" title="Turn into heading"><span class="ic i-heading"></span></button>
  <button class="tt-btn" data-cmd="bulletList" title="Turn into list"><span class="ic i-list"></span></button>
  <button class="tt-btn" data-cmd="clear" title="Clear formatting"><span class="ic i-remove-formatting"></span></button>
</div></div>
<div class="slash tt-pop" id="slash" role="listbox"><div class="list" id="slashList"></div><div class="hint"><span>↑↓ select</span><span>↵ insert</span><span>Esc close</span></div></div>
`;
