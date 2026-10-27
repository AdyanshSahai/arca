// Client-side link helpers: classifying [[targets]] and checking whether a
// note link points at an existing note. This mirrors arca-core's links.rs
// closely enough for *display* (chip colours, autocompletion); following
// a link still asks Rust, which has the authoritative resolver.

import type { NoteInfo } from "./types";

export type LinkKind = "note" | "url" | "file";

/** Same rules as `links::classify` in Rust. */
export function classifyLink(target: string): LinkKind {
  const t = target.trim();
  const lower = t.toLowerCase();
  if (t.includes("://") || lower.startsWith("mailto:") || lower.startsWith("www.")) return "url";
  if (t.startsWith("/") || t.startsWith("~/") || lower.startsWith("file:")) return "file";
  const base = t.split("#")[0];
  const ext = /\.([A-Za-z0-9]+)$/.exec(base)?.[1]?.toLowerCase();
  return ext && ext !== "md" && ext !== "markdown" ? "file" : "note";
}

/** Same as Rust's `normalize_target`: no anchor, no ".md", lower-case. */
export function normalizeTarget(target: string): string {
  return target
    .split("#")[0]
    .trim()
    .replace(/^\.\//, "")
    .toLowerCase()
    .replace(/\.(md|markdown)$/, "");
}

/** Fast existence check for note-link targets, rebuilt when the note list changes. */
export class NoteIndex {
  private stems = new Set<string>();
  private paths: string[] = [];

  constructor(notes: NoteInfo[]) {
    for (const n of notes) {
      const key = normalizeTarget(n.path);
      this.paths.push(key);
      this.stems.add(key.slice(key.lastIndexOf("/") + 1));
    }
  }

  /** True if `[[target]]` would resolve to some note. */
  has(target: string): boolean {
    const key = normalizeTarget(target);
    if (!key) return false;
    if (!key.includes("/")) return this.stems.has(key);
    return this.paths.some((p) => p === key || p.endsWith("/" + key));
  }
}
