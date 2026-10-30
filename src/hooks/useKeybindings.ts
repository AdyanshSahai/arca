// Global keyboard shortcuts.
//
// Registered in the *capture* phase on window, so they win over CodeMirror's
// own keymap (which would otherwise swallow e.g. Ctrl+Shift+( or Ctrl+E).
// Anything not listed here falls through to the focused editor/input.
//
//   Ctrl+Tab / Ctrl+Shift+Tab   next / previous tab
//   Ctrl+1…9                    jump to tab N
//   Ctrl+T, Ctrl+W              new tab, close tab
//   Ctrl+Shift+(                split focused pane left/right   (Konsole)
//   Ctrl+Shift+)                split focused pane top/bottom   (Konsole)
//   Ctrl+D / Ctrl+Shift+X       close focused pane (Ctrl+D as in Konsole)
//   Ctrl+Alt+Arrow              focus the pane in that direction
//   Ctrl+Shift+PageUp/PageDown  move the focused pane to the previous / next tab
//   Ctrl+Shift+H                move the focused pane into a new tab (Konsole's "detach")
//   Ctrl+E                      live preview ↔ raw markdown
//   Ctrl+Shift+E                reading ↔ writing mode (whole app)
//   Ctrl+P / Ctrl+O             command palette (notes + actions)
//   Ctrl+Shift+P                command palette, actions only
//   Ctrl+Shift+F                full-text search
//   Ctrl+N                      new note (in the focused note's folder)
//   Ctrl+Alt+P                  insert post-it at the cursor
//   Ctrl+B                      toggle the drawer (bold instead while writing in a note)
//   Ctrl+,                      settings
//   Ctrl+S                      save now (autosave runs anyway)
//   Alt+1…9                     open pinned shortcut N

import { useEffect } from "react";
import { insertPostitInFocused } from "../lib/actions";
import { dirName } from "../lib/paths";
import { useBuffers } from "../store/buffers";
import { focusedPane, paneIds, useLayout } from "../store/layout";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";

type Dir = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Moves focus to the nearest visible pane in the given direction, using the
 * panes' on-screen rectangles (works for any split arrangement).
 */
function focusNeighbour(dir: Dir) {
  const layout = useLayout.getState();
  const tab = layout.tabs.find((t) => t.id === layout.activeTab);
  if (!tab) return;
  const rectOf = (id: string) => document.querySelector(`[data-pane-id="${id}"]`)?.getBoundingClientRect();
  const from = rectOf(tab.focusedPane);
  if (!from) return;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;

  let best: { id: string; dist: number } | null = null;
  for (const id of paneIds(tab.root)) {
    if (id === tab.focusedPane) continue;
    const r = rectOf(id);
    if (!r) continue;
    // Must lie on the requested side of the current pane.
    const ok =
      (dir === "ArrowLeft" && r.right <= from.left + 1) ||
      (dir === "ArrowRight" && r.left >= from.right - 1) ||
      (dir === "ArrowUp" && r.bottom <= from.top + 1) ||
      (dir === "ArrowDown" && r.top >= from.bottom - 1);
    if (!ok) continue;
    const dist = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (!best || dist < best.dist) best = { id, dist };
  }
  if (best) layout.focusPane(best.id);
}

/** The panel Ctrl+B reopens: whichever was open last. */
let lastPanel: PanelId = "tree";

export function useKeybindings() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const layout = useLayout.getState();
      const ui = useUi.getState();
      const pane = focusedPane();
      if (ui.panel) lastPanel = ui.panel;

      // A note is waiting for a pane: 1–9 picks by number, Enter picks the
      // focused pane, Esc cancels. Nothing else runs until it's answered.
      if (ui.paneChoice) {
        const tab = layout.tabs.find((t) => t.id === layout.activeTab);
        const ids = tab ? paneIds(tab.root) : [];
        const choice = ui.paneChoice;
        // Match physical keys (Digit1 / Numpad1 / KeyN…), not e.key: with an
        // input method running (IBus/Fcitx on KDE), keys typed while a text
        // field had focus can arrive as "Process" / "Unidentified".
        const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
        const letter = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ?? key;
        let target: string | undefined;
        if (digit) target = ids[Number(digit) - 1];
        else if (e.key === "Enter" || e.code === "NumpadEnter") target = tab?.focusedPane;
        if (target) {
          layout.openNoteIn(target, choice.path, { line: choice.line, create: choice.create });
        } else if (letter === "n") {
          // N = a new pane of its own (split right).
          layout.openNoteInNewPane(choice.path, { line: choice.line, create: choice.create });
        } else if (letter === "t") {
          // T = a new tab.
          ui.cancelPaneChoice();
          layout.openNote(choice.path, { newTab: true, line: choice.line, create: choice.create });
        } else if (e.key === "Escape") ui.cancelPaneChoice();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      /** Marks the event handled. */
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Tabs.
      if (mod && e.key === "Tab") {
        take();
        return layout.cycleTab(e.shiftKey ? -1 : 1);
      }
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const tab = layout.tabs[Number(e.key) - 1];
        if (tab) {
          take();
          layout.activateTab(tab.id);
        }
        return;
      }
      // Ctrl+Shift+9/0 produce "(" / ")" on US layouts; also accept the key codes
      // so other layouts where those characters move still work.
      if (mod && e.shiftKey && (e.key === "(" || e.code === "Digit9")) {
        take();
        return layout.split("row");
      }
      if (mod && e.shiftKey && (e.key === ")" || e.code === "Digit0")) {
        take();
        return layout.split("col");
      }
      // Ctrl+D overrides CodeMirror's "select next occurrence" on purpose:
      // it's Konsole's close-the-terminal key.
      if (mod && !e.altKey && ((e.shiftKey && key === "x") || (!e.shiftKey && key === "d"))) {
        take();
        if (pane) layout.closePane(pane.id);
        return;
      }
      if (mod && e.shiftKey && (e.key === "PageUp" || e.key === "PageDown")) {
        take();
        return layout.movePaneBy(e.key === "PageDown" ? 1 : -1);
      }
      if (mod && e.shiftKey && !e.altKey && key === "h") {
        take();
        if (pane) layout.movePane(pane.id, "new");
        return;
      }
      if (mod && e.altKey && e.key.startsWith("Arrow")) {
        take();
        return focusNeighbour(e.key as Dir);
      }
      if (mod && !e.shiftKey && key === "t") {
        take();
        return layout.newTab();
      }
      if (mod && !e.shiftKey && key === "w") {
        take();
        return layout.closeTab(layout.activeTab);
      }

      // Editor.
      if (mod && e.shiftKey && !e.altKey && key === "e") {
        take();
        return ui.toggleReading();
      }
      if (mod && !e.altKey && key === "e") {
        take();
        if (pane) layout.toggleMode(pane.id);
        return;
      }
      if (mod && e.altKey && key === "p") {
        take();
        return insertPostitInFocused();
      }
      if (mod && !e.shiftKey && key === "s") {
        take();
        void useBuffers.getState().flushAll();
        return;
      }

      // Command palette / search.
      if (mod && !e.shiftKey && !e.altKey && (key === "p" || key === "o")) {
        take();
        return ui.openPalette("");
      }
      if (mod && e.shiftKey && !e.altKey && key === "p") {
        take();
        return ui.openPalette(">");
      }
      if (mod && e.shiftKey && key === "f") {
        take();
        return ui.requestSearch("text");
      }
      if (mod && !e.shiftKey && key === "n") {
        take();
        if (useVault.getState().info) useVault.getState().promptNewNote(pane?.path ? dirName(pane.path) : "");
        return;
      }
      if (mod && !e.shiftKey && e.key === ",") {
        take();
        return ui.openSettings();
      }
      // In a note being written, Ctrl+B is bold (Word habit), so let it
      // through to the editor's own keymap (editor/format.ts).
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.(".cm-editor");
      if (mod && !e.shiftKey && key === "b" && !(inEditor && !ui.reading)) {
        take();
        return ui.panel ? ui.closeDrawer() : ui.showPanel(lastPanel);
      }

      // Pins.
      if (e.altKey && !mod && /^[1-9]$/.test(e.key)) {
        // Counts the pins shown directly on the bar (not those inside groups).
        const pin = useVault.getState().pins.filter((p) => !p.group)[Number(e.key) - 1];
        if (pin) {
          take();
          useVault.getState().activatePin(pin);
        }
      }
    };
    window.addEventListener("keydown", onKey, true); // `true` = capture phase
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
