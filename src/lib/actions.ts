// App-level actions shared by the editor, panels and keyboard shortcuts.
// They coordinate several stores, so they live outside any single one.

import { insertPostit } from "../editor/postits";
import { editorRegistry } from "../editor/registry";
import { contextPane, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { errorMessage, ipc } from "./ipc";
import { defaultFolderNote } from "./paths";
import type { TreeNode } from "./types";

/**
 * Follows a [[link]] clicked in note `from`. Notes open in the focused pane.
 * URLs and files were already opened by Rust. A missing note prompts to
 * create it.
 */
export async function followLink(target: string, from: string): Promise<void> {
  try {
    const res = await ipc.followLink(target, from);
    if (res.kind === "note") {
      useLayout.getState().openNote(res.path);
    } else if (res.kind === "missing") {
      if (!res.suggested) {
        useUi.getState().toast(`Not found: ${res.target}`, "error");
        return;
      }
      useUi.getState().openDialog({
        kind: "confirm",
        title: "Create note?",
        message: `“${res.target}” doesn't exist yet. Create ${res.suggested}?`,
        confirmText: "Create",
        onConfirm: () => useVault.getState().createAndOpen(res.suggested),
      });
    }
  } catch (err) {
    useUi.getState().toast(errorMessage(err), "error");
  }
}

/**
 * The one way every place outside the panes opens a note: search, graph,
 * chapter tree, backlinks, post-its, command palette and pins all call
 * this, so they behave identically. Depending on Settings → "Notes opened
 * from the sidebar", it asks which pane should take the note (or a new
 * pane / new tab), or uses the focused pane. Ctrl+click → new tab.
 */
export function openFromSidebar(path: string, opts: { line?: number; newTab?: boolean; create?: boolean } = {}): void {
  useLayout.getState().openNote(path, { ...opts, pick: true });
}

/** Finds the tree node for a folder path ("" = vault root), if it exists. */
function findFolder(node: TreeNode | null, dir: string): TreeNode | null {
  if (!node) return null;
  if (node.path === dir) return node;
  for (const child of node.children) {
    if (child.isDir && (dir === child.path || dir.startsWith(child.path + "/"))) return findFolder(child, dir);
  }
  return null;
}

/**
 * Opens a folder's own page (the dual-purpose folder note) in the focused
 * pane, creating it lazily if it doesn't exist yet. If the chapter tree is
 * showing, it also reveals the folder there.
 */
export function openFolder(dir: string): void {
  const node = findFolder(useVault.getState().tree, dir);
  const note = node?.notePath ?? defaultFolderNote(dir);
  useLayout.getState().openNote(note, { create: !node?.notePath });
  if (useUi.getState().panel === "tree") {
    window.dispatchEvent(new CustomEvent("arca:reveal-folder", { detail: dir }));
  }
}

/** Inserts a post-it into the focused editor, if there is one. */
export function insertPostitInFocused(): void {
  // The note being worked on, even if a view pane has focus right now.
  const pane = contextPane();
  const view = pane && editorRegistry.get(pane.id);
  if (!view) {
    useUi.getState().toast("Open a note first to add a post-it");
    return;
  }
  if (pane?.reading) {
    useUi.getState().toast("Switch to writing mode (Ctrl+Shift+E) to add a post-it");
    return;
  }
  void insertPostit(view);
}
