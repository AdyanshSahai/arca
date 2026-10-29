// Chapter tree: the vault's real folder hierarchy.
//
// - Click a note to open it (Ctrl/middle-click opens in a new tab). Other
//   files (PDFs, scripts) open in the system's default app.
// - Right-click for new note/folder, rename, pin, move to trash.
// - Drag an entry onto the top or bottom edge of a row to place it before
//   or after that row (in any folder), or onto the middle of a folder to
//   move it inside. The empty area below the tree means the vault root.
//   Alt+↑ / Alt+↓ move the selected entry within its folder. The order is
//   saved in .arca/order.json.
// - The note in the focused pane is highlighted and its folders expanded.
// - Folders are dual-purpose: clicking the name opens the folder's own
//   note (written on first keystroke if it doesn't exist yet), and the
//   arrow expands or collapses its children.
//
// Built for deep hierarchies (10+ levels): the visible rows are flattened
// into one list, indentation tightens past level 6, faint guide lines mark
// each level, and folders show how many entries they hold. Keyboard (when
// the tree has focus):
//   ↑ / ↓      move           →  expand, or step into the first child
//   ← collapse, or jump to the parent folder
//   Enter      open           Space  toggle folder / open note
//   Home / End first / last row

import { useRenderCount } from "../../lib/perf";
import { openFromSidebar } from "../../lib/actions";
import { ChevronRight, FilePlus, FileText, Folder, FolderMinus, FolderOpen, FolderPlus, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, ipc } from "../../lib/ipc";
import { scrollWithin } from "../../lib/scroll";
import { baseName, defaultFolderNote, dirName, isTextPath, isWithin, joinPath } from "../../lib/paths";
import type { TreeNode } from "../../lib/types";
import { useContextPane, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { ContextMenu, type MenuSpec } from "../ui/ContextMenu";
import { IconButton } from "../ui/IconButton";

/** All ancestor folder paths of `path`: "a/b/c.md" → ["a", "a/b"]. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** MIME-ish key for our drag payload, so foreign drops are ignored. */
const DND_TYPE = "application/x-arca-path";

/** Where on a row a dragged entry is: before it, after it, or into a folder. */
type Zone = "before" | "after" | "into";
interface DropTarget {
  path: string;
  zone: Zone;
}

/**
 * Top 30% of a row = before, bottom 30% = after, the middle = into (for
 * folders; a note's middle splits at half height).
 */
function zoneAt(e: React.DragEvent, isDir: boolean): Zone {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (y < 0.3) return "before";
  if (y > 0.7) return "after";
  return isDir ? "into" : y < 0.5 ? "before" : "after";
}

/**
 * Left offset (px) of a row at `depth`: 16px per level for the first six,
 * then 8px per level, so a note 12 levels down still has room for its name.
 */
function indentOf(depth: number): number {
  return depth <= 6 ? depth * 16 : 96 + (depth - 6) * 8;
}

/** One visible row of the flattened tree. */
interface FlatRow {
  node: TreeNode;
  depth: number;
  /** Path of the parent folder ("" for top-level rows). */
  parent: string;
}

/** Depth-first list of the rows currently visible (expanded folders only). */
function flatten(nodes: TreeNode[], expanded: Set<string>, depth = 0, parent = "", out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth, parent });
    if (node.isDir && expanded.has(node.path)) flatten(node.children, expanded, depth + 1, node.path, out);
  }
  return out;
}

/** What clicking a row (or pressing Enter on it) does. */
function activate(node: TreeNode, newTab: boolean) {
  if (node.isDir) {
    const note = node.notePath ?? defaultFolderNote(node.path);
    openFromSidebar(note, { newTab, create: !node.notePath });
  } else if (node.isNote || isTextPath(node.path)) {
    // Notes and plain-text files open in the editor; anything else in its own app.
    openFromSidebar(node.path, { newTab });
  } else {
    ipc.openInDefaultApp(node.path).catch((err) => useUi.getState().toast(errorMessage(err), "error"));
  }
}

export function TreePanel() {
  useRenderCount("TreePanel");
  const tree = useVault((s) => s.tree);
  const activePath = useContextPane()?.path ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  /** Folder currently highlighted as a drop target. */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  /** Keyboard cursor: the row arrow keys act on (separate from the open note). */
  const [cursor, setCursor] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (tree ? flatten(tree.children, expanded) : []), [tree, expanded]);

  const expand = useCallback((paths: string[]) => {
    setExpanded((prev) => new Set([...prev, ...paths]));
  }, []);

  // Follow the focused note: expand its folders so it's visible.
  useEffect(() => {
    if (activePath) expand(ancestors(activePath));
  }, [activePath, expand]);

  // Pinned folders ask the tree to reveal them (see vault.activatePin).
  useEffect(() => {
    const onReveal = (e: Event) => {
      const folder = (e as CustomEvent<string>).detail;
      expand([...ancestors(folder), folder]);
      // Wait a frame for the rows to render, then centre it in the tree's
      // own scroll area (never scrolling the window; see lib/scroll.ts).
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(folder)}"]`);
        const scroller = row?.closest<HTMLElement>("[data-tree-scroll]");
        if (row && scroller) scrollWithin(scroller, row, "center");
      });
    };
    window.addEventListener("arca:reveal-folder", onReveal);
    return () => window.removeEventListener("arca:reveal-folder", onReveal);
  }, [expand]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  /** Moves `from` into folder `toDir` ("" = vault root). */
  const move = async (from: string, toDir: string) => {
    const to = joinPath(toDir, baseName(from));
    // No-ops and moving a folder into itself are refused up front.
    if (to === from || isWithin(toDir, from)) return;
    await useVault.getState().moveEntry(from, to);
    expand([toDir]);
  };

  /** The tree node for a folder path ("" = the vault root). */
  const folderNode = (dir: string): TreeNode | null => {
    if (!tree) return null;
    if (!dir) return tree;
    const walk = (n: TreeNode): TreeNode | null =>
      n.path === dir ? n : (n.children.filter((c) => c.isDir).map(walk).find(Boolean) ?? null);
    return walk(tree);
  };

  /**
   * Puts `from` right before / after `target` (moving it into target's
   * folder first if needed) and saves that folder's new order.
   */
  const place = async (from: string, target: TreeNode, zone: "before" | "after") => {
    if (from === target.path) return;
    const dir = dirName(target.path);
    if (isWithin(dir, from)) return; // a folder can't go inside itself
    let path = from;
    if (dirName(from) !== dir) {
      path = joinPath(dir, baseName(from));
      await useVault.getState().moveEntry(from, path);
    }
    // Siblings as currently shown, minus the moved entry, with it inserted.
    const siblings = (folderNode(dir)?.children ?? []).map((c) => c.name).filter((n) => n !== baseName(path));
    const at = siblings.indexOf(target.name);
    siblings.splice(at === -1 ? siblings.length : zone === "after" ? at + 1 : at, 0, baseName(path));
    try {
      await ipc.setOrder(dir, siblings);
      await useVault.getState().refresh();
    } catch (err) {
      useUi.getState().toast(`Couldn't save the order: ${errorMessage(err)}`, "error");
    }
  };

  /** Drop handler shared by every row. */
  const dropAt = (from: string, target: TreeNode, zone: Zone) => {
    if (zone === "into") void move(from, target.path);
    else void place(from, target, zone);
  };

  /** Alt+↑ / Alt+↓: swap an entry with its neighbour in the same folder. */
  const nudge = async (node: TreeNode, delta: -1 | 1) => {
    const dir = dirName(node.path);
    const names = (folderNode(dir)?.children ?? []).map((c) => c.name);
    const i = names.indexOf(node.name);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= names.length) return;
    [names[i], names[j]] = [names[j], names[i]];
    await ipc.setOrder(dir, names);
    await useVault.getState().refresh();
  };

  /** Moves the keyboard cursor to a row and keeps it visible. */
  const moveCursor = (path: string) => {
    setCursor(path);
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`);
      if (el && scroller.current) scrollWithin(scroller.current, el);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const idx = Math.max(0, rows.findIndex((r) => r.node.path === cursor));
    const row = rows[idx];
    const isOpen = row.node.isDir && expanded.has(row.node.path);
    let handled = true;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      void nudge(row.node, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        moveCursor(rows[Math.min(idx + 1, rows.length - 1)].node.path);
        break;
      case "ArrowUp":
        moveCursor(rows[Math.max(idx - 1, 0)].node.path);
        break;
      case "ArrowRight":
        if (row.node.isDir && !isOpen) toggle(row.node.path);
        else if (isOpen && row.node.children.length > 0) moveCursor(row.node.children[0].path);
        break;
      case "ArrowLeft":
        if (isOpen) toggle(row.node.path);
        else if (row.parent) moveCursor(row.parent);
        break;
      case "Home":
        moveCursor(rows[0].node.path);
        break;
      case "End":
        moveCursor(rows[rows.length - 1].node.path);
        break;
      case "Enter":
        activate(row.node, e.ctrlKey || e.metaKey);
        break;
      case " ":
        if (row.node.isDir) toggle(row.node.path);
        else activate(row.node, false);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const openMenu = (e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    const v = useVault.getState();
    // Folder the "new …" actions create into: the node itself, its parent, or root.
    const dir = node ? (node.isDir ? node.path : dirName(node.path)) : "";
    const items: MenuSpec["items"] = [
      { label: "New note", onSelect: () => v.promptNewNote(dir) },
      { label: "New note from template…", onSelect: () => useUi.getState().openTemplatePicker(dir) },
      { label: "New chapter folder", onSelect: () => v.promptNewFolder(dir) },
    ];
    if (node && node.path) {
      items.push(null);
      if (node.isNote) {
        items.push({ label: "Open in new tab", onSelect: () => useLayout.getState().openNote(node.path, { newTab: true }) });

      }
      items.push({
        label: "Pin to shortcut bar",
        onSelect: () => void v.addPin(node.path, node.isDir ? "folder" : node.isNote ? "note" : "file"),
      });
      items.push({ label: "Rename…", onSelect: () => v.promptRename(node.path) });
      if (node.isDir || node.isNote) {
        items.push({ label: node.isDir ? "Export chapter…" : "Export note…", onSelect: () => useUi.getState().openExport(node.path) });
      }
      items.push(null);
      items.push({ label: "Move to trash", danger: true, onSelect: () => v.confirmTrash(node.path) });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (!tree) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
        <IconButton title="New note" onClick={() => useVault.getState().promptNewNote("")}>
          <FilePlus size={14} />
        </IconButton>
        <IconButton title="New chapter folder" onClick={() => useVault.getState().promptNewFolder("")}>
          <FolderPlus size={14} />
        </IconButton>
        <div className="flex-1" />
        <IconButton title="Trash: restore deleted notes" onClick={() => useUi.getState().openTrash()}>
          <Trash2 size={14} />
        </IconButton>
        <IconButton title="Collapse all" onClick={() => setExpanded(new Set())}>
          <FolderMinus size={14} />
        </IconButton>
      </div>
      <div
        ref={scroller}
        data-tree-scroll
        // Focusable so arrow keys work; `group/tree` lets rows style the
        // keyboard cursor only while the tree itself has focus.
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => !cursor && rows[0] && setCursor(activePath && rows.some((r) => r.node.path === activePath) ? activePath : rows[0].node.path)}
        className={`group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2 outline-none ${dropTarget?.path === "" ? "bg-accent-soft" : ""}`}
        onContextMenu={(e) => openMenu(e, null)}
        // Dropping on empty space below the rows = move to the vault root.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_TYPE)) {
            e.preventDefault();
            setDropTarget({ path: "", zone: "into" });
          }
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          const from = e.dataTransfer.getData(DND_TYPE);
          setDropTarget(null);
          if (from) void move(from, "");
        }}
      >
        {tree.children.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-muted/60">Empty vault. Right-click to create a note.</p>
        )}
        {rows.map(({ node, depth }) => (
          <Row
            key={node.path}
            node={node}
            depth={depth}
            isOpen={expanded.has(node.path)}
            activePath={activePath}
            isCursor={cursor === node.path}
            dropTarget={dropTarget}
            onToggle={toggle}
            onSelect={(open) => {
              setCursor(node.path);
              if (open && node.isDir && !expanded.has(node.path)) toggle(node.path);
            }}
            onMenu={openMenu}
            onDropTarget={setDropTarget}
            onDropAt={dropAt}
          />
        ))}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  isOpen: boolean;
  activePath: string | null;
  /** Row holds the keyboard cursor. */
  isCursor: boolean;
  dropTarget: DropTarget | null;
  onToggle: (path: string) => void;
  /** Click on the row: move the cursor there (and expand folders being opened). */
  onSelect: (opening: boolean) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onDropTarget: (target: DropTarget | null) => void;
  onDropAt: (from: string, target: TreeNode, zone: Zone) => void;
}

function Row(props: RowProps) {
  const { node, depth, isOpen, activePath, isCursor, dropTarget, onToggle, onSelect, onMenu, onDropTarget, onDropAt } = props;
  // Which part of this row a dragged entry is over, if any.
  const zone = dropTarget?.path === node.path ? dropTarget.zone : null;
  // A folder's page: its existing note, or where a new one would go.
  const folderNote = node.isDir ? (node.notePath ?? defaultFolderNote(node.path)) : null;
  const isActive = node.isDir ? folderNote === activePath : node.path === activePath;

  const onClick = (e: React.MouseEvent) => {
    // Opening a folder's page also reveals its children.
    onSelect(true);
    activate(node, e.ctrlKey || e.metaKey || e.button === 1);
  };

  return (
    <div
      data-tree-path={node.path}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, node.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DND_TYPE)) return;
        e.preventDefault();
        e.stopPropagation(); // the row, not the root container, takes it
        onDropTarget({ path: node.path, zone: zoneAt(e, node.isDir) });
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropTarget(null);
        const from = e.dataTransfer.getData(DND_TYPE);
        if (from) onDropAt(from, node, zoneAt(e, node.isDir));
      }}
      onClick={onClick}
      onAuxClick={(e) => e.button === 1 && onClick(e)}
      onContextMenu={(e) => onMenu(e, node)}
      // 8px base padding aligns the first level with the panel header.
      style={{ paddingLeft: 8 + indentOf(depth) }}
      className={`relative flex h-[30px] min-w-0 cursor-default items-center gap-2 rounded-md pr-2 text-[13.5px] transition-colors ${
        isActive ? "bg-accent-soft text-accent" : "text-fg/85 hover:bg-hover"
      } ${zone === "into" ? "outline outline-1 -outline-offset-1 outline-accent" : ""} ${
        // Keyboard cursor ring, only while the tree has focus.
        isCursor ? "group-focus/tree:shadow-[inset_0_0_0_1px_var(--fg-inactive)]" : ""
      }`}
    >
      {/* Where a dragged entry would land: a line above or below the row. */}
      {(zone === "before" || zone === "after") && (
        <span
          aria-hidden
          className={`pointer-events-none absolute right-1 h-[2px] rounded-full bg-accent ${zone === "before" ? "-top-px" : "-bottom-px"}`}
          style={{ left: 8 + indentOf(depth) }}
        />
      )}
      {/* Indent guides: one faint vertical line per ancestor level, centred
          under that level's arrow. */}
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-line"
          style={{ left: 8 + indentOf(level) + 6 }}
        />
      ))}
      {node.isDir ? (
        // The arrow only toggles; it never opens the folder's note.
        <span
          role="button"
          title={isOpen ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className="-my-1 -ml-1 flex h-6 w-5 shrink-0 items-center justify-center rounded hover:bg-btn"
        >
          <ChevronRight size={13} className={`text-muted/70 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </span>
      ) : (
        // Same width as the folder arrow (20px − 4px negative margin).
        <span className="w-4 shrink-0" />
      )}
      {/* Folder / note / other-file icon. */}
      {node.isDir ? (
        isOpen ? (
          <FolderOpen size={15} className="shrink-0 text-accent/75" />
        ) : (
          <Folder size={15} className="shrink-0 text-accent/75" />
        )
      ) : node.isNote || isTextPath(node.path) ? (
        <FileText size={15} className={`shrink-0 ${isActive ? "text-accent" : "text-muted/70"}`} />
      ) : (
        <Paperclip size={15} className="shrink-0 text-muted/45" />
      )}
      <span
        className={`min-w-0 flex-1 truncate ${node.isDir ? "font-medium text-fg/90" : node.isNote ? "" : isTextPath(node.path) ? "text-fg/70" : "text-fg/45"}`}
        // Full path on hover, since deep rows may be truncated.
        title={node.isDir ? (node.notePath ? `${node.path}  (has an overview page)` : `${node.path}  (click to write an overview)`) : node.path}
      >
        {/* Notes drop the ".md"; other files keep their extension so the type is clear. */}
        {node.isNote ? node.name.replace(/\.(md|markdown)$/i, "") : node.name}
      </span>
      {/* Child count on folders, so collapsed chapters still say how big they are. */}
      {node.isDir && node.children.length > 0 && (
        <span className="shrink-0 rounded px-1.5 text-[11px] text-muted/55 tabular-nums">{node.children.length}</span>
      )}
    </div>
  );
}
