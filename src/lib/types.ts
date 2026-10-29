// Shapes of the data the Rust backend returns. These mirror the `Serialize`
// structs in crates/arca-core and src-tauri/src/commands.rs; keep them in
// sync when either side changes.

/** One entry of the chapter tree (vault folders mirror real directories). */
export interface TreeNode {
  name: string;
  /** Vault-relative, forward slashes; "" for the vault root. */
  path: string;
  isDir: boolean;
  isNote: boolean;
  children: TreeNode[];
  /**
   * Folders only: the folder's own note (hardware/hardware.md,
   * hardware/index.md, or hardware.md beside it), or null if it has none.
   */
  notePath: string | null;
}

export interface NoteInfo {
  path: string;
  title: string;
}

export interface VaultInfo {
  root: string;
  name: string;
}

export interface AppStateDto {
  vaultPath: string | null;
  ui: unknown;
}

/** Highlight ranges are UTF-16 offsets, so `text.slice(a, b)` works directly. */
export interface Snippet {
  text: string;
  highlights: [number, number][];
}

export interface TextHit {
  path: string;
  title: string;
  score: number;
  snippet: Snippet;
}

export interface FileHit {
  path: string;
  score: number;
  /** UTF-16 indices of matched characters in `path`. */
  indices: number[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface Backlink {
  source: string;
  title: string;
  line: number;
  context: string;
}

export interface GraphNode {
  id: string;
  label: string;
  folder: string;
  /** A [[link]] target with no note behind it yet. */
  ghost: boolean;
  degree: number;
  /** Unique lower-case tags (for the global view's tag filter). */
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PostItEntry {
  path: string;
  noteTitle: string;
  id: string;
  color: string;
  text: string;
  line: number;
}

/** Result of following a [[link]]. URLs and files were already opened by Rust. */
export type LinkTarget =
  | { kind: "note"; path: string }
  | { kind: "missing"; target: string; suggested: string }
  | { kind: "url"; url: string }
  | { kind: "file"; path: string };

export interface TemplateInfo {
  /** Display name, e.g. "Study Log". */
  name: string;
  /** Vault-relative path inside .arca/templates/. */
  path: string;
}

/** What a rename did to [[links]] elsewhere. */
export interface RenameReport {
  notes: number;
  links: number;
}

/** One item in the vault's trash. */
export interface TrashEntry {
  /** Path inside .trash/ (its id). */
  trashPath: string;
  /** Where it was before being trashed. */
  original: string;
  isDir: boolean;
  /** Milliseconds since 1970. */
  deletedMs: number;
}

export type PinKind = "note" | "folder" | "file";

export interface Pin {
  id: string;
  label: string;
  path: string;
  kind: PinKind;
}
