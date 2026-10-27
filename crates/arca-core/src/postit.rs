//! Post-it notes: small annotations embedded inside a parent note.
//!
//! On disk a post-it is plain markdown wrapped in HTML comments, so any other
//! markdown tool still renders it as an ordinary blockquote:
//!
//! ```markdown
//! <!-- postit:id=k3x9 color=purple -->
//! > **Post-it:** Check hardware registers before calling CPUID.
//! <!-- /postit -->
//! ```
//!
//! This module finds those blocks, exposes their *display text* (the body
//! without the `> **Post-it:**` decoration), and can rewrite one block's text
//! in place while leaving the rest of the file byte-for-byte unchanged.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;

/// Opening marker on its own line, e.g. `<!-- postit:id=1 color=purple -->`.
/// Group 1 captures the attribute list (`id=1 color=purple`).
static OPEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^[ \t]*<!--[ \t]*postit:([^\n]*?)[ \t]*-->[ \t]*$").unwrap());

/// Closing marker on its own line: `<!-- /postit -->`.
static CLOSE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^[ \t]*<!--[ \t]*/postit[ \t]*-->[ \t]*$").unwrap());

/// The bold label the spec puts in front of the first body line.
const LABEL: &str = "**Post-it:**";

/// Colours the UI knows how to paint. Unknown values are kept as-is in the
/// file; the frontend just falls back to purple for them.
pub const DEFAULT_COLOR: &str = "purple";

/// One parsed post-it block.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PostIt {
    pub id: String,
    pub color: String,
    /// The text a human edits: blockquote markers and label stripped.
    pub text: String,
    /// 1-based line number of the opening marker, so the UI can jump to it.
    pub line: usize,
    /// Byte range of the whole block (opening marker through closing marker).
    #[serde(skip)]
    pub span: (usize, usize),
}

/// Finds every well-formed post-it in a document, in order.
///
/// An opening marker without a matching close is ignored rather than
/// swallowing the rest of the file. Nested post-its are not supported; the
/// first `<!-- /postit -->` after an opener always closes it.
pub fn parse(src: &str) -> Vec<PostIt> {
    let mut out = Vec::new();
    // Start searching for the next opener after the previous block's end, so
    // a stray opener inside a body can't start a bogus overlapping block.
    let mut cursor = 0;
    while let Some(open) = OPEN_RE.captures_at(src, cursor) {
        let whole = open.get(0).unwrap();
        let Some(close) = CLOSE_RE.find_at(src, whole.end()) else {
            break;
        };
        let attrs = parse_attrs(&open[1]);
        let body = &src[whole.end()..close.start()];
        out.push(PostIt {
            id: attrs.id.unwrap_or_default(),
            color: attrs.color.unwrap_or_else(|| DEFAULT_COLOR.to_string()),
            text: body_to_text(body),
            // Count newlines before the marker to get its 1-based line.
            line: src[..whole.start()].matches('\n').count() + 1,
            span: (whole.start(), close.end()),
        });
        cursor = close.end();
    }
    out
}

/// Attributes from the opening marker.
struct Attrs {
    id: Option<String>,
    color: Option<String>,
}

/// Parses `id=123 color="purple"` style key/value pairs. Unknown keys are
/// ignored so future attributes don't break older builds.
fn parse_attrs(raw: &str) -> Attrs {
    let mut attrs = Attrs { id: None, color: None };
    for pair in raw.split_whitespace() {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        // Allow optional quotes around the value.
        let value = value.trim_matches(|c| c == '"' || c == '\'').to_string();
        match key {
            "id" => attrs.id = Some(value),
            "color" => attrs.color = Some(value),
            _ => {}
        }
    }
    attrs
}

/// Converts the raw block body into editable text: strips the leading `>`
/// from every line and the `**Post-it:**` label from the first one.
pub fn body_to_text(body: &str) -> String {
    let mut lines: Vec<&str> = body
        .trim_matches('\n')
        .lines()
        // "> foo" -> "foo", ">" -> "", anything else is kept verbatim.
        .map(|l| l.strip_prefix("> ").or_else(|| l.strip_prefix('>')).unwrap_or(l))
        .collect();
    if let Some(first) = lines.first_mut() {
        if let Some(rest) = first.trim_start().strip_prefix(LABEL) {
            *first = rest.trim_start();
        }
    }
    lines.join("\n")
}

/// The inverse of [`body_to_text`]: wraps editable text back into the
/// blockquote format from the spec.
pub fn text_to_body(text: &str) -> String {
    let text = text.trim_end();
    let mut out = String::new();
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push('>');
        if i == 0 {
            out.push(' ');
            out.push_str(LABEL);
        }
        if !line.is_empty() {
            out.push(' ');
            out.push_str(line);
        }
    }
    out
}

/// Renders a complete block ready to be inserted into a note.
pub fn render_block(id: &str, color: &str, text: &str) -> String {
    format!(
        "<!-- postit:id={id} color={color} -->\n{}\n<!-- /postit -->",
        text_to_body(text)
    )
}

/// Replaces the text (and optionally colour) of the post-it with `id`.
///
/// Returns the new document, or `None` if no such post-it exists. Bytes
/// outside the block are untouched.
pub fn update(src: &str, id: &str, text: &str, color: Option<&str>) -> Option<String> {
    let target = parse(src).into_iter().find(|p| p.id == id)?;
    let color = color.unwrap_or(&target.color);
    let (start, end) = target.span;
    Some(format!("{}{}{}", &src[..start], render_block(id, color, text), &src[end..]))
}

/// Generates a short id that is unique enough for one note: base-36
/// milliseconds since 2024 plus a process-local counter, so ids made in the
/// same millisecond still differ.
pub fn new_id() -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    // 2024-01-01T00:00:00Z keeps the numbers (and so the ids) short.
    const EPOCH_2024_MS: u128 = 1_704_067_200_000;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().saturating_sub(EPOCH_2024_MS))
        .unwrap_or(0);
    // Mixing in the counter in the low digits keeps ids ordered by time.
    let n = (ms as u64) * 36 + u64::from(COUNTER.fetch_add(1, Ordering::Relaxed) % 36);
    to_base36(n)
}

/// Unsigned integer → lowercase base-36 string.
fn to_base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    buf.reverse();
    String::from_utf8(buf).expect("base36 digits are ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "# CPU\n\nIntro.\n\n<!-- postit:id=123 color=purple -->\n> **Post-it:** Check hardware registers before calling CPUID.\n<!-- /postit -->\n\nMore text.\n";

    #[test]
    fn parses_spec_example() {
        let p = parse(DOC);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].id, "123");
        assert_eq!(p[0].color, "purple");
        assert_eq!(p[0].text, "Check hardware registers before calling CPUID.");
        assert_eq!(p[0].line, 5);
    }

    #[test]
    fn update_only_touches_the_block() {
        let new = update(DOC, "123", "First line\n\nSecond", Some("magenta")).unwrap();
        assert!(new.starts_with("# CPU\n\nIntro.\n\n<!-- postit:id=123 color=magenta -->\n"));
        assert!(new.contains("> **Post-it:** First line\n>\n> Second\n<!-- /postit -->"));
        assert!(new.ends_with("\n\nMore text.\n"));
        // Round-trips back to the same text.
        assert_eq!(parse(&new)[0].text, "First line\n\nSecond");
        assert!(update(DOC, "nope", "x", None).is_none());
    }

    #[test]
    fn unterminated_block_is_ignored() {
        assert!(parse("<!-- postit:id=1 -->\n> hi\n").is_empty());
    }

    #[test]
    fn multiple_blocks_and_defaults() {
        let doc = format!("{}\n\n{}", render_block("a", "green", "one"), render_block("b", "purple", "two"));
        let ids: Vec<_> = parse(&doc).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["a", "b"]);
        assert_eq!(parse("<!-- postit:id=x -->\n> y\n<!-- /postit -->")[0].color, "purple");
    }

    #[test]
    fn ids_are_unique() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
    }
}
