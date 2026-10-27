// App-level actions shared by the editor, panels and keyboard shortcuts.
// They coordinate several stores, so they live outside any single one.

import { insertPostit } from "../editor/postits";
import { editorRegistry } from "../editor/registry";
import { focusedPane, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { errorMessage, ipc } from "./ipc";

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

/** Inserts a post-it into the focused editor, if there is one. */
export function insertPostitInFocused(): void {
  const pane = focusedPane();
  const view = pane && editorRegistry.get(pane.id);
  if (!view) {
    useUi.getState().toast("Open a note first to add a post-it");
    return;
  }
  void insertPostit(view);
}
