# Arca

A local-first markdown notebook for power users. It combines the strict
folder hierarchy of CherryTree with the linked-notes graph of Obsidian, on a
Rust + Tauri v2 stack.

Notes are plain `.md` files in a folder you choose. There is no database
and no lock-in, so you can open the same folder in any other editor, or
`git` it.

## Features

- **Chapters:** nested folders on disk become a collapsible chapter tree.
  It handles deep nesting (10+ levels, with indent guides and child
  counts) and can be driven entirely from the keyboard.
  - Clicking a folder's name opens its own overview note
    (`hardware/hardware.md`, `hardware/index.md` or `hardware.md` beside
    it); the arrow expands it.
  - Drag entries to move them; right-click to create, rename, pin,
    export or trash.
- **Post-it notes:** small annotations embedded in a note, collapsible in
  the editor and collected in their own sidebar panel, where you can edit
  them in place:
  ```markdown
  <!-- postit:id=123 color=purple -->
  > **Post-it:** Check hardware registers before calling CPUID.
  <!-- /postit -->
  ```
- **[[WikiLinks]]:** link to notes (`[[cpu]]`, `[[hardware/cpu|alias]]`),
  websites (`[[https://…]]`) or local files such as textbooks
  (`[[~/books/sicp.pdf]]`). Typing `[[` autocompletes note names.
- **Backlinks, outgoing links and tags** for the current note.
- **Graph view:** an interactive 2D force graph, global or N hops around
  the current note. "Ghost" nodes stand for links to notes that don't
  exist yet.
- **Search:** an in-memory [Tantivy](https://github.com/quickwit-oss/tantivy)
  index:
  - Files: fuzzy, or `/regex/`
  - Text: full-text, the whole vault or the current folder
  - Topic: `#tag` or `[[note]]`
- **Konsole-style split tiling:** every tab can be split into side-by-side
  or stacked panes, each with its own note.
- **Editor:** CodeMirror 6, switching between live preview (markdown
  rendered except on the line you're editing) and raw markdown.
- **Rich markdown** in live preview:
  - `> [!NOTE]` / `[!WARNING]` / … callouts
  - KaTeX math (`$inline$`, `$$display$$`)
  - code boxes with a language picker and a copy button
  - rendered tables (Tab / Shift+Tab move between cells and re-align
    columns)
  - inline images
- **Attachments:** paste images or drop files onto a note. They're stored
  in a hidden `.assets/` folder next to it.
- **Command palette** (`Ctrl+P`): jump to notes, run any action (`>`),
  or find notes by tag (`#`).
- **Templates:** bug report, study log, meeting notes, daily note and
  chapter overview, with `{{title}}`/`{{date}}`/`{{time}}` placeholders.
  Kept editable in `<vault>/.arca/templates/`.
- **Export:** a note, a chapter or the whole vault, as one printable HTML
  page (with contents; use Print → Save as PDF for a PDF) or as merged
  Markdown.
- **Plain-text files** open in the editor, with an offer to convert them
  to Markdown.
- **Pinned shortcut bar** for frequent notes, folders and files.
- **Sidebar drawer** that snaps to ¼, ½ or the full window.
- **TwilightPixel** dark purple theme.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+P` | Command palette (notes; `>` actions; `#` tags) |
| `Ctrl+Shift+P` | Command palette, actions only |
| `Ctrl+Shift+F` | Full-text search |
| `Ctrl+N` | New note |
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+Tab`, `Ctrl+1…9` | Cycle / jump to tabs |
| `Ctrl+Shift+(` | Split pane left / right |
| `Ctrl+Shift+)` | Split pane top / bottom |
| `Ctrl+D` (or `Ctrl+Shift+X`) | Close pane |
| `Ctrl+Alt+Arrows` | Move focus between panes |
| `Ctrl+E` | Live preview ↔ raw markdown |
| `Ctrl+Alt+P` | Insert a post-it |
| `Ctrl+B` | Toggle the sidebar drawer |
| `Alt+1…9` | Open pinned shortcut N |
| `Tab` / `Shift+Tab` | Next / previous table cell |
| `↑ ↓ ← →`, `Enter`, `Space` | Navigate the chapter tree (when focused) |
| `Ctrl+click` | Follow a link / search a tag (raw mode) |

## Building

Requirements:

- Rust (via [rustup](https://rustup.rs))
- Node.js 20+
- Tauri's [system dependencies](https://v2.tauri.app/start/prerequisites/)
  (on Fedora: `webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel`)

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce an installable bundle
cargo test -p arca-core  # run the engine's unit tests
```

## Layout

```
crates/arca-core/   Headless Rust engine: vault I/O, post-its, links, Tantivy search
src-tauri/          Tauri v2 shell: IPC commands, file watcher, settings
src/                React + TypeScript frontend
  editor/           CodeMirror extensions (live preview, wiki-links, post-its)
  components/       Window chrome, drawer panels, split panes
  store/            zustand stores (layout, buffers, vault, ui)
```

## Where data lives

| What | Where |
| --- | --- |
| Notes | your vault folder, as plain `.md` files |
| Pins | `<vault>/.arca/vault.json` (they travel with the vault) |
| Deleted notes | `<vault>/.trash/` (restore by moving them back) |
| Attachments | `.assets/` next to the note that uses them |
| Templates | `<vault>/.arca/templates/` |
| Window layout | the OS config folder (`~/.config/dev.adyansh.arca/` on Linux) |

## Running two versions side by side

`npm run sandbox` starts an isolated development build next to a normal
one. It runs on port 1421 instead of 1420, uses its own settings
(identifier `dev.adyansh.arca.sandbox`), and shows a **DEV** badge in the
title bar. Combined with a git worktree, you can keep using one version
while another is being worked on:

```bash
git worktree add ../arca-dev dev   # second checkout on the dev branch
cd ../arca-dev && npm install
npm run sandbox                    # runs alongside `npm run tauri dev` in ../arca
```

Both windows can open the same vault: each one notices the other's saves
through the file watcher.
