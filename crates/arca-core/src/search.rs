//! Search: an in-memory Tantivy index plus a fuzzy/regex filename matcher.
//!
//! The index lives entirely in RAM (`Index::create_in_ram`) and is rebuilt
//! from the `.md` files every time a vault is opened. The files stay the only
//! source of truth, and indexing a few thousand notes takes milliseconds.
//!
//! Three kinds of search are offered:
//!
//! 1. **Filename:** [`match_filename`] does a subsequence fuzzy match (or a
//!    regex if the query is wrapped in `/…/`) over note paths. This runs on
//!    the plain path list and doesn't touch Tantivy.
//! 2. **Full-text:** [`SearchIndex::full_text`] runs a BM25 query over titles
//!    and bodies, optionally scoped to one folder.
//! 3. **Topic:** [`SearchIndex::topic`] matches the exact-keyword `tags` /
//!    `links` fields to find every note carrying a `#tag` or linking a
//!    `[[target]]`.

use regex::RegexBuilder;
use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, FuzzyTermQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{Field, IndexRecordOption, Schema, Value, STORED, STRING, TEXT};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use crate::error::Result;

/// RAM budget for the index writer. 50 MB is Tantivy's usual default and is
/// far more than a notes vault needs; it is an upper bound, not an allocation.
const WRITER_HEAP_BYTES: usize = 50_000_000;

/// Bytes of context kept on each side of the first hit in a snippet.
const SNIPPET_RADIUS: usize = 90;

/// A highlighted text fragment. Highlight ranges are **UTF-16 code unit**
/// offsets so the frontend can `slice()` JavaScript strings with them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Snippet {
    pub text: String,
    pub highlights: Vec<(u32, u32)>,
}

/// One full-text or topic search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextHit {
    pub path: String,
    pub title: String,
    pub score: f32,
    pub snippet: Snippet,
}

/// One filename search result.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub path: String,
    pub score: i64,
    /// UTF-16 offsets into `path` of the matched characters, for highlighting.
    pub indices: Vec<u32>,
}

/// Which keyword field a topic search looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopicKind {
    Tag,
    Link,
}

/// Everything the index needs to know about one note.
pub struct IndexDoc<'a> {
    pub path: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    /// Lower-cased tags without `#`.
    pub tags: Vec<String>,
    /// Normalised link targets (see [`crate::links::normalize_target`]).
    pub links: Vec<String>,
}

/// Handles to the schema fields, looked up once.
#[derive(Clone, Copy)]
struct Fields {
    /// Vault-relative path; the unique key (raw, untokenised).
    path: Field,
    title: Field,
    body: Field,
    /// Every ancestor folder of the note, for "search in this folder".
    dirs: Field,
    tags: Field,
    links: Field,
}

/// The in-memory Tantivy index for one vault.
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    fields: Fields,
}

impl SearchIndex {
    /// Creates an empty in-RAM index.
    pub fn new() -> Result<Self> {
        let mut sb = Schema::builder();
        // STRING = indexed as one exact token; TEXT = tokenised and lower-cased.
        let fields = Fields {
            path: sb.add_text_field("path", STRING | STORED),
            title: sb.add_text_field("title", TEXT | STORED),
            // Stored as well so snippets can be cut from it.
            body: sb.add_text_field("body", TEXT | STORED),
            dirs: sb.add_text_field("dirs", STRING),
            tags: sb.add_text_field("tags", STRING),
            links: sb.add_text_field("links", STRING),
        };
        let index = Index::create_in_ram(sb.build());
        let writer = index.writer(WRITER_HEAP_BYTES)?;
        // Manual reload: we call `reload()` right after each commit, so
        // searches see changes immediately instead of on a timer.
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            index,
            reader,
            writer,
            fields,
        })
    }

    /// Adds or replaces a note. Takes effect after [`Self::commit`].
    pub fn upsert(&mut self, d: &IndexDoc) -> Result<()> {
        let f = self.fields;
        self.remove(d.path);
        let mut document = doc!(
            f.path => d.path,
            f.title => d.title,
            f.body => d.body,
        );
        for dir in ancestor_dirs(d.path) {
            document.add_text(f.dirs, dir);
        }
        for t in &d.tags {
            document.add_text(f.tags, t);
        }
        for l in &d.links {
            document.add_text(f.links, l);
        }
        self.writer.add_document(document)?;
        Ok(())
    }

    /// Removes a note by path. Takes effect after [`Self::commit`].
    pub fn remove(&mut self, path: &str) {
        self.writer
            .delete_term(Term::from_field_text(self.fields.path, path));
    }

    /// Drops every document (used before a full re-scan).
    pub fn clear(&mut self) -> Result<()> {
        self.writer.delete_all_documents()?;
        Ok(())
    }

    /// Makes pending changes visible to searches.
    pub fn commit(&mut self) -> Result<()> {
        self.writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    /// Full-text search over titles and bodies.
    ///
    /// `query` uses Tantivy's syntax (`"exact phrase"`, `-exclude`, `a OR b`),
    /// parsed leniently so half-typed input never errors. Every term also
    /// matches as a prefix, so results appear while the user is still typing
    /// a word. `scope` limits results to one folder (vault-relative, no
    /// trailing slash); `None` or `""` searches the whole vault.
    ///
    /// With `case_sensitive`, results must contain every query word with the
    /// exact capitalisation typed. Tantivy's index is lower-cased, so it
    /// finds candidates and they're filtered here.
    pub fn full_text(&self, query: &str, scope: Option<&str>, limit: usize, case_sensitive: bool) -> Result<Vec<TextHit>> {
        let f = self.fields;
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut parser = QueryParser::for_index(&self.index, vec![f.title, f.body]);
        // All words must match (like most note apps), not any word.
        parser.set_conjunction_by_default();
        // A hit in the title counts more than one buried in the body.
        parser.set_field_boost(f.title, 2.0);
        // Prefix matching with edit distance 0: "regi" finds "registers".
        parser.set_field_fuzzy(f.title, true, 0, false);
        parser.set_field_fuzzy(f.body, true, 0, false);
        // Lenient parsing returns a best-effort query plus errors we ignore.
        let (text_query, _errors) = parser.parse_query_lenient(query);

        let full: Box<dyn Query> = match scope.filter(|s| !s.is_empty()) {
            Some(dir) => Box::new(BooleanQuery::new(vec![
                (Occur::Must, text_query),
                (Occur::Must, Box::new(term_query(f.dirs, dir))),
            ])),
            None => text_query,
        };
        self.collect_hits(full.as_ref(), limit, &query_words(query, case_sensitive), case_sensitive)
    }

    /// Topic search: every note carrying `#tag` (or linking to `target`).
    /// The term is matched as a prefix, so `#hard` finds `#hardware`.
    pub fn topic(&self, kind: TopicKind, term: &str, limit: usize) -> Result<Vec<TextHit>> {
        let term = match kind {
            TopicKind::Tag => term.trim().trim_start_matches('#').to_lowercase(),
            TopicKind::Link => crate::links::normalize_target(
                term.trim().trim_start_matches("[[").trim_end_matches("]]"),
            ),
        };
        if term.is_empty() {
            return Ok(Vec::new());
        }
        let field = match kind {
            TopicKind::Tag => self.fields.tags,
            TopicKind::Link => self.fields.links,
        };
        // Distance 0 + prefix = pure prefix match over the exact keywords.
        let query = FuzzyTermQuery::new_prefix(Term::from_field_text(field, &term), 0, false);
        // Highlight the literal occurrences in snippets ("#hard…" / "[[cpu").
        let marker = match kind {
            TopicKind::Tag => format!("#{term}"),
            TopicKind::Link => format!("[[{term}"),
        };
        self.collect_hits(&query, limit, &[marker], false)
    }

    /// Runs a query and turns the top documents into [`TextHit`]s with a
    /// snippet built around the first occurrence of any of `words`.
    ///
    /// `case_sensitive` keeps only documents containing every word exactly
    /// as written (title or body). Extra candidates are fetched so that
    /// filtering still leaves up to `limit` results.
    fn collect_hits(&self, query: &dyn Query, limit: usize, words: &[String], case_sensitive: bool) -> Result<Vec<TextHit>> {
        let searcher = self.reader.searcher();
        let fetch = if case_sensitive { limit * 5 } else { limit };
        let top = searcher.search(query, &TopDocs::with_limit(fetch).order_by_score())?;
        let mut hits = Vec::with_capacity(top.len().min(limit));
        for (score, addr) in top {
            let d: TantivyDocument = searcher.doc(addr)?;
            // Reads a stored text field, defaulting to "".
            let get = |field: Field| {
                d.get_first(field)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string()
            };
            let body = get(self.fields.body);
            let title = get(self.fields.title);
            if case_sensitive && !words.iter().all(|w| body.contains(w.as_str()) || title.contains(w.as_str())) {
                continue; // matched only when ignoring case
            }
            hits.push(TextHit {
                path: get(self.fields.path),
                title,
                score,
                snippet: make_snippet(&body, words, case_sensitive),
            });
            if hits.len() == limit {
                break;
            }
        }
        Ok(hits)
    }
}

/// Exact-term query on a keyword field.
fn term_query(field: Field, text: &str) -> TermQuery {
    TermQuery::new(Term::from_field_text(field, text), IndexRecordOption::Basic)
}

/// `"a/b/c.md"` → `["a", "a/b"]`: every folder a note lives under.
fn ancestor_dirs(path: &str) -> Vec<&str> {
    path.match_indices('/').map(|(i, _)| &path[..i]).collect()
}

/// Extracts plain search words from a query string (for highlighting and
/// case-sensitive filtering): operators, field prefixes and excluded terms
/// (`-word`) are dropped. Lower-cased unless `case_sensitive`.
fn query_words(query: &str, case_sensitive: bool) -> Vec<String> {
    query
        .split(|c: char| c.is_whitespace() || c == '"' || c == '(' || c == ')')
        .filter(|w| !w.is_empty() && !w.starts_with('-'))
        .filter(|w| !matches!(*w, "AND" | "OR" | "NOT"))
        // `title:foo` → `foo`.
        .map(|w| w.rsplit(':').next().unwrap_or(w).trim_start_matches('+'))
        .filter(|w| !w.is_empty())
        .map(|w| if case_sensitive { w.to_string() } else { w.to_ascii_lowercase() })
        .collect()
}

/// Cuts a short fragment of `body` around the first hit of any word and
/// records where every word occurs inside it. Hits ignore case unless
/// `case_sensitive`.
///
/// ASCII-only lower-casing is used on purpose: it never changes byte
/// lengths, so offsets in the lowered copy are valid in the original.
fn make_snippet(body: &str, words: &[String], case_sensitive: bool) -> Snippet {
    // `lower` is the text matched against; with case sensitivity it's the
    // body itself.
    let lower = if case_sensitive { body.to_string() } else { body.to_ascii_lowercase() };
    let first = words.iter().filter_map(|w| lower.find(w.as_str())).min();

    // Window [start, end) around the first hit, snapped to char boundaries.
    let (start, end) = match first {
        Some(pos) => (pos.saturating_sub(SNIPPET_RADIUS), (pos + SNIPPET_RADIUS * 2).min(body.len())),
        None => (0, (SNIPPET_RADIUS * 2).min(body.len())),
    };
    let start = floor_char_boundary(body, start);
    let end = floor_char_boundary(body, end);

    // Newlines inside a one-line preview just look broken; flatten them.
    let text = body[start..end].replace(['\n', '\r', '\t'], " ");
    let lower_win = &lower[start..end];

    // Collect byte ranges of every word occurrence inside the window.
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for w in words.iter().filter(|w| !w.is_empty()) {
        let mut from = 0;
        while let Some(i) = lower_win[from..].find(w.as_str()) {
            let s = from + i;
            ranges.push((s, s + w.len()));
            from = s + w.len();
        }
    }
    ranges.sort_unstable();
    // Merge overlaps so the UI never draws nested highlights.
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for r in ranges {
        match merged.last_mut() {
            Some(last) if r.0 <= last.1 => last.1 = last.1.max(r.1),
            _ => merged.push(r),
        }
    }
    // Byte offsets → UTF-16 offsets. Flattening whitespace kept every byte
    // length the same, so the original window can be measured directly.
    let win = &body[start..end];
    let utf16 = |b: usize| win[..floor_char_boundary(win, b)].encode_utf16().count() as u32;
    Snippet {
        highlights: merged.into_iter().map(|(s, e)| (utf16(s), utf16(e))).collect(),
        text,
    }
}

/// Largest index `<= i` that is a valid char boundary of `s`.
fn floor_char_boundary(s: &str, i: usize) -> usize {
    let mut i = i.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

// ----------------------------------------------------------------------
// Filename matching
// ----------------------------------------------------------------------

/// Matches note paths against a query.
///
/// * `/pattern/` is a case-insensitive regex; hits are ranked by path length.
/// * Anything else is a fuzzy subsequence match: every query character must
///   appear in order. Matches score higher when they are consecutive, start
///   a word, or fall in the file name rather than the folder part.
///
/// Both ignore case unless `case_sensitive`.
pub fn match_filename(paths: &[String], query: &str, limit: usize, case_sensitive: bool) -> Result<Vec<FileHit>> {
    let query = query.trim();
    let mut hits: Vec<FileHit> = if query.len() >= 2 && query.starts_with('/') && query.ends_with('/') {
        let re = RegexBuilder::new(&query[1..query.len() - 1])
            .case_insensitive(!case_sensitive)
            .build()?;
        paths
            .iter()
            .filter_map(|p| {
                let m = re.find(p)?;
                Some(FileHit {
                    path: p.clone(),
                    // Shorter paths first, so negate the length.
                    score: -(p.len() as i64),
                    indices: utf16_range(p, m.start(), m.end()),
                })
            })
            .collect()
    } else {
        paths
            .iter()
            .filter_map(|p| {
                let (score, indices) = fuzzy_score(query, p, case_sensitive)?;
                Some(FileHit {
                    path: p.clone(),
                    score,
                    indices,
                })
            })
            .collect()
    };
    // Best score first; ties broken alphabetically for stable output.
    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.cmp(&b.path)));
    hits.truncate(limit);
    Ok(hits)
}

/// UTF-16 offsets of every character in the byte range `[s, e)` of `text`.
fn utf16_range(text: &str, s: usize, e: usize) -> Vec<u32> {
    let mut out = Vec::new();
    let mut pos = text[..s].encode_utf16().count() as u32;
    for ch in text[s..e].chars() {
        out.push(pos);
        pos += ch.len_utf16() as u32;
    }
    out
}

/// Greedy fuzzy subsequence scorer. Returns `None` if `query` is not a
/// subsequence of `candidate` (ignoring case unless `case_sensitive`), else
/// a score and the UTF-16 positions of the matched characters.
///
/// The `.md` extension is ignored so it never inflates or blocks a match.
fn fuzzy_score(query: &str, candidate: &str, case_sensitive: bool) -> Option<(i64, Vec<u32>)> {
    let haystack = candidate.strip_suffix(".md").unwrap_or(candidate);
    // Byte index where the file name (after the last "/") begins.
    let name_start = haystack.rfind('/').map_or(0, |i| i + 1);
    // Normalise a char for comparison: lower-cased unless case matters.
    let norm = |c: char| -> char {
        if case_sensitive { c } else { c.to_lowercase().next().unwrap_or(c) }
    };
    let mut q = query.chars().filter(|c| !c.is_whitespace()).map(norm).peekable();
    if q.peek().is_none() {
        return Some((0, Vec::new()));
    }

    let mut score: i64 = 0;
    let mut indices = Vec::new();
    let mut prev: Option<char> = None; // previous haystack char
    let mut prev_matched = false; // was the previous haystack char a match?
    let mut utf16_pos: u32 = 0;

    for (byte_i, ch) in haystack.char_indices() {
        if let Some(&want) = q.peek() {
            if norm(ch) == want {
                q.next();
                indices.push(utf16_pos);
                score += 1;
                if prev_matched {
                    score += 5; // consecutive run
                }
                // Start of a word: after a separator, or a camelCase hump.
                let at_word_start = match prev {
                    None => true,
                    Some(p) => matches!(p, '/' | '-' | '_' | ' ' | '.') || (p.is_lowercase() && ch.is_uppercase()),
                };
                if at_word_start {
                    score += 8;
                }
                if byte_i >= name_start {
                    score += 3; // in the file name rather than the folder path
                }
                prev_matched = true;
            } else {
                prev_matched = false;
            }
        }
        prev = Some(ch);
        utf16_pos += ch.len_utf16() as u32;
    }
    if q.peek().is_some() {
        return None; // not every query char was found
    }
    // Mildly prefer shorter paths.
    score -= (haystack.len() / 8) as i64;
    Some((score, indices))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds an index over a few fixed notes.
    fn index() -> SearchIndex {
        let mut ix = SearchIndex::new().unwrap();
        let docs = [
            ("hardware/cpu.md", "CPU", "Check the registers before calling CPUID. #hardware", vec!["hardware"], vec!["memory"]),
            ("hardware/memory.md", "Memory", "Caches and DRAM timings. #hardware #perf", vec!["hardware", "perf"], vec![]),
            ("software/os.md", "Operating systems", "Schedulers and registers of processes.", vec![], vec!["cpu"]),
        ];
        for (path, title, body, tags, links) in docs {
            ix.upsert(&IndexDoc {
                path,
                title,
                body,
                tags: tags.into_iter().map(String::from).collect(),
                links: links.into_iter().map(String::from).collect(),
            })
            .unwrap();
        }
        ix.commit().unwrap();
        ix
    }

    fn paths(hits: &[TextHit]) -> Vec<&str> {
        let mut v: Vec<_> = hits.iter().map(|h| h.path.as_str()).collect();
        v.sort();
        v
    }

    #[test]
    fn full_text_with_prefix_and_scope() {
        let ix = index();
        assert_eq!(paths(&ix.full_text("regis", None, 10, false).unwrap()), vec!["hardware/cpu.md", "software/os.md"]);
        assert_eq!(paths(&ix.full_text("regis", Some("hardware"), 10, false).unwrap()), vec!["hardware/cpu.md"]);
        // Half-typed syntax must not error.
        assert!(ix.full_text("\"unclosed", None, 10, false).is_ok());
    }

    #[test]
    fn case_sensitive_full_text() {
        let ix = index();
        // "CPUID" appears only upper-case; "cpuid" doesn't exist as typed.
        assert_eq!(paths(&ix.full_text("CPUID", None, 10, true).unwrap()), vec!["hardware/cpu.md"]);
        assert!(ix.full_text("cpuid", None, 10, true).unwrap().is_empty());
        assert_eq!(paths(&ix.full_text("cpuid", None, 10, false).unwrap()), vec!["hardware/cpu.md"]);
        // Highlights respect case too.
        let hit = &ix.full_text("CPUID", None, 10, true).unwrap()[0];
        assert_eq!(hit.snippet.highlights.len(), 1);
    }

    #[test]
    fn snippet_highlights_are_utf16() {
        let s = make_snippet("héllo registers", &["registers".into()], false);
        // "héllo " is 6 UTF-16 units (é is one unit) but 7 bytes.
        assert_eq!(s.highlights, vec![(6, 15)]);
    }

    #[test]
    fn topic_search_by_tag_and_link() {
        let ix = index();
        assert_eq!(paths(&ix.topic(TopicKind::Tag, "#hard", 10).unwrap()), vec!["hardware/cpu.md", "hardware/memory.md"]);
        assert_eq!(paths(&ix.topic(TopicKind::Tag, "perf", 10).unwrap()), vec!["hardware/memory.md"]);
        assert_eq!(paths(&ix.topic(TopicKind::Link, "[[CPU]]", 10).unwrap()), vec!["software/os.md"]);
    }

    #[test]
    fn upsert_replaces_and_remove_deletes() {
        let mut ix = index();
        ix.upsert(&IndexDoc { path: "software/os.md", title: "OS", body: "nothing here", tags: vec![], links: vec![] })
            .unwrap();
        ix.commit().unwrap();
        assert_eq!(paths(&ix.full_text("registers", None, 10, false).unwrap()), vec!["hardware/cpu.md"]);
        ix.remove("hardware/cpu.md");
        ix.commit().unwrap();
        assert!(ix.full_text("registers", None, 10, false).unwrap().is_empty());
    }

    #[test]
    fn fuzzy_filename_ranking() {
        let p: Vec<String> = ["hardware/cpu.md", "notes/copy-paste.md", "cpu-cache.md"].iter().map(|s| s.to_string()).collect();
        let hits = match_filename(&p, "cpu", 10, false).unwrap();
        // "copy-paste" has no "u", so it must not match.
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "cpu-cache.md"); // consecutive + word start + short
        assert!(match_filename(&p, "xyz", 10, false).unwrap().is_empty());
        // Case-sensitive: "CPU" isn't in any (lower-case) path.
        assert!(match_filename(&p, "CPU", 10, true).unwrap().is_empty());
        assert_eq!(match_filename(&p, "CPU", 10, false).unwrap().len(), 2);
        let re = match_filename(&p, "/^hard/", 10, false).unwrap();
        assert_eq!(re.len(), 1);
        assert_eq!(re[0].indices, vec![0, 1, 2, 3]);
    }
}
