// Typed wrappers around every Tauri command defined in
// src-tauri/src/commands.rs. Components never call `invoke` directly, so a
// renamed command or argument only has to be fixed here.
//
// Tauri converts the camelCase argument keys used here to the snake_case
// parameter names on the Rust side.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppStateDto,
  Backlink,
  FileHit,
  Graph,
  LinkTarget,
  NoteInfo,
  Pin,
  PostItEntry,
  TagCount,
  TemplateInfo,
  TextHit,
  TreeNode,
  VaultInfo,
} from "./types";

export const ipc = {
  // --- app / vault lifecycle ---
  appState: () => invoke<AppStateDto>("app_state"),
  saveUi: (ui: unknown) => invoke<void>("save_ui", { ui }),
  openVault: (path: string) => invoke<VaultInfo>("open_vault", { path }),

  // --- files ---
  vaultTree: () => invoke<TreeNode>("vault_tree"),
  listNotes: () => invoke<NoteInfo[]>("list_notes"),
  readNote: (path: string) => invoke<string>("read_note", { path }),
  writeNote: (path: string, content: string) => invoke<void>("write_note", { path, content }),
  createNote: (path: string) => invoke<string>("create_note", { path }),
  createFolder: (path: string) => invoke<void>("create_folder", { path }),
  renameEntry: (from: string, to: string) => invoke<void>("rename_entry", { from, to }),
  trashEntry: (path: string) => invoke<string>("trash_entry", { path }),

  // --- search ---
  searchFiles: (query: string, limit?: number) => invoke<FileHit[]>("search_files", { query, limit }),
  searchText: (query: string, scope?: string, limit?: number) =>
    invoke<TextHit[]>("search_text", { query, scope, limit }),
  searchTopic: (kind: "tag" | "link", term: string, limit?: number) =>
    invoke<TextHit[]>("search_topic", { kind, term, limit }),
  listTags: () => invoke<TagCount[]>("list_tags"),

  // --- links, graph, post-its ---
  backlinks: (path: string) => invoke<Backlink[]>("backlinks", { path }),
  graph: () => invoke<Graph>("graph"),
  listPostits: () => invoke<PostItEntry[]>("list_postits"),
  updatePostit: (path: string, id: string, text: string, color?: string) =>
    invoke<string>("update_postit", { path, id, text, color }),
  newPostit: (color?: string, text?: string) => invoke<string>("new_postit", { color, text }),
  followLink: (target: string, from: string) => invoke<LinkTarget>("follow_link", { target, from }),
  openInDefaultApp: (path: string) => invoke<void>("open_in_default_app", { path }),

  // --- export ---
  /** Returns how many notes were written to `dest`. */
  exportNotes: (scope: string, format: "html" | "markdown", dest: string, open: boolean) =>
    invoke<number>("export_notes", { scope, format, dest, open }),

  // --- templates ---
  listTemplates: () => invoke<TemplateInfo[]>("list_templates"),
  createFromTemplate: (path: string, content: string) => invoke<string>("create_from_template", { path, content }),

  // --- pins ---
  getPins: () => invoke<Pin[]>("get_pins"),
  setPins: (pins: Pin[]) => invoke<void>("set_pins", { pins }),
};

/** Turns whatever a failed `invoke` threw into a displayable message. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
