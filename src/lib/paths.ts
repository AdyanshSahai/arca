// Helpers for vault-relative paths ("hardware/cpu.md"). Paths from Rust
// always use forward slashes, so plain string ops are enough.

/** "a/b/c.md" → "c.md" */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** "a/b/c.md" → "c" (extension stripped). */
export function stem(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  // A leading dot (".hidden") is part of the name, not an extension.
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "a/b/c.md" → "a/b", "c.md" → "" */
export function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Joins path segments, skipping empty ones. */
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function isNotePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Rewrites `path` after `from` was renamed to `to`. Covers both the entry
 * itself and anything inside it when it was a folder. Returns `null` if
 * `path` wasn't affected.
 */
export function remapPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(from + "/")) return to + path.slice(from.length);
  return null;
}

/**
 * Where a new folder note for `dir` is created: "a/hardware" →
 * "a/hardware/hardware.md". Mirrors `default_folder_note` in vault.rs.
 */
export function defaultFolderNote(dir: string): string {
  return `${dir}/${baseName(dir)}.md`;
}

/** True if `path` is `dir` itself or lives anywhere under it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + "/");
}
