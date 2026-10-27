// Chapter tree: the vault's real folder hierarchy.
//
// - Click a note to open it (Ctrl/middle-click opens in a new tab). Other
//   files (PDFs, scripts) open in the system's default app.
// - Right-click for new note/folder, rename, pin, move to trash.
// - Drag an entry onto a folder (or the empty area below the tree, which
//   means the vault root) to move it.
// - The note in the focused pane is highlighted and its folders expanded.
// - Folders are dual-purpose: clicking the name opens the folder's own
//   note (written on first keystroke if it doesn't exist yet), and the
//   arrow expands or collapses its children.

import { ChevronRight, FilePlus, FileText, Folder, FolderMinus, FolderOpen, FolderPlus, Paperclip } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, ipc } from "../../lib/ipc";
import { scrollWithin } from "../../lib/scroll";
import { baseName, defaultFolderNote, dirName, isWithin, joinPath } from "../../lib/paths";
import type { TreeNode } from "../../lib/types";
import { useFocusedPane, useLayout } from "../../store/layout";
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

export function TreePanel() {
  const tree = useVault((s) => s.tree);
  const activePath = useFocusedPane()?.path ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  /** Folder currently highlighted as a drop target. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  const openMenu = (e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    const v = useVault.getState();
    // Folder the "new …" actions create into: the node itself, its parent, or root.
    const dir = node ? (node.isDir ? node.path : dirName(node.path)) : "";
    const items: MenuSpec["items"] = [
      { label: "New note", onSelect: () => v.promptNewNote(dir) },
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
        <IconButton title="Collapse all" onClick={() => setExpanded(new Set())}>
          <FolderMinus size={14} />
        </IconButton>
      </div>
      <div
        data-tree-scroll
        className={`min-h-0 flex-1 overflow-y-auto px-2 py-2 ${dropTarget === "" ? "bg-accent-soft" : ""}`}
        onContextMenu={(e) => openMenu(e, null)}
        // Dropping on empty space below the rows = move to the vault root.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_TYPE)) {
            e.preventDefault();
            setDropTarget("");
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
        {tree.children.map((child) => (
          <Row
            key={child.path}
            node={child}
            depth={0}
            expanded={expanded}
            activePath={activePath}
            dropTarget={dropTarget}
            onToggle={toggle}
            onMenu={openMenu}
            onDropTarget={setDropTarget}
            onMove={move}
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
  expanded: Set<string>;
  activePath: string | null;
  dropTarget: string | null;
  onToggle: (path: string) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onDropTarget: (path: string | null) => void;
  onMove: (from: string, toDir: string) => void;
}

function Row(props: RowProps) {
  const { node, depth, expanded, activePath, dropTarget, onToggle, onMenu, onDropTarget, onMove } = props;
  const isOpen = expanded.has(node.path);
  // A folder's page: its existing note, or where a new one would go.
  const folderNote = node.isDir ? (node.notePath ?? defaultFolderNote(node.path)) : null;
  const isActive = node.isDir ? folderNote === activePath : node.path === activePath;

  const onClick = (e: React.MouseEvent) => {
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    if (node.isDir) {
      // Opening a folder's page also reveals its children.
      if (!isOpen) onToggle(node.path);
      useLayout.getState().openNote(folderNote!, { newTab, create: !node.notePath });
      return;
    }
    if (node.isNote) {
      useLayout.getState().openNote(node.path, { newTab: e.ctrlKey || e.metaKey || e.button === 1 });
    } else {
      ipc.openInDefaultApp(node.path).catch((err) => useUi.getState().toast(errorMessage(err), "error"));
    }
  };

  return (
    <>
      <div
        data-tree-path={node.path}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, node.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          // Only folders accept drops; stop the root container from claiming it.
          if (node.isDir && e.dataTransfer.types.includes(DND_TYPE)) {
            e.preventDefault();
            e.stopPropagation();
            onDropTarget(node.path);
          }
        }}
        onDrop={(e) => {
          if (!node.isDir) return;
          e.preventDefault();
          e.stopPropagation();
          onDropTarget(null);
          const from = e.dataTransfer.getData(DND_TYPE);
          if (from) onMove(from, node.path);
        }}
        onClick={onClick}
        onAuxClick={(e) => e.button === 1 && onClick(e)}
        onContextMenu={(e) => onMenu(e, node)}
        // Indent 12px per level; the base 8px aligns with the panel header.
        style={{ paddingLeft: 8 + depth * 16 }}
        className={`relative flex h-[30px] cursor-default items-center gap-2 rounded-md pr-2 text-[13.5px] transition-colors ${
          isActive ? "bg-accent-soft text-accent" : "text-fg/85 hover:bg-hover"
        } ${dropTarget === node.path ? "outline outline-1 -outline-offset-1 outline-accent" : ""}`}
      >
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
        ) : node.isNote ? (
          <FileText size={15} className={`shrink-0 ${isActive ? "text-accent" : "text-muted/70"}`} />
        ) : (
          <Paperclip size={15} className="shrink-0 text-muted/45" />
        )}
        <span
          className={`truncate ${node.isDir ? "font-medium text-fg/90" : node.isNote ? "" : "text-fg/45"}`}
          // Folders with written text get a subtle hint in the tooltip.
          title={node.isDir ? (node.notePath ? `Open ${node.notePath}` : "Click to write this chapter's overview") : undefined}
        >
          {/* Notes drop the ".md"; other files keep their extension so the type is clear. */}
          {node.isNote ? node.name.replace(/\.(md|markdown)$/i, "") : node.name}
        </span>
      </div>
      {node.isDir &&
        isOpen &&
        node.children.map((child) => <Row key={child.path} {...props} node={child} depth={depth + 1} />)}
    </>
  );
}
