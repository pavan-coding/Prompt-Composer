# Prompt Composer v0.2.0

Released 2026-10-05. **Claude Code's Ctrl+G now opens the prompt you're typing in Prompt Composer.** Close the tab and the text is back in Claude.

## Install

Download `prompt-composer-0.2.0.vsix`, then:

```bash
code --install-extension prompt-composer-0.2.0.vsix
```

Or in VS Code: Extensions view → **⋯** → **Install from VSIX…**. Needs VS Code 1.95 or later, with a folder open. Reload open windows afterwards (**Developer: Reload Window**).

SHA-256: `c5198549034790d8cb85c0836a79a4062cfa8431a9822b1b25276d395eb6962e`

## Set up Ctrl+G (Linux and macOS, once)

1. Put the helper [`claude-code/claude-prompt-composer`](../../claude-code/claude-prompt-composer) on your `PATH`:

   ```bash
   install -m 755 claude-code/claude-prompt-composer ~/.local/bin/
   ```

2. Make it Claude Code's editor in `~/.claude/settings.json`, then start Claude again:

   ```json
   { "env": { "VISUAL": "/home/<you>/.local/bin/claude-prompt-composer" } }
   ```

## What's new

**Claude Code's Ctrl+G opens in Prompt Composer**
- Press **Ctrl+G** in Claude Code. The prompt opens in a composer tab, titled with its first line.
- **Which window:** the one open on Claude's folder (or a folder above it). If none, the window you used last; with no window at all, a new one on Claude's folder.
- Edit it like any prompt: `@` mentions, images, formatting, the same shortcuts. Every change is written straight back, so there's nothing to save.
- **Close the tab** and the text is in Claude's input, ready to send. **Esc** or **Ctrl+C** in the terminal cancels, and Claude keeps the prompt it had.
- `@paths` are rewritten for the folder Claude runs in when VS Code is open on another one. Images become `@paths`, as with Copy as Prompt.
- An untouched prompt comes back exactly as Claude wrote it. **Revert Prompt** goes back to Claude's text.

**Nothing else changes**
- Claude's prompt stays in Claude's temp folder. It isn't saved in `.prompt-composer/`, isn't listed in the panel and never asks to be saved.
- Your own prompts open, save and list exactly as before.
- Other files given to the helper (a git commit message, say) still go to `$EDITOR`.

## Tested

On Ubuntu with VS Code 1.139.1:
- **Unit:** 105 tests pass, 16 of them new. That includes `@path` rewriting and the helper script run against a stand-in `code`, with Esc, Ctrl+C and arrow keys in a real pseudo-terminal.
- **Integration:** 58 tests pass, 6 of them new. One runs a real `code --wait` against the test window: it keeps waiting while the tab is open and returns when it closes.
- **End-to-end:** 39 pass, including the new CL-08 (typing and Ctrl+B in Claude's tab, the file following each edit, closing with no save question). SV-05 is skipped as before.
- **Packaged `.vsix`:** the smoke test passes. A new Ctrl+G smoke test also passes: the packaged extension in a throwaway VS Code, with the real helper and the real `code` CLI, run from a subfolder; typing and Ctrl+W hand the text back.
- **Known, not from this release:**
  - The end-to-end tests PN-03 and PN-05 fail on this machine, and v0.1.0 fails them the same way here.
  - Two speed benchmarks (MN-12, PN-13) take 31–34 ms against a 30 ms target in about one run in three.
