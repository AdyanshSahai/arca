# Arca

A CherryTree alternative built on plain Markdown files. You get the same deep tree of notes, plus Obsidian-style `[[links]]`, backlinks and a graph, in a dark, keyboard-driven desktop app.

![Platform](https://img.shields.io/badge/platform-Linux-6b4f80)
![Stack](https://img.shields.io/badge/stack-Rust%20%2B%20Tauri%20v2-bc8bca)
![Search](https://img.shields.io/badge/search-Tantivy-ffbfff)
![License](https://img.shields.io/badge/license-MIT-9fdcb4)

- **A real tree.** Folders are chapters, nested as deep as you like and arranged in any order. Click a chapter's name to open its own overview note, or its arrow to expand it.
- **Plain files.** Every note is a `.md` file in a folder you choose. There's no database and nothing to export your way out of.
- **Links that work both ways.** `[[WikiLinks]]`, a backlinks panel, and a graph of how the current note connects to others.
- **Post-it notes.** Small coloured annotations live inside a note, and all of them are collected in one panel.
- **Panes like Konsole.** Split any tab left/right or top/bottom, move panes between tabs, and keep different notes side by side.
- **Instant search.** Fuzzy file names, full text (with match case), and `#tag` / `[[link]]` topics, all from an in-memory Tantivy index.
- **Rich Markdown.** Live preview with callouts, KaTeX math, tables, code boxes and images. Reading mode hides all the syntax.

Arca is a personal project shared as-is. It reads and writes only the folder you open, but keep backups of anything you care about, as you would with any young app.

## Coming from CherryTree

| CherryTree | Arca |
| --- | --- |
| One `.ctb` / `.ctd` file holding every node | A folder of `.md` files you can open in any editor, sync or `git` |
| Node | Note (a `.md` file). Order them however you like by dragging |
| Node with children | Folder. Its own text lives in a folder note (`hardware/hardware.md`, `hardware/index.md` or `hardware.md` next to the folder) |
| Rich text | Markdown with live preview: headings, bold, lists and tasks render in place |
| Codebox | Fenced code block with syntax highlighting, a language picker and a copy button |
| Table | Markdown table, rendered as a real table. Tab moves between cells and re-aligns the columns |
| Internal link / anchor | `[[Note name]]`, `[[folder/note\|label]]` or `[[note#Heading]]` |
| Node tags | `#tags` anywhere in a note |
| Find in nodes | Text search over the whole vault or one folder, plus fuzzy file search |
| Export to HTML / PDF | Export a note, a chapter or the whole vault to one printable HTML page, or to merged Markdown |
| Read-only node | App-wide reading mode (`Ctrl+Shift+E`) |

There's no importer for `.ctb` / `.ctd` files yet; see [Planned Updates](#planned-updates).

## Quick Start

Linux only, tested on Fedora KDE. You build Arca from source; it takes a few minutes the first time.

**1. Install the dependencies**

These are the system libraries for Tauri (the desktop shell) plus a C toolchain:

| Distro | Command |
| --- | --- |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel nodejs npm && sudo dnf group install c-development` |
| Debian / Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev nodejs npm` |
| Arch | `sudo pacman -S webkit2gtk-4.1 base-devel openssl libappindicator-gtk3 librsvg xdotool nodejs npm` |

You also need Rust, installed with [rustup](https://rustup.rs):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Node.js 20 or newer is required. Check with `node --version`.

**2. Get the code**

```bash
git clone https://github.com/AdyanshSahai/arca
cd arca
npm install
```

**3. Run it**

```bash
npm run tauri dev
```

The first build compiles everything and takes a few minutes; after that it starts in seconds. To build a standalone, faster binary instead:

```bash
npm run tauri build -- --no-bundle
./target/release/arca
```

**4. Open a vault**

Click **Open vault folder…** and pick any folder. An empty one is fine. Arca only reads and writes `.md` (and `.txt`) files inside it, plus its own hidden `.arca/` and `.trash/` folders. Next time, Arca reopens the same vault and layout.

## How It Works

A small Rust engine (`crates/arca-core`) reads the vault, keeps an in-memory [Tantivy](https://github.com/quickwit-oss/tantivy) search index, and works out links, backlinks, tags, post-its and the graph. The index is rebuilt from your files every time a vault opens, so the files are always the only source of truth. A file watcher picks up edits made outside Arca.

The window is a [Tauri v2](https://v2.tauri.app) app with a React + TypeScript front end and a [CodeMirror 6](https://codemirror.net) editor. The front end can only reach the vault through Arca's own commands, and every path is checked so nothing outside the vault folder can be touched.

## Using It

**Notes and chapters.** Right-click in the chapter tree to create notes, chapter folders, notes from a template, or to rename, pin, export or trash. Drag entries to rearrange them: drop on the top or bottom edge of a row to place it before or after that row, or on the middle of a folder to move it inside (`Alt+↑` / `Alt+↓` move the selected entry too). Your order is remembered. Deleting never destroys anything: it moves the entry to `.trash/` inside the vault.

**Writing.** Live preview renders Markdown as you go and shows the raw syntax only on the line you're editing. `Ctrl+E` switches a pane to raw Markdown, and `Ctrl+Shift+E` puts every note in reading mode. Typing `[[` autocompletes note names. Paste an image, or drop a file from your file manager, and it's saved in a hidden `.assets/` folder next to the note and linked.

**Formatting ribbon.** While writing, a toolbar like Word's or Google Docs' sits above each note: undo, paragraph style, bold/italic, lists, links, tables, equations, callouts and more. The ▾ at its right end switches between a slim **minimal ribbon** and the **full ribbon** with labelled groups. It disappears in reading mode. Every button just writes ordinary Markdown.

**Post-its.** `Ctrl+Alt+P` drops one at the cursor. On disk it's plain Markdown that other tools show as a quote:

```markdown
<!-- postit:id=k3x9 color=purple -->
> **Post-it:** Check hardware registers before calling CPUID.
<!-- /postit -->
```

The Post-its panel lists every post-it in the vault and lets you edit their text and colour in place.

**Rich blocks.**

```markdown
> [!WARNING] Callouts
> Also NOTE, TIP, DANGER, EXAMPLE, QUESTION…

Inline math $E = mc^2$, and display math:
$$
\sum_{k=0}^{n} k^2
$$
```

**Panes and tabs.** `Ctrl+Shift+(` splits the focused pane left/right and `Ctrl+Shift+)` top/bottom; `Ctrl+D` closes it. Drag a pane's header onto another tab (or onto empty tab-strip space for a new tab). When you open a note from the sidebar into a split tab, Arca asks where it should go: press a pane's number, `N` for a new pane, or `T` for a new tab.

**Sidebar views.** Chapters, Outline, Graph, Search, Backlinks and Post-its live in the left rail. They open in the sidebar, which snaps to ¼, ½ or full width. "Move to pane" turns any of them into a pane of its own.

**Outline.** A table of contents for the current note, built from its headings and updated as you type. Click a heading to jump to it; the section your cursor is in is highlighted.

**Graph.** Shows the current note's neighbourhood: the notes it links to and from, up to 1–3 links away. The current note is the square.

**Command palette.** `Ctrl+P` jumps to any note. Type `>` for actions, or `#` to find notes by tag.

**Templates.** "New note from template…" (palette or right-click) offers Bug Report, Study Log, Meeting Notes, Daily Note and Chapter Overview. They're plain files in `<vault>/.arca/templates/`, so edit them or add your own. `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}` and `{{folder}}` are filled in for you.

**History.** With version history on (Settings → Saving), Arca snapshots your notes every few minutes. The **Time Machine** (palette, or the clock button in a pane) shows a timeline: everything from the last day, then hourly, then daily. Compare any old version with now and restore a note, a chapter or the whole vault. Restores are themselves recorded, so they can be undone, and notes that didn't exist back then go to the trash rather than being deleted.

**Renaming.** Renaming or moving a note fixes every `[[link]]` that pointed at it (with an Undo).

**Export.** "Export notes…" compiles a note, a chapter (in reading order: overview first, then notes, then sub-chapters) or the whole vault into one HTML page with a table of contents. Post-its, callouts and images come along. Print it from a browser for a PDF. Markdown export merges everything into one `.md` file.

## Keyboard Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+P` | Command palette (`>` actions, `#` tags) |
| `Ctrl+Shift+F` | Search text in the vault |
| `Ctrl+N` | New note |
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+Tab`, `Ctrl+1…9` | Next tab / jump to a tab |
| `Ctrl+Shift+(` / `Ctrl+Shift+)` | Split left/right / top/bottom |
| `Ctrl+D` | Close pane |
| `Ctrl+Alt+Arrows` | Move between panes |
| `Ctrl+Shift+PgUp` / `PgDn` | Move pane to the previous / next tab |
| `Ctrl+Shift+H` | Move pane into a new tab |
| `Ctrl+E` | Live preview / raw Markdown |
| `Ctrl+Shift+E` | Reading / writing mode (all notes) |
| `Ctrl+Alt+P` | Insert a post-it |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | Bold / italic / link (while writing) |
| `Ctrl+Alt+1…6` / `Ctrl+Alt+0` | Heading level / normal text |
| `Ctrl+Shift+8` / `Ctrl+Shift+7` | Bulleted / numbered list |
| `Tab` / `Shift+Tab` | Next / previous table cell |
| `Ctrl+B` | Toggle the sidebar (outside the editor) |
| `Ctrl+,` | Settings |
| `Alt+1…9` | Open pinned shortcut N |

The same list is in Settings → Shortcuts.

## Configuration

Open Settings with `Ctrl+,` or the gear at the bottom of the left rail. Changes apply immediately.

| Setting | Options | Default |
| --- | --- | --- |
| Colour scheme | TwilightPixel, Midnight, Rosewood, Forest, Ember, Paper (light), or Custom (pick all 8 colours yourself) | TwilightPixel |
| Autosave | On (writes shortly after you stop typing and when Arca loses focus), or off (save with `Ctrl+S`; Arca asks before closing with unsaved notes) | On |
| Version history | Snapshots of your notes every few minutes with built-in git, browsable in the Time Machine; optional push to a backup remote | Off |
| Views (graph, search…) open | In the sidebar, or ask every time | Sidebar |
| Notes opened from the sidebar | Ask when the tab is split, always ask, or use the focused pane | Ask when split |

## Where Data Lives

| What | Where |
| --- | --- |
| Notes | Your vault folder, as plain `.md` files |
| Attachments | `.assets/` next to the note that uses them |
| Templates | `<vault>/.arca/templates/` |
| Pinned shortcuts | `<vault>/.arca/vault.json` (they travel with the vault) |
| Deleted notes | `<vault>/.trash/`. Restore them from the Trash window (trash button in the chapter tree) |
| Version history | `<vault>/.arca/history.git` (notes only, never attachments) |
| Window layout, settings | `~/.config/dev.adyansh.arca/` |

## Updating

```bash
cd arca
git pull
npm install
```

Then run it again. The first build after an update may take a little longer.

## Uninstalling

Delete the cloned folder and `~/.config/dev.adyansh.arca/`. Your vaults are not touched. If you want, also delete the hidden `.arca/` (templates, pins) and `.trash/` folders inside them.

## Known Issues

- There's no importer for CherryTree `.ctb` / `.ctd` files yet.
- Keyboard shortcuts can't be rebound yet.
- Math in exported HTML is typeset by KaTeX loaded from a CDN, so it needs an internet connection when the page is opened.
- Attachments stay in `.assets/` after the link to them is deleted.
- Dragging nodes in the graph is disabled; that's what keeps the layout perfectly still.
- Only tested on Linux (Fedora KDE).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Build fails mentioning `webkit2gtk`, `javascriptcore` or `glib` | The system libraries are missing. Run the command for your distro from step 1. |
| `cargo` or `rustc` not found | Rust isn't on your PATH. Run `source ~/.cargo/env`, or open a new terminal after installing rustup. |
| `Port 1420 is already in use` | Another `npm run tauri dev` is running. Close it, or run this one with `npm run sandbox`, which uses port 1421 and its own settings. |
| Edits made in another editor don't show up | Large vaults can hit the Linux file-watch limit. Raise it: `echo fs.inotify.max_user_watches=524288 \| sudo tee /etc/sysctl.d/90-inotify.conf && sudo sysctl --system` |
| Images don't show in live preview | Image links are relative to the note's folder, e.g. `![](.assets/pic.png)`. Check that the path matches. |
| Everything looks slow in `tauri dev` | Run the release build from step 3. Profiling notes are under [Development](#development). |

## Development

```
crates/arca-core/   Rust engine: vault I/O, post-its, links, Tantivy search, export
src-tauri/          Tauri v2 shell: IPC commands, file watcher, settings
src/                React + TypeScript front end
  editor/           CodeMirror extensions (live preview, links, post-its, tables, math)
  components/       Window chrome, sidebar views, panes, dialogs
  store/            zustand stores (layout, buffers, vault, ui)
```

```bash
cargo test -p arca-core          # engine tests
npm run typecheck                # front end
npm run sandbox                  # a second, isolated copy (port 1421, own settings, DEV badge)
```

**Profiling.** Both tools are inert unless switched on:

- `cargo run -p arca-core --example bench --release -- <vault>` times the work behind every command. Pass `--generate <dir> <n>` to make a test vault of `n` notes.
- `VITE_ARCA_PROFILE_VAULT=/tmp/vault-copy npm run profile 2> perf.log` opens a **copy** of a vault, types into a note programmatically, and logs re-renders, per-keystroke editor time and every command's duration as `[arca-perf]` lines, then closes itself.

## Planned Updates

- Import CherryTree `.ctb` / `.ctd` files into a folder of notes.
- Rebindable keyboard shortcuts.
- Bundle KaTeX into exports so math renders offline.
- Direct PDF export.
- Packaged builds (AppImage / `.rpm` / `.deb`), and testing on other platforms.

Feel free to contribute via forks and Pull Requests, or open an issue if something breaks.

## Credits

Built on [Tauri](https://v2.tauri.app), [Tantivy](https://github.com/quickwit-oss/tantivy), [CodeMirror](https://codemirror.net), [KaTeX](https://katex.org), [react-force-graph](https://github.com/vasturiano/react-force-graph) and [d3-force](https://github.com/d3/d3-force). Fonts: Inter and JetBrains Mono. Icons: [Lucide](https://lucide.dev).
