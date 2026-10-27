// Every action the command palette can run. Each command is a label, an
// optional shortcut hint, and a `run` function that drives the stores; the
// palette itself knows nothing about what they do.

import { open } from "@tauri-apps/plugin-dialog";
import { editorRegistry } from "../editor/registry";
import { useBuffers } from "../store/buffers";
import { focusedPane, useLayout } from "../store/layout";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { insertPostitInFocused } from "./actions";
import { dirName } from "./paths";

export interface Command {
  id: string;
  label: string;
  /** Grouping shown at the right of the row ("Pane", "View"…). */
  group: string;
  shortcut?: string;
  run: () => void;
}

/** Runs `fn` with the focused pane's note path, or toasts if there isn't one. */
function withNote(fn: (path: string) => void) {
  return () => {
    const path = focusedPane()?.path;
    if (path) fn(path);
    else useUi.getState().toast("Open a note first");
  };
}

const panel = (id: PanelId, label: string): Command => ({
  id: `panel.${id}`,
  label: `Show ${label}`,
  group: "View",
  run: () => useUi.getState().showPanel(id),
});

/**
 * Builds the command list. A function rather than a constant so each call
 * reads the stores' current state.
 */
export function allCommands(): Command[] {
  const layout = useLayout.getState();
  const ui = useUi.getState();
  const vault = useVault.getState();
  return [
    { id: "note.new", label: "New note", group: "Note", shortcut: "Ctrl+N", run: () => vault.promptNewNote(dirName(focusedPane()?.path ?? "")) },
    {
      id: "note.template",
      label: "New note from template…",
      group: "Note",
      run: () => ui.openTemplatePicker(dirName(focusedPane()?.path ?? "")),
    },
    { id: "folder.new", label: "New chapter folder", group: "Note", run: () => vault.promptNewFolder(dirName(focusedPane()?.path ?? "")) },
    { id: "note.rename", label: "Rename current note", group: "Note", run: withNote((p) => vault.promptRename(p)) },
    { id: "note.trash", label: "Move current note to trash", group: "Note", run: withNote((p) => vault.confirmTrash(p)) },
    { id: "note.pin", label: "Pin current note", group: "Note", run: withNote((p) => void vault.addPin(p, "note")) },
    { id: "note.postit", label: "Insert post-it", group: "Note", shortcut: "Ctrl+Alt+P", run: insertPostitInFocused },
    { id: "note.save", label: "Save all notes now", group: "Note", shortcut: "Ctrl+S", run: () => void useBuffers.getState().flushAll() },
    {
      id: "note.reveal",
      label: "Reveal current note in chapter tree",
      group: "Note",
      run: withNote((p) => {
        ui.showPanel("tree");
        window.dispatchEvent(new CustomEvent("arca:reveal-folder", { detail: dirName(p) }));
      }),
    },
    { id: "pane.split.row", label: "Split pane left / right", group: "Pane", shortcut: "Ctrl+Shift+(", run: () => layout.split("row") },
    { id: "pane.split.col", label: "Split pane top / bottom", group: "Pane", shortcut: "Ctrl+Shift+)", run: () => layout.split("col") },
    { id: "pane.close", label: "Close pane", group: "Pane", shortcut: "Ctrl+Shift+X", run: () => { const p = focusedPane(); if (p) layout.closePane(p.id); } },
    { id: "pane.mode", label: "Toggle live preview / raw markdown", group: "Pane", shortcut: "Ctrl+E", run: () => { const p = focusedPane(); if (p) layout.toggleMode(p.id); } },
    { id: "pane.find", label: "Find in note", group: "Pane", shortcut: "Ctrl+F", run: () => {
      // Opens CodeMirror's own search panel in the focused editor.
      const p = focusedPane();
      const view = p && editorRegistry.get(p.id);
      if (view) void import("@codemirror/search").then(({ openSearchPanel }) => openSearchPanel(view));
    } },
    { id: "tab.new", label: "New tab", group: "Tab", shortcut: "Ctrl+T", run: () => layout.newTab() },
    { id: "tab.close", label: "Close tab", group: "Tab", shortcut: "Ctrl+W", run: () => layout.closeTab(layout.activeTab) },
    { id: "tab.next", label: "Next tab", group: "Tab", shortcut: "Ctrl+Tab", run: () => layout.cycleTab(1) },
    panel("tree", "chapters"),
    panel("graph", "graph"),
    panel("backlinks", "backlinks"),
    panel("postits", "post-its"),
    { id: "search.text", label: "Search text in vault", group: "View", shortcut: "Ctrl+Shift+F", run: () => ui.requestSearch("text") },
    { id: "search.tags", label: "Browse tags", group: "View", run: () => ui.requestSearch("topic", "") },
    { id: "drawer.toggle", label: "Toggle sidebar drawer", group: "View", shortcut: "Ctrl+B", run: () => (ui.panel ? ui.closeDrawer() : ui.showPanel("tree")) },
    { id: "drawer.quarter", label: "Drawer: quarter width", group: "View", run: () => ui.setDrawerSize("quarter") },
    { id: "drawer.half", label: "Drawer: half width", group: "View", run: () => ui.setDrawerSize("half") },
    { id: "drawer.full", label: "Drawer: full view", group: "View", run: () => ui.setDrawerSize("full") },
    {
      id: "vault.open",
      label: "Open another vault…",
      group: "Vault",
      run: async () => {
        const dir = await open({ directory: true, multiple: false, title: "Open vault folder" });
        if (typeof dir === "string") await useVault.getState().open(dir);
      },
    },
    { id: "vault.refresh", label: "Re-scan vault", group: "Vault", run: () => void vault.refresh() },
    { id: "export", label: "Export notes…", group: "Vault", run: () => ui.openExport() },
  ];
}
