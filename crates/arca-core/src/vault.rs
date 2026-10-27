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

/// File extensions treated as notes.
const NOTE_EXTENSIONS: &[&str] = &["md", "markdown"];

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
        let mut root = self.tree_at(&self.root)?;
        // Show the vault folder's own name at the top instead of "".
        root.name = self
            .root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(root)
    }

    /// Recursive helper for [`Self::tree`].
    fn tree_at(&self, dir: &Path) -> Result<TreeNode> {
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
                children.push(self.tree_at(&path)?);
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
        // Folders first, then case-insensitive alphabetical order.
        children.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
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
        Ok(())
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
        Ok(trash_rel)
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
    fn rename_never_overwrites() {
        let (_d, v) = vault();
        v.create_note("a.md").unwrap();
        v.create_note("b.md").unwrap();
        assert!(v.rename("a.md", "b.md").is_err());
        v.rename("a.md", "sub/c.md").unwrap();
        assert_eq!(v.list_notes(), vec!["b.md", "sub/c.md"]);
    }
}
