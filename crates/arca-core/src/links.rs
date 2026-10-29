//! `[[WikiLinks]]`, `#tags`, and link resolution.
//!
//! A wiki-link's target can be one of three things, decided purely from its
//! text (see [`classify`]):
//!
//! | Syntax                                   | Kind                       |
//! |------------------------------------------|----------------------------|
//! | `[[CPU]]`, `[[hardware/cpu]]`            | [`LinkKind::Note`]         |
//! | `[[https://example.com]]`                | [`LinkKind::Url`]          |
//! | `[[~/books/sicp.pdf]]`, `[[refs/a.pdf]]` | [`LinkKind::File`] (e.g. a local textbook) |
//!
//! Any link may carry a display alias after a pipe (`[[cpu|the CPU note]]`)
//! and a heading anchor (`[[cpu#Registers]]`); the anchor is ignored when
//! resolving which note is meant.

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// `[[target]]` or `[[target|alias]]`; no nested brackets or newlines inside.
static WIKI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\[\]\n]+?)\]\]").unwrap());

/// A `#tag` must start with a letter (so `#1` and markdown headings `# Title`
/// don't count) and must follow whitespace, `(`, or the start of a line, so
/// URL fragments like `page#section` are skipped. Nested tags such as
/// `#lang/rust` are allowed.
static TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)(?:^|[\s(])#([A-Za-z][\w\-/]*)").unwrap());

/// What a wiki-link points to.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Note,
    Url,
    File,
}

/// One wiki-link occurrence inside a note.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiLink {
    /// Target text before any `|alias`, trimmed.
    pub target: String,
    pub alias: Option<String>,
    pub kind: LinkKind,
    /// 1-based line number of the occurrence.
    pub line: usize,
    /// The full source line, trimmed, for backlink previews.
    pub context: String,
    /// Byte range of the target text (`cpu` in `[[ cpu |alias]]`) in the
    /// note, so renames can rewrite exactly that text.
    #[serde(skip)]
    pub span: (usize, usize),
}

/// One `#tag` occurrence.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagRef {
    /// Lower-cased tag without the `#`.
    pub tag: String,
    pub line: usize,
    pub context: String,
}

/// Everything link-related extracted from one note.
#[derive(Debug, Clone, Default)]
pub struct Extracted {
    pub links: Vec<WikiLink>,
    pub tags: Vec<TagRef>,
}

/// Decides what a link target refers to (see the table in the module docs).
pub fn classify(target: &str) -> LinkKind {
    let t = target.trim();
    let lower = t.to_ascii_lowercase();
    if t.contains("://") || lower.starts_with("mailto:") || lower.starts_with("www.") {
        return LinkKind::Url;
    }
    if t.starts_with('/') || t.starts_with("~/") || lower.starts_with("file:") {
        return LinkKind::File;
    }
    // A relative path whose extension isn't markdown, e.g. `books/os.pdf`.
    // The anchor is cut first so `[[cpu#v1.2]]` isn't mistaken for a file.
    let without_anchor = t.split('#').next().unwrap_or(t);
    match Path::new(without_anchor).extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.eq_ignore_ascii_case("md") && !ext.eq_ignore_ascii_case("markdown") => {
            LinkKind::File
        }
        _ => LinkKind::Note,
    }
}

/// Blanks out fenced code blocks and inline code spans so links and tags
/// inside code are not picked up. Every masked byte becomes a space, which
/// keeps byte offsets and line numbers identical to the original text.
pub fn mask_code(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    // The fence that opened the current code block ("```" or "~~~"), if any.
    let mut fence: Option<&str> = None;
    for line in src.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some("```")
        } else if trimmed.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        match (fence, marker) {
            // Opening fence: mask the fence line itself (it may carry a language tag).
            (None, Some(m)) => {
                fence = Some(m);
                out.push_str(&blank(line));
            }
            // The matching closing fence.
            (Some(f), Some(m)) if f == m => {
                fence = None;
                out.push_str(&blank(line));
            }
            // Inside a block.
            (Some(_), _) => out.push_str(&blank(line)),
            // Normal prose: only inline code spans need masking.
            (None, None) => out.push_str(&mask_inline_code(line)),
        }
    }
    out
}

/// Replaces every byte except newlines with a space.
fn blank(s: &str) -> String {
    s.bytes().map(|b| if b == b'\n' { '\n' } else { ' ' }).collect()
}

/// Masks `` `inline code` `` spans on a single line. An unmatched backtick
/// is left alone, as CommonMark does.
fn mask_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('`') {
        let Some(close) = rest[open + 1..].find('`') else {
            break;
        };
        let close = open + 1 + close; // index of the closing backtick in `rest`
        out.push_str(&rest[..open]);
        out.push_str(&blank(&rest[open..=close]));
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    out
}

/// Byte offsets where each line starts, used to turn a match offset into a
/// line number with a binary search.
fn line_starts(src: &str) -> Vec<usize> {
    std::iter::once(0)
        .chain(src.match_indices('\n').map(|(i, _)| i + 1))
        .collect()
}

/// (1-based line number, trimmed line text) for a byte offset.
fn line_info(src: &str, starts: &[usize], offset: usize) -> (usize, String) {
    // `partition_point` finds the first line start after `offset`; the line
    // we want is the one just before it.
    let idx = starts.partition_point(|&s| s <= offset) - 1;
    let start = starts[idx];
    let end = starts.get(idx + 1).map_or(src.len(), |e| e - 1);
    let mut ctx = src[start..end].trim().to_string();
    // Keep previews short; cut on a char boundary.
    if ctx.len() > 240 {
        let cut = (0..=240).rev().find(|&i| ctx.is_char_boundary(i)).unwrap_or(0);
        ctx.truncate(cut);
        ctx.push('…');
    }
    (idx + 1, ctx)
}

/// Pulls every wiki-link and tag out of a note, ignoring code.
pub fn extract(src: &str) -> Extracted {
    let masked = mask_code(src);
    let starts = line_starts(src);
    let mut out = Extracted::default();

    for cap in WIKI_RE.captures_iter(&masked) {
        let m = cap.get(1).unwrap();
        // Read the inner text from the *original* source; offsets are the same.
        let inner = &src[m.start()..m.end()];
        let (target_part, alias) = match inner.split_once('|') {
            Some((t, a)) => (t, Some(a.trim().to_string())),
            None => (inner, None),
        };
        let target = target_part.trim();
        if target.is_empty() {
            continue;
        }
        // Where the trimmed target starts: after any leading spaces.
        let start = m.start() + (target_part.len() - target_part.trim_start().len());
        let (line, context) = line_info(src, &starts, m.start());
        out.links.push(WikiLink {
            target: target.to_string(),
            alias,
            kind: classify(target),
            line,
            context,
            span: (start, start + target.len()),
        });
    }

    for cap in TAG_RE.captures_iter(&masked) {
        let m = cap.get(1).unwrap();
        let (line, context) = line_info(src, &starts, m.start());
        out.tags.push(TagRef {
            // Trailing "/" from sloppy nesting (`#a/`) is dropped.
            tag: m.as_str().trim_end_matches('/').to_lowercase(),
            line,
            context,
        });
    }
    out
}

/// Strips the `#anchor` and any `.md` extension and lower-cases the result:
/// the canonical form used for matching link targets to notes.
pub fn normalize_target(target: &str) -> String {
    let base = target.split('#').next().unwrap_or(target).trim();
    let base = base.trim_start_matches("./");
    let lower = base.to_lowercase();
    lower
        .strip_suffix(".md")
        .or_else(|| lower.strip_suffix(".markdown"))
        .unwrap_or(&lower)
        .to_string()
}

/// Maps note-link targets to concrete note paths.
///
/// Matching is case-insensitive. A bare name (`[[cpu]]`) matches any note
/// with that file stem; if several do, the one in the same folder as the
/// linking note wins, then the shortest path. A target with a slash
/// (`[[hardware/cpu]]`) must match the end of a note's path.
#[derive(Debug, Default, Clone)]
pub struct Resolver {
    /// lower-cased stem → every note path with that stem.
    by_stem: HashMap<String, Vec<String>>,
    /// lower-cased path without extension → note path.
    by_path: HashMap<String, String>,
}

impl Resolver {
    /// Builds the lookup tables from the vault's note list.
    pub fn new<'a>(notes: impl IntoIterator<Item = &'a String>) -> Self {
        let mut r = Self::default();
        for path in notes {
            let key = normalize_target(path);
            let stem = key.rsplit('/').next().unwrap_or(&key).to_string();
            // Folder notes stored as "<folder>/index.md" also answer to the
            // folder's name, so [[hardware]] finds hardware/index.md.
            if stem == "index" {
                if let Some((dir, _)) = key.rsplit_once('/') {
                    let folder = dir.rsplit('/').next().unwrap_or(dir).to_string();
                    r.by_stem.entry(folder).or_default().push(path.clone());
                    r.by_path.entry(dir.to_string()).or_insert_with(|| path.clone());
                }
            }
            r.by_stem.entry(stem).or_default().push(path.clone());
            r.by_path.insert(key, path.clone());
        }
        r
    }

    /// Resolves a note-kind target as seen from the note at `from`.
    pub fn resolve(&self, target: &str, from: &str) -> Option<String> {
        let key = normalize_target(target);
        if key.is_empty() {
            return None;
        }
        if key.contains('/') {
            // Exact vault-relative path first, then "ends with /key".
            if let Some(p) = self.by_path.get(&key) {
                return Some(p.clone());
            }
            let suffix = format!("/{key}");
            return self
                .by_path
                .iter()
                .filter(|(k, _)| k.ends_with(&suffix))
                .map(|(_, p)| p)
                .min_by_key(|p| p.len())
                .cloned();
        }
        let candidates = self.by_stem.get(&key)?;
        let from_dir = parent_dir(from);
        candidates
            .iter()
            .min_by_key(|p| (parent_dir(p) != from_dir, p.len(), p.as_str()))
            .cloned()
    }
}

/// `"a/b/c.md"` → `"a/b"`, `"c.md"` → `""`.
pub fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_targets() {
        assert_eq!(classify("CPU"), LinkKind::Note);
        assert_eq!(classify("hardware/cpu.md"), LinkKind::Note);
        assert_eq!(classify("cpu#v1.2"), LinkKind::Note);
        assert_eq!(classify("https://example.com"), LinkKind::Url);
        assert_eq!(classify("~/books/sicp.pdf"), LinkKind::File);
        assert_eq!(classify("refs/manual.pdf"), LinkKind::File);
    }

    #[test]
    fn extracts_links_and_tags_but_not_in_code() {
        let src = "# Title\nSee [[CPU|the cpu]] and #hardware.\n`[[not]] #nope`\n```\n[[nope]]\n#nope\n```\nend #Lang/Rust";
        let ex = extract(src);
        let targets: Vec<_> = ex.links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["CPU"]);
        assert_eq!(ex.links[0].alias.as_deref(), Some("the cpu"));
        assert_eq!(ex.links[0].line, 2);
        assert_eq!(ex.links[0].context, "See [[CPU|the cpu]] and #hardware.");
        let tags: Vec<_> = ex.tags.iter().map(|t| t.tag.as_str()).collect();
        assert_eq!(tags, vec!["hardware", "lang/rust"]);
    }

    #[test]
    fn heading_is_not_a_tag() {
        assert!(extract("# Heading\n## Sub").tags.is_empty());
    }

    #[test]
    fn resolves_by_stem_and_path() {
        let notes: Vec<String> = ["hardware/cpu.md", "software/cpu.md", "index.md", "a/b/deep.md"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let r = Resolver::new(&notes);
        // Same-folder candidate preferred.
        assert_eq!(r.resolve("CPU", "software/os.md").as_deref(), Some("software/cpu.md"));
        assert_eq!(r.resolve("cpu", "hardware/x.md").as_deref(), Some("hardware/cpu.md"));
        assert_eq!(r.resolve("hardware/cpu", "index.md").as_deref(), Some("hardware/cpu.md"));
        assert_eq!(r.resolve("b/deep#Section", "index.md").as_deref(), Some("a/b/deep.md"));
        assert_eq!(r.resolve("missing", "index.md"), None);
    }

    #[test]
    fn folder_index_answers_to_folder_name() {
        let notes: Vec<String> = ["hardware/index.md", "hardware/cpu.md"].iter().map(|s| s.to_string()).collect();
        let r = Resolver::new(&notes);
        assert_eq!(r.resolve("hardware", "x.md").as_deref(), Some("hardware/index.md"));
    }
}
