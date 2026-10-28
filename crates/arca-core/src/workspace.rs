//! The in-memory model of one open vault.
//!
//! [`Workspace`] owns the [`Vault`] (disk access), the [`SearchIndex`], and a
//! small per-note metadata cache (title, links, tags, post-its). Every
//! operation that changes a note goes through here, so the cache and the
//! index never drift from what is on disk.
//!
//! The Tauri shell keeps exactly one `Workspace` behind a lock and also calls
//! [`Workspace::refresh`] when the file watcher sees an outside edit (another
//! editor, `git pull`, a sync tool…).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{CoreError, Result};
use crate::links::{self, LinkKind, Resolver, TagRef, WikiLink};
use crate::postit::{self, PostIt};
use crate::search::{self, FileHit, IndexDoc, SearchIndex, TextHit, TopicKind};
use crate::vault::{is_note_path, is_text_path, TreeNode, Vault};

/// Cached facts about one note, rebuilt whenever its file changes.
#[derive(Debug, Clone)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub links: Vec<WikiLink>,
    pub tags: Vec<TagRef>,
    pub postits: Vec<PostIt>,
}

/// A note that links to the one being inspected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source: String,
    pub title: String,
    pub line: usize,
    pub context: String,
}

/// Graph node. Ghost nodes stand for `[[links]]` to notes that don't exist
/// yet; they're drawn dimmed, and clicking one creates the note.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub folder: String,
    pub ghost: bool,
    /// Number of edges touching this node; drives the drawn radius.
    pub degree: usize,
    /// The note's unique tags (lower-case, no "#"), for the graph's tag
    /// filter. Empty for ghosts.
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// A post-it together with the note it lives in, for the global panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostItEntry {
    pub path: String,
    pub note_title: String,
    #[serde(flatten)]
    pub postit: PostIt,
}

/// A tag and how many notes carry it.
#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// Minimal note info for link autocompletion and the pin bar.
#[derive(Debug, Clone, Serialize)]
pub struct NoteInfo {
    pub path: String,
    pub title: String,
}

/// Where a clicked wiki-link leads.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LinkTarget {
    /// An existing note, by vault-relative path.
    Note { path: String },
    /// A note link with no matching note; `suggested` is a path the UI can
    /// offer to create (next to the linking note).
    Missing { target: String, suggested: String },
    Url { url: String },
    /// A local file outside the note system (PDF textbook…), absolute path.
    File { path: String },
}

/// The open vault plus its caches and search index.
pub struct Workspace {
    vault: Vault,
    index: SearchIndex,
    /// path → metadata, ordered so listings are deterministic.
    notes: BTreeMap<String, NoteMeta>,
    resolver: Resolver,
}

impl Workspace {
    /// Opens a vault folder and indexes every note in it.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let mut ws = Self {
            vault: Vault::open(root)?,
            index: SearchIndex::new()?,
            notes: BTreeMap::new(),
            resolver: Resolver::default(),
        };
        ws.reindex_all()?;
        Ok(ws)
    }

    pub fn vault(&self) -> &Vault {
        &self.vault
    }

    pub fn root(&self) -> &Path {
        self.vault.root()
    }

    // ------------------------------------------------------------------
    // Indexing
    // ------------------------------------------------------------------

    /// Throws away all caches and rebuilds them from disk. Used on open and
    /// after folder-level changes (renames, trashing a chapter).
    pub fn reindex_all(&mut self) -> Result<()> {
        self.index.clear()?;
        self.notes.clear();
        for path in self.vault.list_notes() {
            // An unreadable file (e.g. not UTF-8) is skipped instead of
            // failing the whole vault.
            if let Ok(content) = self.vault.read_note(&path) {
                self.ingest(&path, &content)?;
            }
        }
        self.rebuild_resolver();
        self.index.commit()
    }

    /// Re-reads one path after an outside change. Handles creation,
    /// modification and deletion alike; folders trigger a full re-scan.
    pub fn refresh(&mut self, rel: &str) -> Result<()> {
        let abs = self.vault.resolve(rel)?;
        if abs.is_dir() {
            return self.reindex_all();
        }
        if abs.is_file() && is_note_path(&abs) {
            let content = self.vault.read_note(rel)?;
            let is_new = !self.notes.contains_key(rel);
            self.ingest(rel, &content)?;
            if is_new {
                self.rebuild_resolver();
            }
        } else {
            // Gone (or never a note): drop it and anything under it.
            self.forget(rel);
            self.rebuild_resolver();
        }
        self.index.commit()
    }

    /// Parses a note and stores its metadata + index entry (no commit).
    fn ingest(&mut self, path: &str, content: &str) -> Result<()> {
        let extracted = links::extract(content);
        let meta = NoteMeta {
            path: path.to_string(),
            title: title_of(path, content),
            postits: postit::parse(content),
            links: extracted.links,
            tags: extracted.tags,
        };
        // Unique tags / normalised note-link targets for the keyword fields.
        let tags: HashSet<String> = meta.tags.iter().map(|t| t.tag.clone()).collect();
        let link_keys: HashSet<String> = meta
            .links
            .iter()
            .filter(|l| l.kind == LinkKind::Note)
            .map(|l| links::normalize_target(&l.target))
            .collect();
        self.index.upsert(&IndexDoc {
            path,
            title: &meta.title,
            body: content,
            tags: tags.into_iter().collect(),
            links: link_keys.into_iter().collect(),
        })?;
        self.notes.insert(path.to_string(), meta);
        Ok(())
    }

    /// Removes a note, or every note under a folder path, from the caches.
    fn forget(&mut self, rel: &str) {
        let prefix = format!("{rel}/");
        let doomed: Vec<String> = self
            .notes
            .keys()
            .filter(|p| p.as_str() == rel || p.starts_with(&prefix))
            .cloned()
            .collect();
        for p in doomed {
            self.index.remove(&p);
            self.notes.remove(&p);
        }
    }

    /// The resolver depends on the set of note paths, so it is rebuilt
    /// whenever a note appears or disappears (not on every keystroke).
    fn rebuild_resolver(&mut self) {
        self.resolver = Resolver::new(self.notes.keys());
    }

    // ------------------------------------------------------------------
    // File operations (all keep the caches in sync)
    // ------------------------------------------------------------------

    pub fn tree(&self) -> Result<TreeNode> {
        self.vault.tree()
    }

    pub fn read_note(&self, rel: &str) -> Result<String> {
        self.vault.read_note(rel)
    }

    /// Saves a note and updates its index entry straight away.
    ///
    /// Plain-text files (`.txt`) can be saved too, but aren't indexed. Notes
    /// inside hidden folders (e.g. `.arca/templates/`) are saved without
    /// being indexed, so they never show up in search or the graph.
    pub fn write_note(&mut self, rel: &str, content: &str) -> Result<()> {
        let path = Path::new(rel);
        if !is_note_path(path) && !is_text_path(path) {
            return Err(CoreError::InvalidName(rel.to_string()));
        }
        self.vault.write_note(rel, content)?;
        if !is_note_path(path) || Vault::is_hidden_rel(rel) {
            return Ok(());
        }
        let is_new = !self.notes.contains_key(rel);
        self.ingest(rel, content)?;
        if is_new {
            self.rebuild_resolver();
        }
        self.index.commit()
    }

    /// Creates a note and returns its final path (with `.md`).
    pub fn create_note(&mut self, rel: &str) -> Result<String> {
        let path = self.vault.create_note(rel)?;
        self.refresh(&path)?;
        Ok(path)
    }

    pub fn create_folder(&mut self, rel: &str) -> Result<()> {
        self.vault.create_folder(rel)
    }

    /// Renames/moves a note or folder. Links pointing at it are *not*
    /// rewritten; they show up as ghost nodes until fixed.
    pub fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        self.vault.rename(from, to)?;
        self.reindex_all()
    }

    /// Moves a note or folder to `.trash/`.
    pub fn trash(&mut self, rel: &str) -> Result<String> {
        let dest = self.vault.trash(rel)?;
        self.forget(rel);
        self.rebuild_resolver();
        self.index.commit()?;
        Ok(dest)
    }

    // ------------------------------------------------------------------
    // Links, backlinks, graph
    // ------------------------------------------------------------------

    /// Every note-link elsewhere in the vault that resolves to `rel`.
    pub fn backlinks(&self, rel: &str) -> Vec<Backlink> {
        let mut out = Vec::new();
        for meta in self.notes.values().filter(|m| m.path != rel) {
            for link in meta.links.iter().filter(|l| l.kind == LinkKind::Note) {
                if self.resolver.resolve(&link.target, &meta.path).as_deref() == Some(rel) {
                    out.push(Backlink {
                        source: meta.path.clone(),
                        title: meta.title.clone(),
                        line: link.line,
                        context: link.context.clone(),
                    });
                }
            }
        }
        out
    }

    /// Nodes for every note (plus ghosts for missing targets) and one edge
    /// per distinct source→target pair.
    pub fn graph(&self) -> Graph {
        let mut edges: HashSet<GraphEdge> = HashSet::new();
        // Ghost id → label, for unresolved targets.
        let mut ghosts: BTreeMap<String, String> = BTreeMap::new();

        for meta in self.notes.values() {
            for link in meta.links.iter().filter(|l| l.kind == LinkKind::Note) {
                let target = match self.resolver.resolve(&link.target, &meta.path) {
                    Some(path) => path,
                    None => {
                        // Prefixed so a ghost can never collide with a real path.
                        let id = format!("ghost:{}", links::normalize_target(&link.target));
                        ghosts.entry(id.clone()).or_insert_with(|| link.target.clone());
                        id
                    }
                };
                if target != meta.path {
                    edges.insert(GraphEdge {
                        source: meta.path.clone(),
                        target,
                    });
                }
            }
        }

        // Degree count per node id.
        let mut degree: HashMap<&str, usize> = HashMap::new();
        for e in &edges {
            *degree.entry(&e.source).or_default() += 1;
            *degree.entry(&e.target).or_default() += 1;
        }

        let mut nodes: Vec<GraphNode> = self
            .notes
            .values()
            .map(|m| {
                let mut tags: Vec<String> = m.tags.iter().map(|t| t.tag.clone()).collect();
                tags.sort();
                tags.dedup();
                GraphNode {
                    id: m.path.clone(),
                    label: m.title.clone(),
                    folder: links::parent_dir(&m.path).to_string(),
                    ghost: false,
                    degree: degree.get(m.path.as_str()).copied().unwrap_or(0),
                    tags,
                }
            })
            .collect();
        nodes.extend(ghosts.into_iter().map(|(id, label)| GraphNode {
            degree: degree.get(id.as_str()).copied().unwrap_or(0),
            id,
            label,
            folder: String::new(),
            ghost: true,
            tags: Vec::new(),
        }));

        let mut edges: Vec<GraphEdge> = edges.into_iter().collect();
        // HashSet order is random; sort so the frontend sees stable data.
        edges.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));
        Graph { nodes, edges }
    }

    /// Works out what a clicked `[[target]]` in note `from` refers to.
    pub fn resolve_link(&self, target: &str, from: &str) -> LinkTarget {
        let target = target.trim();
        match links::classify(target) {
            LinkKind::Url => LinkTarget::Url {
                // "www.example.com" isn't openable without a scheme.
                url: if target.contains("://") || target.starts_with("mailto:") {
                    target.to_string()
                } else {
                    format!("https://{target}")
                },
            },
            LinkKind::File => match self.resolve_file(target, from) {
                Some(path) => LinkTarget::File {
                    path: path.to_string_lossy().into_owned(),
                },
                None => LinkTarget::Missing {
                    target: target.to_string(),
                    suggested: String::new(),
                },
            },
            LinkKind::Note => match self.resolver.resolve(target, from) {
                Some(path) => LinkTarget::Note { path },
                None => {
                    // Suggest "<linking note's folder>/<target>.md".
                    let name = target.split('#').next().unwrap_or(target).trim();
                    let dir = links::parent_dir(from);
                    let file = if is_note_path(Path::new(name)) {
                        name.to_string()
                    } else {
                        format!("{name}.md")
                    };
                    LinkTarget::Missing {
                        target: target.to_string(),
                        suggested: if dir.is_empty() || name.contains('/') {
                            file
                        } else {
                            format!("{dir}/{file}")
                        },
                    }
                }
            },
        }
    }

    /// Finds a file link on disk. `~/`, `file://` and absolute paths are taken
    /// as-is (these deliberately point outside the vault, e.g. a textbook
    /// folder). Relative paths are tried next to the note, then from the
    /// vault root. They are only *opened* by the OS, never written.
    fn resolve_file(&self, target: &str, from: &str) -> Option<PathBuf> {
        let t = target.strip_prefix("file://").unwrap_or(target);
        let candidate = if let Some(rest) = t.strip_prefix("~/") {
            Some(PathBuf::from(std::env::var_os("HOME")?).join(rest))
        } else if t.starts_with('/') {
            Some(PathBuf::from(t))
        } else {
            None
        };
        if let Some(c) = candidate {
            return c.exists().then_some(c);
        }
        // Relative: sibling of the note first, then from the vault root.
        let dir = links::parent_dir(from);
        let near = if dir.is_empty() { t.to_string() } else { format!("{dir}/{t}") };
        for rel in [near.as_str(), t] {
            if let Ok(p) = self.vault.resolve(rel) {
                if p.exists() {
                    return Some(p);
                }
            }
        }
        None
    }

    // ------------------------------------------------------------------
    // Post-its
    // ------------------------------------------------------------------

    /// Every post-it in the vault, grouped by note in path order.
    pub fn postits(&self) -> Vec<PostItEntry> {
        self.notes
            .values()
            .flat_map(|m| {
                m.postits.iter().map(move |p| PostItEntry {
                    path: m.path.clone(),
                    note_title: m.title.clone(),
                    postit: p.clone(),
                })
            })
            .collect()
    }

    /// Rewrites one post-it's text/colour on disk and returns the note's new
    /// full content (so an open editor can swap it in).
    pub fn update_postit(&mut self, rel: &str, id: &str, text: &str, color: Option<&str>) -> Result<String> {
        let current = self.vault.read_note(rel)?;
        let updated = postit::update(&current, id, text, color)
            .ok_or_else(|| CoreError::NotFound(format!("post-it {id} in {rel}")))?;
        self.write_note(rel, &updated)?;
        Ok(updated)
    }

    // ------------------------------------------------------------------
    // Search
    // ------------------------------------------------------------------

    pub fn search_files(&self, query: &str, limit: usize, case_sensitive: bool) -> Result<Vec<FileHit>> {
        let paths: Vec<String> = self.notes.keys().cloned().collect();
        search::match_filename(&paths, query, limit, case_sensitive)
    }

    pub fn search_text(&self, query: &str, scope: Option<&str>, limit: usize, case_sensitive: bool) -> Result<Vec<TextHit>> {
        self.index.full_text(query, scope, limit, case_sensitive)
    }

    pub fn search_topic(&self, kind: TopicKind, term: &str, limit: usize) -> Result<Vec<TextHit>> {
        self.index.topic(kind, term, limit)
    }

    /// All tags in the vault with note counts, most used first.
    pub fn tags(&self) -> Vec<TagCount> {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for meta in self.notes.values() {
            // Count each tag once per note, not once per occurrence.
            let unique: HashSet<&str> = meta.tags.iter().map(|t| t.tag.as_str()).collect();
            for t in unique {
                *counts.entry(t).or_default() += 1;
            }
        }
        let mut out: Vec<TagCount> = counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag: tag.to_string(), count })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
        out
    }

    /// Path + title of every note (for `[[` autocompletion).
    pub fn notes(&self) -> Vec<NoteInfo> {
        self.notes
            .values()
            .map(|m| NoteInfo {
                path: m.path.clone(),
                title: m.title.clone(),
            })
            .collect()
    }
}

/// A note's title is its first `# Heading` (outside code blocks), or the
/// file name without extension if there is none. A folder's `index.md`
/// falls back to the folder name instead of "index".
fn title_of(path: &str, content: &str) -> String {
    let masked = links::mask_code(content);
    let heading = masked.lines().zip(content.lines()).find_map(|(m, orig)| {
        // Test the masked line so a "# x" inside code doesn't count, but
        // return the original text.
        m.strip_prefix("# ").map(|_| orig[2..].trim().to_string())
    });
    heading.filter(|h| !h.is_empty()).unwrap_or_else(|| {
        let p = Path::new(path);
        let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        match p.parent().and_then(|d| d.file_name()) {
            Some(folder) if stem.eq_ignore_ascii_case("index") => folder.to_string_lossy().into_owned(),
            _ => stem,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A small vault with links, a tag, a post-it and a dangling link.
    fn workspace() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("hardware")).unwrap();
        fs::write(
            root.join("hardware/cpu.md"),
            "# CPU\n\nSee [[memory]] and [[Missing Note]]. #hardware\n\n<!-- postit:id=p1 color=purple -->\n> **Post-it:** Check registers.\n<!-- /postit -->\n",
        )
        .unwrap();
        fs::write(root.join("hardware/memory.md"), "# Memory\n\nBack to [[CPU]].\n").unwrap();
        fs::write(root.join("index.md"), "No heading, links [[hardware/cpu]].\n").unwrap();
        let ws = Workspace::open(root).unwrap();
        (dir, ws)
    }

    #[test]
    fn titles_fall_back_to_file_name() {
        let (_d, ws) = workspace();
        let titles: Vec<_> = ws.notes().into_iter().map(|n| n.title).collect();
        assert_eq!(titles, vec!["CPU", "Memory", "index"]);
    }

    #[test]
    fn backlinks_and_graph() {
        let (_d, ws) = workspace();
        let mut sources: Vec<_> = ws.backlinks("hardware/cpu.md").into_iter().map(|b| b.source).collect();
        sources.sort();
        assert_eq!(sources, vec!["hardware/memory.md", "index.md"]);

        let g = ws.graph();
        assert_eq!(g.nodes.len(), 4); // 3 notes + 1 ghost
        assert!(g.nodes.iter().any(|n| n.ghost && n.id == "ghost:missing note"));
        let cpu = g.nodes.iter().find(|n| n.id == "hardware/cpu.md").unwrap();
        assert_eq!(cpu.tags, vec!["hardware"]);
        assert_eq!(g.edges.len(), 4);
    }

    #[test]
    fn resolves_links_of_every_kind() {
        let (_d, ws) = workspace();
        assert_eq!(
            ws.resolve_link("memory", "hardware/cpu.md"),
            LinkTarget::Note { path: "hardware/memory.md".into() }
        );
        assert_eq!(
            ws.resolve_link("Missing Note", "hardware/cpu.md"),
            LinkTarget::Missing { target: "Missing Note".into(), suggested: "hardware/Missing Note.md".into() }
        );
        assert_eq!(ws.resolve_link("www.rust-lang.org", "x.md"), LinkTarget::Url { url: "https://www.rust-lang.org".into() });
    }

    #[test]
    fn postit_edit_writes_through_and_reindexes() {
        let (_d, mut ws) = workspace();
        assert_eq!(ws.postits().len(), 1);
        let new = ws.update_postit("hardware/cpu.md", "p1", "Check flags.", None).unwrap();
        assert!(new.contains("> **Post-it:** Check flags."));
        assert_eq!(ws.read_note("hardware/cpu.md").unwrap(), new);
        assert_eq!(ws.postits()[0].postit.text, "Check flags.");
        // Search sees the new text right away.
        assert_eq!(ws.search_text("flags", None, 5, false).unwrap().len(), 1);
    }

    #[test]
    fn creating_a_note_resolves_ghosts() {
        let (_d, mut ws) = workspace();
        ws.create_note("hardware/Missing Note").unwrap();
        assert!(ws.graph().nodes.iter().all(|n| !n.ghost));
    }

    #[test]
    fn text_files_save_but_are_not_indexed() {
        let (_d, mut ws) = workspace();
        ws.write_note("refs/notes.txt", "plain registers text").unwrap();
        assert_eq!(ws.read_note("refs/notes.txt").unwrap(), "plain registers text");
        assert!(ws.notes().iter().all(|n| n.path != "refs/notes.txt"));
        // Hidden-folder notes are saved but stay out of the index.
        ws.write_note(".arca/templates/t.md", "# T").unwrap();
        assert!(ws.notes().iter().all(|n| !n.path.starts_with(".arca")));
        // Anything else is still refused.
        assert!(ws.write_note("bin/tool.sh", "x").is_err());
    }

    #[test]
    fn trash_folder_forgets_children() {
        let (_d, mut ws) = workspace();
        ws.trash("hardware").unwrap();
        assert_eq!(ws.notes().len(), 1);
        assert!(ws.search_text("registers", None, 5, false).unwrap().is_empty());
        assert_eq!(ws.tags().len(), 0);
    }
}
