//! Export pipeline: compiles a note, a chapter (folder, recursively) or the
//! whole vault into a single file, like OneNote's section/notebook export.
//!
//! Formats:
//!
//! * **HTML:** one standalone, print-friendly page with a table of
//!   contents. Open it in a browser and use Print → "Save as PDF" for a
//!   PDF. Local images are embedded as `data:` URIs so the file travels on
//!   its own.
//! * **Markdown:** the notes concatenated into one `.md` file, separated
//!   by horizontal rules.
//!
//! Reading order for a chapter: its folder note (overview) first, then its
//! notes, then each sub-chapter in turn, alphabetically.
//!
//! Arca-specific syntax is translated so other tools understand it:
//! `[[links]]` to exported notes become in-document links (HTML) or plain
//! text (Markdown). Post-its and `> [!CALLOUT]` blocks become styled boxes
//! in HTML.

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use base64::Engine;
use pulldown_cmark::{html, Options, Parser};
use regex::Regex;
use serde::Deserialize;

use crate::error::{CoreError, Result};
use crate::links::{classify, LinkKind, Resolver};
use crate::postit;
use crate::vault::{is_note_path, TreeNode, Vault};

/// Output format requested by the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Html,
    Markdown,
}

/// The finished document plus how many notes went into it.
pub struct Exported {
    pub content: String,
    pub notes: usize,
}

/// One note in reading order.
struct Item {
    path: String,
    /// Folder depth below the export root (0 = top), used for the TOC.
    depth: usize,
    title: String,
    body: String,
}

static WIKI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\[\]\n]+?)\]\]").unwrap());
/// `![alt](src)` with a local (non-URL) src.
static IMG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"!\[([^\]]*)\]\(([^)\s]+)\)"#).unwrap());

/// Exports `scope`: "" for the whole vault, a folder path, or a note path.
pub fn export(vault: &Vault, scope: &str, format: ExportFormat) -> Result<Exported> {
    let items = collect(vault, scope)?;
    if items.is_empty() {
        return Err(CoreError::NotFound(format!("no notes to export in “{scope}”")));
    }
    let content = match format {
        ExportFormat::Markdown => to_markdown(&items),
        ExportFormat::Html => to_html(vault, scope, &items),
    };
    Ok(Exported { content, notes: items.len() })
}

// ----------------------------------------------------------------------
// Collecting notes in reading order
// ----------------------------------------------------------------------

fn collect(vault: &Vault, scope: &str) -> Result<Vec<Item>> {
    let mut paths: Vec<(String, usize)> = Vec::new();
    if is_note_path(Path::new(scope)) {
        paths.push((scope.to_string(), 0));
    } else {
        let tree = vault.tree()?;
        let node = find(&tree, scope).ok_or_else(|| CoreError::NotFound(scope.to_string()))?;
        walk(node, 0, &mut paths);
    }
    let mut items = Vec::with_capacity(paths.len());
    for (path, depth) in paths {
        let body = vault.read_note(&path)?;
        items.push(Item { title: title_of(&path, &body), path, depth, body });
    }
    Ok(items)
}

/// Finds a folder node by path ("" = the root).
fn find<'a>(node: &'a TreeNode, path: &str) -> Option<&'a TreeNode> {
    if node.path == path {
        return Some(node);
    }
    node.children
        .iter()
        .filter(|c| c.is_dir && (path == c.path || path.starts_with(&format!("{}/", c.path))))
        .find_map(|c| find(c, path))
}

/// Folder note, then the folder's notes, then each sub-folder.
fn walk(node: &TreeNode, depth: usize, out: &mut Vec<(String, usize)>) {
    if let Some(note) = &node.note_path {
        out.push((note.clone(), depth));
    }
    let child_depth = if node.note_path.is_some() { depth + 1 } else { depth };
    for c in node.children.iter().filter(|c| c.is_note) {
        out.push((c.path.clone(), child_depth));
    }
    for c in node.children.iter().filter(|c| c.is_dir) {
        walk(c, child_depth, out);
    }
}

/// First "# Heading", else the file stem (same rule as the workspace).
fn title_of(path: &str, body: &str) -> String {
    body.lines()
        .find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default())
}

/// HTML id for a note's section.
fn anchor(path: &str) -> String {
    let slug: String = path
        .trim_end_matches(".md")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    format!("note-{slug}")
}

/// Splits `target|alias` into (target, label).
fn split_link(inner: &str) -> (&str, &str) {
    match inner.split_once('|') {
        Some((t, a)) => (t.trim(), a.trim()),
        None => (inner.trim(), inner.trim()),
    }
}

// ----------------------------------------------------------------------
// Markdown
// ----------------------------------------------------------------------

fn to_markdown(items: &[Item]) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|it| {
            // [[x|label]] → "label", [[https://…|label]] → [label](https://…)
            let body = WIKI_RE.replace_all(&it.body, |c: &regex::Captures| {
                let (target, label) = split_link(&c[1]);
                match classify(target) {
                    LinkKind::Url => format!("[{label}]({target})"),
                    _ => label.to_string(),
                }
            });
            body.trim_end().to_string()
        })
        .collect();
    format!("{}\n", parts.join("\n\n---\n\n"))
}

// ----------------------------------------------------------------------
// HTML
// ----------------------------------------------------------------------

fn to_html(vault: &Vault, scope: &str, items: &[Item]) -> String {
    // Links resolve against the whole vault, but only exported notes can
    // become in-page anchors.
    let all = vault.list_notes();
    let resolver = Resolver::new(&all);
    let exported: HashMap<&str, String> = items.iter().map(|i| (i.path.as_str(), anchor(&i.path))).collect();

    let mut toc = String::new();
    let mut sections = String::new();
    for it in items {
        let md = prepare(vault, it, &resolver, &exported);
        let mut body = String::new();
        let opts = Options::ENABLE_TABLES
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_FOOTNOTES;
        html::push_html(&mut body, Parser::new_ext(&md, opts));
        let id = anchor(&it.path);
        toc.push_str(&format!(
            "<li style=\"margin-left:{}em\"><a href=\"#{id}\">{}</a></li>\n",
            it.depth as f32 * 1.2,
            escape(&it.title)
        ));
        sections.push_str(&format!(
            "<section id=\"{id}\">\n<div class=\"path\">{}</div>\n{body}</section>\n",
            escape(&it.path)
        ));
    }

    let title = if items.len() == 1 {
        items[0].title.clone()
    } else if scope.is_empty() {
        vault.root().file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Vault".into())
    } else {
        scope.rsplit('/').next().unwrap_or(scope).to_string()
    };
    let toc_html = if items.len() > 1 {
        format!("<nav class=\"toc\"><h2>Contents</h2><ul>\n{toc}</ul></nav>")
    } else {
        String::new()
    };
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{t}</title>\n<style>{CSS}</style>\n\
         <link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css\">\n\
         <script defer src=\"https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js\"></script>\n\
         <script defer src=\"https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js\" \
         onload=\"renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})\"></script>\n\
         </head>\n<body>\n<header><h1>{t}</h1><p class=\"meta\">Exported from Arca · {n} note{s}</p></header>\n\
         {toc_html}\n{sections}</body>\n</html>\n",
        t = escape(&title),
        n = items.len(),
        s = if items.len() == 1 { "" } else { "s" },
    )
}

/// Rewrites one note's markdown before rendering: links, post-its,
/// callouts and local images.
fn prepare(vault: &Vault, it: &Item, resolver: &Resolver, exported: &HashMap<&str, String>) -> String {
    // 1. Post-its → <aside> boxes. The blank lines let markdown inside work.
    let mut md = it.body.clone();
    for p in postit::parse(&it.body).into_iter().rev() {
        let (start, end) = p.span;
        let block = format!(
            "<aside class=\"postit {c}\">\n<div class=\"label\">Post-it</div>\n\n{text}\n\n</aside>",
            c = escape(&p.color),
            text = p.text
        );
        md.replace_range(start..end, &block);
    }

    // 2. Callouts: "> [!TYPE] title" blocks → <div class="callout type">.
    md = convert_callouts(&md);

    // 3. Wiki-links.
    md = WIKI_RE
        .replace_all(&md, |c: &regex::Captures| {
            let (target, label) = split_link(&c[1]);
            match classify(target) {
                LinkKind::Url => format!("[{label}]({target})"),
                LinkKind::File => label.to_string(),
                LinkKind::Note => match resolver.resolve(target, &it.path).and_then(|p| exported.get(p.as_str()).cloned()) {
                    Some(id) => format!("[{label}](#{id})"),
                    // Outside the export (or missing): keep the text, drop the link.
                    None => format!("<span class=\"missing\">{}</span>", escape(label)),
                },
            }
        })
        .into_owned();

    // 4. Local images → embedded data: URIs so the HTML is self-contained.
    let dir = crate::links::parent_dir(&it.path).to_string();
    IMG_RE
        .replace_all(&md, |c: &regex::Captures| {
            let (alt, src) = (&c[1], &c[2]);
            if src.contains("://") || src.starts_with("data:") {
                return c[0].to_string();
            }
            let rel = if dir.is_empty() { src.to_string() } else { format!("{dir}/{src}") };
            match embed(vault, &rel) {
                Some(uri) => format!("![{alt}]({uri})"),
                None => c[0].to_string(),
            }
        })
        .into_owned()
}

/// Reads a vault file and returns it as a base64 `data:` URI (images only).
fn embed(vault: &Vault, rel: &str) -> Option<String> {
    let mime = match Path::new(rel).extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    };
    let bytes = std::fs::read(vault.resolve(rel).ok()?).ok()?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Turns Obsidian-style callout blockquotes into HTML divs.
fn convert_callouts(md: &str) -> String {
    static HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*>\s*\[!([A-Za-z]+)\][+-]?\s*(.*)$").unwrap());
    let mut out = String::with_capacity(md.len());
    let mut lines = md.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(c) = HEAD.captures(line) else {
            out.push_str(line);
            out.push('\n');
            continue;
        };
        let kind = c[1].to_lowercase();
        let title = if c[2].trim().is_empty() { kind.clone() } else { c[2].trim().to_string() };
        out.push_str(&format!(
            "<div class=\"callout {k}\">\n<div class=\"callout-title\">{t}</div>\n\n",
            k = escape(&kind),
            t = escape(&title)
        ));
        // Body: following "> " lines, unquoted.
        while let Some(next) = lines.peek() {
            let trimmed = next.trim_start();
            if !trimmed.starts_with('>') {
                break;
            }
            out.push_str(trimmed.trim_start_matches('>').strip_prefix(' ').unwrap_or(trimmed.trim_start_matches('>')));
            out.push('\n');
            lines.next();
        }
        out.push_str("\n</div>\n");
    }
    out
}

/// Minimal HTML escaping for text we interpolate ourselves.
fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Print-friendly light theme for exported HTML. Light on purpose: these
/// files get printed and shared, where a dark page wastes ink.
const CSS: &str = r#"
:root { --fg:#1d1724; --muted:#6b5c78; --line:#e4dcea; --accent:#8a3f9e; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 780px; padding: 48px 32px; color: var(--fg);
  font: 16px/1.7 "Inter", system-ui, sans-serif; }
header h1 { font-size: 2.2em; margin: 0 0 4px; letter-spacing: -0.02em; }
.meta { color: var(--muted); margin: 0 0 32px; font-size: 14px; }
.toc { border: 1px solid var(--line); border-radius: 8px; padding: 16px 24px; margin-bottom: 48px; }
.toc h2 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc a { color: var(--fg); text-decoration: none; }
.toc a:hover { color: var(--accent); }
section { padding-top: 24px; margin-top: 24px; border-top: 1px solid var(--line); }
section:first-of-type { border-top: none; }
.path { font-size: 12px; color: var(--muted); }
h1, h2, h3 { line-height: 1.3; }
a { color: var(--accent); }
code { font: 0.9em "JetBrains Mono", ui-monospace, monospace; background: #f4eff7; padding: 1px 4px; border-radius: 3px; }
pre { background: #f4eff7; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 6px 12px; }
th { background: #f7f3f9; }
blockquote { margin: 0; padding: 2px 16px; border-left: 3px solid var(--line); color: var(--muted); }
img { max-width: 100%; }
.missing { border-bottom: 1px dashed var(--muted); }
.postit, .callout { border-left: 4px solid var(--c, #bc8bca); background: color-mix(in srgb, var(--c, #bc8bca) 12%, white);
  border-radius: 6px; padding: 8px 16px; margin: 16px 0; }
.postit .label, .callout-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--c); }
.postit.purple { --c:#9b5fb0 } .postit.magenta { --c:#c04fc0 } .postit.blue { --c:#4f74c9 }
.postit.green { --c:#3f9a63 } .postit.amber { --c:#b8892a }
.callout { --c:#4f74c9 } .callout.tip, .callout.success { --c:#3f9a63 }
.callout.warning, .callout.question { --c:#b8892a } .callout.danger, .callout.bug, .callout.error { --c:#c94f6d }
@media print {
  body { padding: 0; max-width: none; }
  section { break-before: page; border-top: none; }
  .toc { break-after: page; }
  a { color: inherit; }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("hw/cpu")).unwrap();
        fs::write(root.join("hw/hw.md"), "# Hardware\n\nSee [[cpu]] and [[nowhere]].\n").unwrap();
        fs::write(root.join("hw/disk.md"), "# Disk\n\n> [!WARNING] Careful\n> Spinning rust.\n").unwrap();
        fs::write(
            root.join("hw/cpu/cpu.md"),
            "# CPU\n\n<!-- postit:id=1 color=green -->\n> **Post-it:** Registers!\n<!-- /postit -->\n\n[[https://x.org|site]]\n",
        )
        .unwrap();
        let v = Vault::open(root).unwrap();
        (dir, v)
    }

    #[test]
    fn chapter_order_is_overview_notes_then_subchapters() {
        let (_d, v) = vault();
        let order: Vec<_> = collect(&v, "hw").unwrap().into_iter().map(|i| (i.path, i.depth)).collect();
        assert_eq!(
            order,
            vec![("hw/hw.md".into(), 0), ("hw/disk.md".into(), 1), ("hw/cpu/cpu.md".into(), 1)]
        );
    }

    #[test]
    fn html_translates_arca_syntax() {
        let (_d, v) = vault();
        let out = export(&v, "hw", ExportFormat::Html).unwrap();
        assert_eq!(out.notes, 3);
        let h = out.content;
        assert!(h.contains("<a href=\"#note-hw-cpu-cpu\">cpu</a>"), "internal link");
        assert!(h.contains("<span class=\"missing\">nowhere</span>"), "missing link kept as text");
        assert!(h.contains("<aside class=\"postit green\">") && h.contains("Registers!"), "post-it box");
        assert!(h.contains("<div class=\"callout warning\">") && h.contains("Spinning rust."), "callout box");
        assert!(h.contains("href=\"https://x.org\""), "external link");
        assert!(h.contains("class=\"toc\""), "table of contents");
    }

    #[test]
    fn markdown_flattens_links() {
        let (_d, v) = vault();
        let out = export(&v, "hw/hw.md", ExportFormat::Markdown).unwrap();
        assert_eq!(out.notes, 1);
        assert!(out.content.contains("See cpu and nowhere."));
    }

    #[test]
    fn empty_scope_is_an_error() {
        let (_d, v) = vault();
        fs::create_dir_all(v.root().join("empty")).unwrap();
        assert!(export(&v, "empty", ExportFormat::Html).is_err());
    }
}
