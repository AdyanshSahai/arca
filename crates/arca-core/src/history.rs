//! Version history ("Time Machine") on top of git.
//!
//! History is a separate, slower layer than autosave: autosave keeps each
//! `.md` file current within a second or two, while history takes a
//! snapshot of the whole vault every few minutes so you can go back to how
//! things were last Tuesday.
//!
//! - Storage: a git repository whose git directory is `<vault>/.arca/history.git`
//!   and whose work tree is the vault itself. Keeping the git directory
//!   inside `.arca/` means a vault that is *already* a git repo is never
//!   touched, and no visible `.git` folder appears.
//! - Notes only: `.md`, `.markdown` and `.txt` files are tracked.
//!   Attachments (`.assets/`), `.arca/` and `.trash/` are excluded:
//!   binary files would make history grow forever.
//! - git is built in (libgit2), so nothing has to be installed. Pushing to
//!   a remote is the exception and uses the system `git` command, which
//!   already knows the user's credentials.

use std::path::{Path, PathBuf};

use git2::{IndexAddOption, Oid, Repository, Signature, Tree};
use serde::Serialize;

use crate::error::{CoreError, Result};

/// Where the history repository's git directory lives, inside the vault.
pub const HISTORY_DIR: &str = ".arca/history.git";

/// Ignore rules: everything except notes (and the folders that hold them).
const EXCLUDE: &str = "\
# Arca history tracks notes only.
*
!*/
!*.md
!*.markdown
!*.txt
.arca/
.trash/
.assets/
*.arca-tmp
";

/// One snapshot on the timeline.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Commit id (hex).
    pub id: String,
    /// Seconds since 1970.
    pub time: i64,
    /// Notes added / changed / removed compared with the previous snapshot.
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// "added", "modified" or "deleted".
    pub kind: &'static str,
}

impl From<git2::Error> for CoreError {
    fn from(e: git2::Error) -> Self {
        CoreError::Io(std::io::Error::other(format!("history: {}", e.message())))
    }
}

/// The history repository of one vault.
pub struct History {
    repo: Repository,
}

impl History {
    /// Opens the vault's history, creating it on first use.
    pub fn open_or_init(vault_root: &Path) -> Result<Self> {
        let git_dir = vault_root.join(HISTORY_DIR);
        let repo = if git_dir.exists() {
            Repository::open(&git_dir)?
        } else {
            std::fs::create_dir_all(&git_dir)?;
            // Created bare: giving libgit2 a work tree at init time makes it
            // write a ".git" link file into the vault, which would clash
            // with a repo the user already has there.
            let mut opts = git2::RepositoryInitOptions::new();
            opts.bare(true).initial_head("main");
            let repo = Repository::init_opts(&git_dir, &opts)?;
            repo.config()?.set_bool("core.bare", false)?;
            repo
        };
        // Attach the vault as the work tree in memory only (`false` = don't
        // write a .git link file), like `git --git-dir=… --work-tree=vault`.
        repo.set_workdir(vault_root, false)?;
        // Always (re)write the ignore rules, so updates to them take effect.
        std::fs::create_dir_all(git_dir.join("info"))?;
        std::fs::write(git_dir.join("info").join("exclude"), EXCLUDE)?;
        Ok(Self { repo })
    }

    /// True if a vault already has history (without creating it).
    pub fn exists(vault_root: &Path) -> bool {
        vault_root.join(HISTORY_DIR).exists()
    }

    fn signature() -> Result<Signature<'static>> {
        Ok(Signature::now("Arca", "arca@localhost")?)
    }

    /// Records the vault's current state if anything changed since the last
    /// snapshot. Returns the new snapshot's id, or None if nothing changed.
    pub fn snapshot(&self) -> Result<Option<String>> {
        let mut index = self.repo.index()?;
        // Stage new and changed notes (ignore rules apply)…
        index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
        // …and removals (notes deleted or moved since the last snapshot).
        index.update_all(["*"], None)?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let parent = self.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if let Some(p) = &parent {
            if p.tree_id() == tree_id {
                return Ok(None); // nothing changed
            }
        }
        let tree = self.repo.find_tree(tree_id)?;
        let sig = Self::signature()?;
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        let id = self.repo.commit(Some("HEAD"), &sig, &sig, "Arca snapshot", &tree, &parents)?;
        Ok(Some(id.to_string()))
    }

    /// Changes between a commit's tree and its parent's.
    fn changes_of(&self, commit: &git2::Commit) -> Result<Vec<Change>> {
        let tree = commit.tree()?;
        let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
        let diff = self.repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
        let mut out = Vec::new();
        for d in diff.deltas() {
            let kind = match d.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                _ => "modified",
            };
            let path = d.new_file().path().or_else(|| d.old_file().path());
            if let Some(p) = path {
                out.push(Change { path: p.to_string_lossy().replace('\\', "/"), kind });
            }
        }
        Ok(out)
    }

    /// The newest `limit` snapshots. With `only`, just those that changed
    /// that note (its per-note history).
    pub fn timeline(&self, limit: usize, only: Option<&str>) -> Result<Vec<Snapshot>> {
        let mut walk = self.repo.revwalk()?;
        if walk.push_head().is_err() {
            return Ok(Vec::new()); // no snapshots yet
        }
        let mut out = Vec::new();
        for oid in walk {
            let commit = self.repo.find_commit(oid?)?;
            let changes = self.changes_of(&commit)?;
            if let Some(path) = only {
                if !changes.iter().any(|c| c.path == path) {
                    continue;
                }
            }
            out.push(Snapshot { id: commit.id().to_string(), time: commit.time().seconds(), changes });
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    fn tree_of(&self, id: &str) -> Result<Tree<'_>> {
        let oid = Oid::from_str(id)?;
        Ok(self.repo.find_commit(oid)?.tree()?)
    }

    /// Every note (path) in a snapshot.
    pub fn files_at(&self, id: &str) -> Result<Vec<String>> {
        let tree = self.tree_of(id)?;
        let mut out = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                out.push(format!("{dir}{}", entry.name().unwrap_or_default()));
            }
            git2::TreeWalkResult::Ok
        })?;
        out.sort();
        Ok(out)
    }

    /// A note's text as it was in a snapshot (None if it didn't exist then).
    pub fn read_at(&self, id: &str, path: &str) -> Result<Option<String>> {
        let tree = self.tree_of(id)?;
        let Ok(entry) = tree.get_path(Path::new(path)) else { return Ok(None) };
        let blob = self.repo.find_blob(entry.id())?;
        Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
    }

    /// The system `git` command against this history repo.
    fn git_cmd(&self) -> std::process::Command {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("--git-dir").arg(self.repo.path());
        if let Some(w) = self.repo.workdir() {
            cmd.arg("--work-tree").arg(w);
        }
        cmd
    }

    /// Sets (or clears, with "") the remote that `push` sends history to.
    pub fn set_remote(&self, url: &str) -> Result<()> {
        if self.repo.find_remote("backup").is_ok() {
            self.repo.remote_delete("backup")?;
        }
        if !url.trim().is_empty() {
            self.repo.remote("backup", url.trim())?;
        }
        Ok(())
    }

    pub fn remote(&self) -> Option<String> {
        self.repo.find_remote("backup").ok()?.url().map(str::to_string)
    }

    /// Pushes history to the "backup" remote with the system `git`, which
    /// knows the user's SSH keys / credential helper. Returns git's output.
    pub fn push(&self) -> Result<String> {
        if self.remote().is_none() {
            return Err(CoreError::NotFound("no backup remote set".into()));
        }
        let out = self
            .git_cmd()
            .args(["push", "--quiet", "backup", "main"])
            .output()
            .map_err(|e| CoreError::Io(std::io::Error::other(format!("couldn't run git (is it installed?): {e}"))))?;
        let text = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            Ok(text)
        } else {
            Err(CoreError::Io(std::io::Error::other(format!("git push failed: {text}"))))
        }
    }

    /// The history git directory (for diagnostics / tests).
    pub fn git_dir(&self) -> PathBuf {
        self.repo.path().to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn snapshots_track_notes_only_and_skip_no_ops() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("hw/.assets")).unwrap();
        fs::write(root.join("hw/cpu.md"), "# CPU v1").unwrap();
        fs::write(root.join("hw/.assets/pic.png"), [0u8; 64]).unwrap();
        fs::write(root.join("script.sh"), "echo hi").unwrap();

        let h = History::open_or_init(root).unwrap();
        let first = h.snapshot().unwrap().expect("first snapshot");
        assert!(h.snapshot().unwrap().is_none(), "nothing changed → no snapshot");
        assert_eq!(h.files_at(&first).unwrap(), vec!["hw/cpu.md"]); // no png, no script

        fs::write(root.join("hw/cpu.md"), "# CPU v2").unwrap();
        fs::write(root.join("ram.md"), "# RAM").unwrap();
        let second = h.snapshot().unwrap().unwrap();
        fs::remove_file(root.join("ram.md")).unwrap();
        h.snapshot().unwrap().unwrap();

        let tl = h.timeline(10, None).unwrap();
        assert_eq!(tl.len(), 3);
        assert_eq!(tl[0].changes, vec![Change { path: "ram.md".into(), kind: "deleted" }]);
        assert_eq!(h.read_at(&first, "hw/cpu.md").unwrap().as_deref(), Some("# CPU v1"));
        assert_eq!(h.read_at(&second, "ram.md").unwrap().as_deref(), Some("# RAM"));
        // Per-note history: cpu.md changed in the first two snapshots.
        assert_eq!(h.timeline(10, Some("hw/cpu.md")).unwrap().len(), 2);
        // The vault itself has no .git folder.
        assert!(!root.join(".git").exists());
    }

    #[test]
    fn an_existing_git_repo_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        Repository::init(root).unwrap(); // the user's own repo
        fs::write(root.join("a.md"), "x").unwrap();
        let h = History::open_or_init(root).unwrap();
        h.snapshot().unwrap().unwrap();
        // The user's repo has no commits from Arca.
        assert!(Repository::open(root).unwrap().head().is_err());
    }
}
