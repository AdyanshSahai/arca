// Scripted profiling run (dev only; started when VITE_ARCA_PROFILE=1).
//
// Opens a scratch vault (VITE_ARCA_PROFILE_VAULT, never the user's), opens
// a note, and for each sidebar state types 40 characters into the editor
// exactly like keystrokes (CodeMirror "input.type" transactions). For each
// state it logs, through perf_log to the Rust process's stderr:
//   - which components rendered and how often,
//   - React commit count and total render time,
//   - CodeMirror dispatch time per keystroke (decorations etc.),
//   - time from keystroke to the next painted frame,
//   - graph data / layout recomputations,
//   - what happens during the following autosave.
// Then it closes the window.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { editorRegistry } from "../editor/registry";
import { focusedPane, useLayout } from "../store/layout";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { perfLog, resetPerf, snapshotPerf } from "./perf";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(() => r(performance.now())));

/** Polls until `get` returns something truthy (or gives up after 15 s). */
async function waitFor<T>(get: () => T | undefined | null, ms = 15000): Promise<T> {
  const end = performance.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (performance.now() > end) throw new Error("profile: timed out waiting");
    await sleep(50);
  }
}

/** React StrictMode runs effects twice in development; run only once. */
let started = false;

export async function runProfile(): Promise<void> {
  if (started) return;
  started = true;
  const vault = import.meta.env.VITE_ARCA_PROFILE_VAULT as string | undefined;
  const notePath = (import.meta.env.VITE_ARCA_PROFILE_NOTE as string | undefined) ?? "profile/Big Note.md";
  if (!vault) throw new Error("profile: set VITE_ARCA_PROFILE_VAULT to a scratch vault");

  await useVault.getState().open(vault);
  useLayout.getState().openNote(notePath);
  const paneId = focusedPane()!.id;
  const view = await waitFor(() => editorRegistry.get(paneId));
  await sleep(1500); // let the background parser and initial renders settle

  const scenarios: (PanelId | null)[] = [null, "tree", "graph", "backlinks", "search", "postits"];
  for (const panel of scenarios) {
    if (panel) useUi.getState().showPanel(panel);
    else useUi.getState().closeDrawer();
    await sleep(1500);

    // --- typing ---
    resetPerf();
    let dispatchMs = 0;
    let frameMs = 0;
    const KEYS = 40;
    // Type into the middle of the note so full-document work shows up.
    const at = view.state.doc.line(Math.max(1, Math.floor(view.state.doc.lines / 2))).to;
    for (let i = 0; i < KEYS; i++) {
      const pos = at + i;
      const t0 = performance.now();
      view.dispatch({ changes: { from: pos, insert: "x" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
      dispatchMs += performance.now() - t0;
      frameMs += (await nextFrame()) - t0;
      await sleep(30); // a fast typist: ~30 ms between keys
    }
    const typing = snapshotPerf();

    // --- the autosave that follows ---
    resetPerf();
    await sleep(1500);
    const autosave = snapshotPerf();

    await perfLog({
      scenario: panel ?? "drawer closed",
      perKeystroke: {
        cmDispatchMs: +(dispatchMs / KEYS).toFixed(2),
        toNextFrameMs: +(frameMs / KEYS).toFixed(2),
        reactCommits: +(typing.commits.count / KEYS).toFixed(2),
        reactRenderMs: +(typing.commits.ms / KEYS).toFixed(2),
      },
      renders: typing.counters,
      autosave,
    });

    // Undo the typing so every scenario starts from the same document.
    view.dispatch({ changes: { from: at, to: at + KEYS, insert: "" } });
    await sleep(1200);
  }
  await perfLog({ done: true });
  await getCurrentWindow().close();
}
