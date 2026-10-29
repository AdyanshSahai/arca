//! Sandboxed access to the vault folder.
//!
//! A *vault* is just a directory the user picked. Every path that crosses
//! the IPC boundary is **vault-relative** and uses forward slashes
//! (`hardware/cpu.md`). This module is the only place that turns those into
//! real absolute paths, and it refuses anything that would end up outside
//! the vault root. That is the main guard against the frontend (or a bug)
//! writing somewhere it shouldn't.
//!
//! Nested folders are the "chapter" hierarchy, so [`Vault::tree`] simply
//! mirrors the directory structure.
//!
//! ## Folder notes
//!
//! A folder can carry its own note: an overview for the whole chapter. The
//! tree attaches it to the folder node (`note_path`) and hides it from the
//! child list, so clicking the folder opens its text while the arrow
//! expands its children. For a folder `hardware/` the first match wins:
//!
//! 1. `hardware/hardware.md`, which is also what Arca creates for new
//!    folder notes,
//! 2. `hardware/index.md`,
//! 3. `hardware.md` sitting next to the folder.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use walkdir::WalkDir;

use crate::error::{CoreError, Result};

/// Folder (inside the vault) where deleted entries are moved instead of
/// being destroyed, so a misclick is always recoverable.
pub const TRASH_DIR: &str = ".trash";

/// Per-folder directory for attachments (pasted images, dropped files).
/// It sits next to the notes that use it, so links stay short
/// (`.assets/diagram.png`) and move with the chapter. Being hidden, it
/// stays out of the tree.
pub const ASSETS_DIR: &str = ".assets";

/// Turns an arbitrary file name into a safe, link-friendly one: path parts
/// are dropped, spaces become dashes, and anything unusual is removed.
pub fn sanitize_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut out = String::with_capacity(base.len());
    for c in base.chars() {
        if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-'); // spaces and symbols collapse into one dash
        }
    }
    // "photo-.png" → "photo.png": no dash right before the extension.
    let out = out.replace("-.", ".").trim_matches(|c| c == '-' || c == '.').to_string();
    if out.is_empty() { "file".to_string() } else { out }
}

/// File extensions treated as notes.
const NOTE_EXTENSIONS: &[&str] = &["md", "markdown"];

/// Custom order of folders' children (drag-to-reorder in the tree):
/// `{ "<folder path>": ["child name", …] }`, "" being the vault root.
/// Children not listed follow in the default order (folders first, A–Z).
const ORDER_FILE: &str = ".arca/order.json";

/// A folder path → its children's names in the user's order.
pub type OrderMap = std::collections::BTreeMap<String, Vec<String>>;

/// File inside `.trash/` mapping each trashed item to where it came from.
const TRASH_INDEX: &str = ".index.json";

/// One item in the trash, for the Trash window.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// Vault-relative path inside `.trash/` (the item's id).
    pub trash_path: String,
    /// Where it was before it was trashed (vault-relative). Items trashed
    /// before the index existed fall back to the vault root.
    pub original: String,
    pub is_dir: bool,
    /// Milliseconds since 1970 when it was trashed.
    pub deleted_ms: u64,
}

/// One entry of the chapter tree sent to the sidebar.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Display name (the file/folder name, extension included).
    pub name: String,
    /// Vault-relative path with forward slashes; `""` for the root.
    pub path: String,
    pub is_dir: bool,
    /// `true` for `.md` files, `false` for folders and other files (PDFs etc.).
    pub is_note: bool,
    /// Children, sorted folders-first then alphabetically. Empty for files.
    pub children: Vec<TreeNode>,
    /// Folders only: the folder's own note, if one exists (see the module
    /// docs on folder notes). That note is not repeated in `children`.
    pub note_path: Option<String>,
}

/// Where a brand-new folder note for `dir` should be created
/// (`"a/hardware"` → `"a/hardware/hardware.md"`).
pub fn default_folder_note(dir: &str) -> String {
    let name = dir.rsplit('/').next().unwrap_or(dir);
    format!("{dir}/{name}.md")
}

/// Handle on an opened vault directory.
#[derive(Debug, Clone)]
pub struct Vault {
    /// Canonical absolute path of the vault root (symlinks resolved), so the
    /// `starts_with` containment checks below compare like with like.
    root: PathBuf,
}

/// Plain-text extensions that Arca can open and edit like notes. They are
/// not indexed or linked; the UI offers to convert them to Markdown.
const TEXT_EXTENSIONS: &[&str] = &["txt", "text"];

/// Returns `true` for plain-text files ([`TEXT_EXTENSIONS`]).
pub fn is_text_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXTENSIONS.iter().any(|n| e.eq_ignore_ascii_case(n)))
        .unwrap_or(false)
}

/// Returns `true` if a path has one of the [`NOTE_EXTENSIONS`].
pub fn is_note_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| NOTE_EXTENSIONS.iter().any(|n| e.eq_ignore_ascii_case(n)))
        .unwrap_or(false)
}

/// Hidden entries (`.git`, `.trash`, editor swap files…) never appear in the
/// tree or the index.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

impl Vault {
    /// Opens an existing directory as a vault.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        if !root.is_dir() {
            return Err(CoreError::NotFound(root.display().to_string()));
        }
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    /// Absolute path of the vault root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // ------------------------------------------------------------------
    // Path handling
    // ------------------------------------------------------------------

    /// Converts a vault-relative path into an absolute one, rejecting any
    /// path that could escape the vault.
    ///
    /// Only plain components are allowed: `..`, absolute paths, and Windows
    /// drive prefixes are errors. Symlinks are checked separately by
    /// [`Self::ensure_inside`], since that needs the file to exist.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let mut out = self.root.clone();
        for comp in Path::new(rel).components() {
            match comp {
                Component::Normal(part) => out.push(part),
                // "./notes" is harmless, so just skip the dot.
                Component::CurDir => {}
                _ => return Err(CoreError::PathEscape(rel.to_string())),
            }
        }
        Ok(out)
    }

    /// Follows symlinks on an existing path and confirms it still lives
    /// inside the vault. Used before every destructive operation.
    fn ensure_inside(&self, abs: &Path) -> Result<()> {
        let real = abs.canonicalize()?;
        if real.starts_with(&self.root) {
            Ok(())
        } else {
            Err(CoreError::PathEscape(abs.display().to_string()))
        }
    }

    /// Like [`Self::ensure_inside`] but for a path that may not exist yet:
    /// we check the nearest existing ancestor instead.
    fn ensure_parent_inside(&self, abs: &Path) -> Result<()> {
        let mut probe = abs.parent();
        while let Some(dir) = probe {
            if dir.exists() {
                return self.ensure_inside(dir);
            }
            probe = dir.parent();
        }
        Err(CoreError::PathEscape(abs.display().to_string()))
    }

    /// Absolute path → vault-relative forward-slash path. Returns `None` for
    /// paths outside the vault (e.g. stray watcher events).
    pub fn relativize(&self, abs: &Path) -> Option<String> {
        let rel = abs.strip_prefix(&self.root).ok()?;
        // Path components joined with "/" whatever the host OS uses.
        let parts: Vec<_> = rel
            .components()
            .filter_map(|c| match c {
                Component::Normal(p) => p.to_str(),
                _ => None,
            })
            .collect();
        Some(parts.join("/"))
    }

    /// `true` if any component of a vault-relative path is hidden. The
    /// watcher uses this to ignore `.trash/` and `.git/` churn.
    pub fn is_hidden_rel(rel: &str) -> bool {
        rel.split('/').any(is_hidden)
    }

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    /// Builds the whole chapter tree (folders mirror real directories).
    pub fn tree(&self) -> Result<TreeNode> {
        let order = self.order();
        let mut root = self.tree_at(&self.root, &order)?;
        // Show the vault folder's own name at the top instead of "".
        root.name = self
            .root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(root)
    }

    /// Recursive helper for [`Self::tree`].
    fn tree_at(&self, dir: &Path, order: &OrderMap) -> Result<TreeNode> {
        let mut children = Vec::new();
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden(&name) {
                continue;
            }
            let path = entry.path();
            // `file_type()` does not follow symlinks; `path.is_dir()` does,
            // so linked folders still show up as folders.
            if path.is_dir() {
                children.push(self.tree_at(&path, order)?);
            } else {
                children.push(TreeNode {
                    is_note: is_note_path(&path),
                    path: self.relativize(&path).unwrap_or_default(),
                    name,
                    is_dir: false,
                    children: Vec::new(),
                    note_path: None,
                });
            }
        }

        // Pattern 3: a sibling "<folder>.md" next to a folder without an
        // inner note becomes that folder's note and leaves this listing.
        let sibling_notes: Vec<(usize, String)> = children
            .iter()
            .enumerate()
            .filter(|(_, c)| c.is_dir && c.note_path.is_none())
            .filter_map(|(i, c)| {
                let wanted = format!("{}.md", c.name).to_lowercase();
                children
                    .iter()
                    .find(|f| f.is_note && f.name.to_lowercase() == wanted)
                    .map(|f| (i, f.path.clone()))
            })
            .collect();
        for (i, note) in sibling_notes {
            children[i].note_path = Some(note.clone());
            children.retain(|c| c.path != note);
        }
        // Folders first, then case-insensitive alphabetical order…
        children.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        // …unless the user arranged this folder: listed names come first, in
        // their order, then everything else as above (the sort is stable).
        if let Some(list) = order.get(&self.relativize(dir).unwrap_or_default()) {
            children.sort_by_key(|c| list.iter().position(|n| *n == c.name).unwrap_or(usize::MAX));
        }
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let path = self.relativize(dir).unwrap_or_default();

        // Patterns 1 and 2: a note inside the folder named after it, or
        // index.md. The vault root has no node of its own to attach to,
        // so its index.md stays a normal visible note.
        let mut note_path = None;
        if !path.is_empty() {
            let own = format!("{name}.md").to_lowercase();
            let pos = children
                .iter()
                .position(|c| c.is_note && c.name.to_lowercase() == own)
                .or_else(|| children.iter().position(|c| c.is_note && c.name.eq_ignore_ascii_case("index.md")));
            if let Some(pos) = pos {
                note_path = Some(children.remove(pos).path);
            }
        }

        Ok(TreeNode {
            name,
            path,
            is_dir: true,
            is_note: false,
            children,
            note_path,
        })
    }

    /// Every note in the vault as vault-relative paths, sorted. Hidden
    /// folders are skipped without descending into them.
    pub fn list_notes(&self) -> Vec<String> {
        let mut notes: Vec<String> = WalkDir::new(&self.root)
            .follow_links(true)
            .into_iter()
            // `filter_entry` prunes whole subtrees; depth 0 is the root itself,
            // which must never be filtered even if its own name starts with ".".
            .filter_entry(|e| e.depth() == 0 || !is_hidden(&e.file_name().to_string_lossy()))
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && is_note_path(e.path()))
            .filter_map(|e| self.relativize(e.path()))
            .collect();
        notes.sort();
        notes
    }

    // ------------------------------------------------------------------
    // Reading and writing
    // ------------------------------------------------------------------

    /// Reads a note as UTF-8 text.
    pub fn read_note(&self, rel: &str) -> Result<String> {
        let abs = self.resolve(rel)?;
        if !abs.is_file() {
            return Err(CoreError::NotFound(rel.to_string()));
        }
        self.ensure_inside(&abs)?;
        Ok(fs::read_to_string(abs)?)
    }

    /// Writes a note atomically: the text goes to a hidden temp file next to
    /// the target, which is then renamed over it. A crash mid-write can
    /// therefore never leave a half-written note behind.
    pub fn write_note(&self, rel: &str, content: &str) -> Result<()> {
        let abs = self.resolve(rel)?;
        self.ensure_parent_inside(&abs)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        let file_name = abs
            .file_name()
            .ok_or_else(|| CoreError::InvalidName(rel.to_string()))?
            .to_string_lossy();
        // Leading "." keeps the temp file out of the tree and the watcher.
        let tmp = abs.with_file_name(format!(".{file_name}.arca-tmp"));
        fs::write(&tmp, content)?;
        fs::rename(&tmp, &abs)?;
        Ok(())
    }

    /// Creates a new empty note. A missing `.md` extension is added, and the
    /// note starts with a level-1 heading named after the file.
    ///
    /// Returns the final vault-relative path.
    pub fn create_note(&self, rel: &str) -> Result<String> {
        validate_rel(rel)?;
        let rel = if is_note_path(Path::new(rel)) {
            rel.to_string()
        } else {
            format!("{rel}.md")
        };
        let abs = self.resolve(&rel)?;
        if abs.exists() {
            return Err(CoreError::AlreadyExists(rel));
        }
        let title = abs
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        self.write_note(&rel, &format!("# {title}\n\n"))?;
        Ok(rel)
    }

    /// Creates a folder (chapter), including any missing parents.
    pub fn create_folder(&self, rel: &str) -> Result<()> {
        validate_rel(rel)?;
        let abs = self.resolve(rel)?;
        if abs.exists() {
            return Err(CoreError::AlreadyExists(rel.to_string()));
        }
        self.ensure_parent_inside(&abs)?;
        fs::create_dir_all(abs)?;
        Ok(())
    }

    /// Renames or moves a file or folder inside the vault. Never overwrites.
    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        validate_rel(to)?;
        let src = self.resolve(from)?;
        let dst = self.resolve(to)?;
        if !src.exists() {
            return Err(CoreError::NotFound(from.to_string()));
        }
        if dst.exists() {
            return Err(CoreError::AlreadyExists(to.to_string()));
        }
        self.ensure_inside(&src)?;
        self.ensure_parent_inside(&dst)?;
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(src, dst)?;
        self.follow_rename_in_order(from, to)?;
        Ok(())
    }

    /// The custom tree order (empty if never arranged or unreadable).
    pub fn order(&self) -> OrderMap {
        fs::read_to_string(self.root.join(ORDER_FILE))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save_order(&self, order: &OrderMap) -> Result<()> {
        let path = self.root.join(ORDER_FILE);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(order).map_err(|e| std::io::Error::other(e.to_string()))?;
        fs::write(path, json)?;
        Ok(())
    }

    /// Sets the order of `dir`'s children (names, not paths).
    pub fn set_order(&self, dir: &str, names: Vec<String>) -> Result<()> {
        if !dir.is_empty() {
            self.resolve(dir)?; // validate: no escaping the vault
        }
        let mut order = self.order();
        order.insert(dir.to_string(), names);
        self.save_order(&order)
    }

    /// Keeps the custom order in step with a rename/move: within the same
    /// folder the entry keeps its place under its new name; moved elsewhere
    /// it leaves the old list. A renamed folder's own list moves with it.
    fn follow_rename_in_order(&self, from: &str, to: &str) -> Result<()> {
        let mut order = self.order();
        if order.is_empty() {
            return Ok(());
        }
        let (from_dir, from_name) = from.rsplit_once('/').unwrap_or(("", from));
        let (to_dir, to_name) = to.rsplit_once('/').unwrap_or(("", to));
        if let Some(list) = order.get_mut(from_dir) {
            if let Some(i) = list.iter().position(|n| n == from_name) {
                if from_dir == to_dir {
                    list[i] = to_name.to_string();
                } else {
                    list.remove(i);
                }
            }
        }
        // The folder's (and its sub-folders') lists follow it.
        let moved: Vec<(String, Vec<String>)> = order
            .iter()
            .filter(|(k, _)| *k == from || k.starts_with(&format!("{from}/")))
            .map(|(k, v)| (format!("{to}{}", &k[from.len()..]), v.clone()))
            .collect();
        order.retain(|k, _| !(k == from || k.starts_with(&format!("{from}/"))));
        order.extend(moved);
        self.save_order(&order)
    }

    /// Saves an attachment for the note at `note_rel` into the note's folder's
    /// `.assets/` directory and returns the asset's vault-relative path. An
    /// existing file is never overwritten: `name.png` becomes `name-1.png`…
    pub fn save_asset(&self, note_rel: &str, file_name: &str, bytes: &[u8]) -> Result<String> {
        let dir = crate::links::parent_dir(note_rel);
        let assets = if dir.is_empty() { ASSETS_DIR.to_string() } else { format!("{dir}/{ASSETS_DIR}") };
        let name = sanitize_file_name(file_name);
        let (stem, ext) = match name.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
            _ => (name.clone(), String::new()),
        };
        let abs_dir = self.resolve(&assets)?;
        self.ensure_parent_inside(&abs_dir.join("x"))?;
        fs::create_dir_all(&abs_dir)?;
        // First free name: stem.ext, stem-1.ext, stem-2.ext…
        let mut candidate = name.clone();
        let mut n = 1;
        while abs_dir.join(&candidate).exists() {
            candidate = format!("{stem}-{n}{ext}");
            n += 1;
        }
        fs::write(abs_dir.join(&candidate), bytes)?;
        Ok(format!("{assets}/{candidate}"))
    }

    /// "Deletes" a file or folder by moving it into `.trash/`, prefixed with a
    /// timestamp so repeated deletions of the same name never collide.
    ///
    /// Returns the vault-relative path inside the trash.
    pub fn trash(&self, rel: &str) -> Result<String> {
        if rel.is_empty() {
            // Refuse to trash the vault itself.
            return Err(CoreError::InvalidName(rel.to_string()));
        }
        let src = self.resolve(rel)?;
        if !src.exists() {
            return Err(CoreError::NotFound(rel.to_string()));
        }
        self.ensure_inside(&src)?;
        let name = src
            .file_name()
            .ok_or_else(|| CoreError::InvalidName(rel.to_string()))?
            .to_string_lossy()
            .into_owned();
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let trash_rel = format!("{TRASH_DIR}/{stamp}-{name}");
        let dst = self.resolve(&trash_rel)?;
        fs::create_dir_all(self.root.join(TRASH_DIR))?;
        fs::rename(src, dst)?;
        // Remember the original location so it can be restored there.
        let mut index = self.trash_index();
        index.insert(trash_rel.clone(), rel.to_string());
        self.save_trash_index(&index)?;
        Ok(trash_rel)
    }

    /// `.trash/.index.json` as a map; missing or unreadable means empty.
    fn trash_index(&self) -> std::collections::BTreeMap<String, String> {
        fs::read_to_string(self.root.join(TRASH_DIR).join(TRASH_INDEX))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save_trash_index(&self, index: &std::collections::BTreeMap<String, String>) -> Result<()> {
        let path = self.root.join(TRASH_DIR).join(TRASH_INDEX);
        let json = serde_json::to_string_pretty(index).map_err(|e| std::io::Error::other(e.to_string()))?;
        fs::write(path, json)?;
        Ok(())
    }

    /// Everything in the trash, newest first.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        let dir = self.root.join(TRASH_DIR);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let index = self.trash_index();
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == TRASH_INDEX {
                continue;
            }
            let trash_path = format!("{TRASH_DIR}/{name}");
            // Names are "<ms>-<original name>".
            let (stamp, original_name) = name.split_once('-').unwrap_or(("0", &name));
            out.push(TrashEntry {
                original: index.get(&trash_path).cloned().unwrap_or_else(|| original_name.to_string()),
                is_dir: entry.path().is_dir(),
                deleted_ms: stamp.parse().unwrap_or(0),
                trash_path,
            });
        }
        out.sort_by_key(|e| std::cmp::Reverse(e.deleted_ms)); // newest first
        Ok(out)
    }

    /// Checks that `trash_path` names an item directly inside `.trash/`.
    fn trash_item(&self, trash_path: &str) -> Result<PathBuf> {
        let name = trash_path
            .strip_prefix(&format!("{TRASH_DIR}/"))
            .filter(|n| !n.is_empty() && !n.contains('/') && *n != TRASH_INDEX)
            .ok_or_else(|| CoreError::InvalidName(trash_path.to_string()))?;
        let path = self.root.join(TRASH_DIR).join(name);
        if !path.exists() {
            return Err(CoreError::NotFound(trash_path.to_string()));
        }
        Ok(path)
    }

    /// Moves a trashed item back to where it came from. If something now
    /// occupies that path, " (restored)" is added to the name. Returns the
    /// restored vault-relative path.
    pub fn restore_trash(&self, trash_path: &str) -> Result<String> {
        let src = self.trash_item(trash_path)?;
        let mut index = self.trash_index();
        let original = index
            .get(trash_path)
            .cloned()
            .unwrap_or_else(|| trash_path.rsplit('/').next().unwrap_or("").split_once('-').map_or("", |x| x.1).to_string());
        // First free name: original, "name (restored).md", "name (restored 2).md"…
        let mut target = original.clone();
        let mut n = 1;
        while self.resolve(&target)?.exists() {
            let (stem, ext) = match original.rsplit_once('.') {
                Some((s, e)) if !s.is_empty() && !e.contains('/') => (s.to_string(), format!(".{e}")),
                _ => (original.clone(), String::new()),
            };
            target = if n == 1 { format!("{stem} (restored){ext}") } else { format!("{stem} (restored {n}){ext}") };
            n += 1;
        }
        let dst = self.resolve(&target)?;
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?; // its folder may have been trashed too
        }
        fs::rename(src, dst)?;
        index.remove(trash_path);
        self.save_trash_index(&index)?;
        Ok(target)
    }

    /// Permanently deletes one trashed item. This can't be undone.
    pub fn delete_trash(&self, trash_path: &str) -> Result<()> {
        let path = self.trash_item(trash_path)?;
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
        let mut index = self.trash_index();
        index.remove(trash_path);
        self.save_trash_index(&index)
    }
}

/// Rejects names that are empty, hidden, or contain characters that are
/// illegal on common file systems. This only checks user-typed names; the
/// containment check itself lives in [`Vault::resolve`].
fn validate_rel(rel: &str) -> Result<()> {
    const ILLEGAL: &[char] = &['\\', ':', '*', '?', '"', '<', '>', '|', '\0'];
    let bad = rel.trim().is_empty()
        || rel.split('/').any(|seg| seg.is_empty() || is_hidden(seg))
        || rel.contains(ILLEGAL);
    if bad {
        Err(CoreError::InvalidName(rel.to_string()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a vault in a fresh temp dir. The `TempDir` must stay alive for
    /// the test's duration, so it is returned too.
    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    #[test]
    fn rejects_escaping_paths() {
        let (_d, v) = vault();
        assert!(matches!(v.resolve("../etc/passwd"), Err(CoreError::PathEscape(_))));
        assert!(matches!(v.resolve("/etc/passwd"), Err(CoreError::PathEscape(_))));
        assert!(matches!(v.resolve("a/../../b"), Err(CoreError::PathEscape(_))));
        assert!(v.resolve("a/./b.md").is_ok());
    }

    #[test]
    fn create_write_read_roundtrip() {
        let (_d, v) = vault();
        let rel = v.create_note("hardware/cpu").unwrap();
        assert_eq!(rel, "hardware/cpu.md");
        assert_eq!(v.read_note(&rel).unwrap(), "# cpu\n\n");
        v.write_note(&rel, "hello").unwrap();
        assert_eq!(v.read_note(&rel).unwrap(), "hello");
        // Creating it twice must fail rather than clobber.
        assert!(matches!(v.create_note("hardware/cpu.md"), Err(CoreError::AlreadyExists(_))));
    }

    #[test]
    fn tree_and_listing_skip_hidden() {
        let (_d, v) = vault();
        v.create_note("b.md").unwrap();
        v.create_note("a/z.md").unwrap();
        fs::create_dir_all(v.root().join(".git")).unwrap();
        fs::write(v.root().join(".git/x.md"), "").unwrap();

        assert_eq!(v.list_notes(), vec!["a/z.md", "b.md"]);
        let tree = v.tree().unwrap();
        let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["a", "b.md"]); // folder first, .git hidden
        assert_eq!(tree.children[0].children[0].path, "a/z.md");
    }

    #[test]
    fn folder_notes_attach_to_their_folder() {
        let (_d, v) = vault();
        v.create_note("hardware/hardware.md").unwrap(); // pattern 1
        v.create_note("hardware/cpu.md").unwrap();
        v.create_note("software/index.md").unwrap(); // pattern 2
        v.create_folder("books").unwrap();
        v.create_note("books.md").unwrap(); // pattern 3 (sibling)
        v.create_note("index.md").unwrap(); // root index stays visible

        let tree = v.tree().unwrap();
        let find = |name: &str| tree.children.iter().find(|c| c.name == name).unwrap();
        assert_eq!(find("hardware").note_path.as_deref(), Some("hardware/hardware.md"));
        // The folder note is not listed again among the children.
        assert_eq!(find("hardware").children.len(), 1);
        assert_eq!(find("software").note_path.as_deref(), Some("software/index.md"));
        assert!(find("software").children.is_empty());
        assert_eq!(find("books").note_path.as_deref(), Some("books.md"));
        assert!(tree.children.iter().all(|c| c.name != "books.md"));
        assert!(tree.children.iter().any(|c| c.name == "index.md"));
        assert_eq!(default_folder_note("a/hardware"), "a/hardware/hardware.md");
    }

    #[test]
    fn assets_are_saved_beside_the_note_without_overwriting() {
        let (_d, v) = vault();
        assert_eq!(sanitize_file_name("../My Diagram (v2).PNG"), "My-Diagram-v2.PNG");
        let a = v.save_asset("hw/cpu.md", "pic.png", b"one").unwrap();
        let b = v.save_asset("hw/cpu.md", "pic.png", b"two").unwrap();
        assert_eq!(a, "hw/.assets/pic.png");
        assert_eq!(b, "hw/.assets/pic-1.png");
        assert_eq!(fs::read(v.root().join(&a)).unwrap(), b"one");
        assert_eq!(v.save_asset("root.md", "x y.pdf", b"").unwrap(), ".assets/x-y.pdf");
        // Hidden: never listed in the tree.
        assert!(v.tree().unwrap().children.iter().all(|c| c.name != ".assets"));
    }

    #[test]
    fn trash_moves_instead_of_deleting() {
        let (_d, v) = vault();
        v.create_note("gone.md").unwrap();
        let t = v.trash("gone.md").unwrap();
        assert!(t.starts_with(".trash/"));
        assert!(v.root().join(&t).exists());
        assert!(v.list_notes().is_empty());
        assert!(v.trash("").is_err());
    }

    #[test]
    fn trash_can_be_listed_restored_and_emptied() {
        let (_d, v) = vault();
        v.create_note("hw/cpu.md").unwrap();
        v.create_note("hw/ram.md").unwrap();
        let cpu = v.trash("hw/cpu.md").unwrap();
        let ram = v.trash("hw/ram.md").unwrap();
        let listed = v.list_trash().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|e| e.original == "hw/cpu.md"));
        // Restores to the original place…
        assert_eq!(v.restore_trash(&cpu).unwrap(), "hw/cpu.md");
        assert!(v.root().join("hw/cpu.md").exists());
        // …or next to it if that name was taken in the meantime.
        v.create_note("hw/ram.md").unwrap();
        assert_eq!(v.restore_trash(&ram).unwrap(), "hw/ram (restored).md");
        // Permanent delete, and escaping the trash is refused.
        let again = v.trash("hw/cpu.md").unwrap();
        v.delete_trash(&again).unwrap();
        assert!(v.list_trash().unwrap().is_empty());
        assert!(v.delete_trash(".trash/../hw/ram.md").is_err());
    }

    #[test]
    fn custom_order_is_applied_and_follows_renames() {
        let (_d, v) = vault();
        for n in ["a.md", "b.md", "c.md", "sub/x.md"] {
            v.create_note(n).unwrap();
        }
        let names = |t: &TreeNode| t.children.iter().map(|c| c.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(&v.tree().unwrap()), vec!["sub", "a.md", "b.md", "c.md"]);
        // Arranged: c before a; unlisted entries follow in the default order.
        v.set_order("", vec!["c.md".into(), "a.md".into()]).unwrap();
        assert_eq!(names(&v.tree().unwrap()), vec!["c.md", "a.md", "sub", "b.md"]);
        // A rename keeps the slot; a move elsewhere leaves the list.
        v.rename("c.md", "z.md").unwrap();
        assert_eq!(names(&v.tree().unwrap()), vec!["z.md", "a.md", "sub", "b.md"]);
        v.rename("z.md", "sub/z.md").unwrap();
        assert_eq!(v.order()[""], vec!["a.md"]);
        assert!(v.set_order("../x", vec![]).is_err());
    }

    #[test]
    fn rename_never_overwrites() {
        let (_d, v) = vault();
        v.create_note("a.md").unwrap();
        v.create_note("b.md").unwrap();
        assert!(v.rename("a.md", "b.md").is_err());
        v.rename("a.md", "sub/c.md").unwrap();
        assert_eq!(v.list_notes(), vec!["b.md", "sub/c.md"]);
    }
}
