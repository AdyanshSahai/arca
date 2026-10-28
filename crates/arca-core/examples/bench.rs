//! Backend benchmark: times the operations behind every Tauri command on a
//! real or generated vault. Used to compare debug and release builds.
//!
//!   cargo run -p arca-core --example bench -- <vault dir>        # debug
//!   cargo run -p arca-core --example bench --release -- <vault>  # release
//!   cargo run -p arca-core --example bench -- --generate <dir> <n>
//!       writes a synthetic vault of n linked, tagged notes into <dir>

use std::path::Path;
use std::time::Instant;

use arca_core::search::TopicKind;
use arca_core::Workspace;

/// Runs `f` `runs` times and prints the median time in milliseconds.
fn time<T>(label: &str, runs: usize, mut f: impl FnMut() -> T) {
    let mut samples: Vec<f64> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            std::hint::black_box(f()); // keep the optimiser from skipping the work
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{label:<28} {:>9.3} ms (median of {runs})", samples[runs / 2]);
}

/// Writes `n` notes in 20 chapters, each linking to a few others and tagged.
fn generate(dir: &Path, n: usize) {
    for i in 0..n {
        let chapter = dir.join(format!("chapter-{:02}", i % 20));
        std::fs::create_dir_all(&chapter).unwrap();
        let links: String = (1..=4).map(|k| format!("[[note-{}]] ", (i * 7 + k * 13) % n)).collect();
        let body = format!(
            "# Note {i}\n\nThis note discusses registers, caches and scheduling. {links}\n\n\
             #topic-{} #shared\n\n{}\n",
            i % 30,
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)
        );
        std::fs::write(chapter.join(format!("note-{i}.md")), body).unwrap();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--generate") {
        generate(Path::new(&args[1]), args[2].parse().unwrap());
        return;
    }
    let root = Path::new(&args[0]);
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    println!("== {} ({profile}) ==", root.display());

    time("open + index vault", 3, || Workspace::open(root).unwrap());
    let mut ws = Workspace::open(root).unwrap();
    // Optional second argument: the note to read/write (default: the first).
    let note = args.get(1).cloned().unwrap_or_else(|| ws.notes().first().map(|n| n.path.clone()).unwrap());
    let content = ws.read_note(&note).unwrap();
    println!("({} notes)", ws.notes().len());

    time("vault_tree", 20, || ws.tree().unwrap());
    time("list_notes", 20, || ws.notes());
    time("read_note", 20, || ws.read_note(&note).unwrap());
    // Autosave path: write + re-index + Tantivy commit.
    time("write_note (autosave)", 20, || ws.write_note(&note, &content).unwrap());
    // write_note = disk write + parse (links/tags/post-its) + index + commit.
    time("  parse links/tags", 20, || arca_core::links::extract(&content));
    time("  parse post-its", 20, || arca_core::postit::parse(&content));
    time("search_files \"reg\"", 20, || ws.search_files("reg", 50, false).unwrap());
    time("search_text \"registers\"", 20, || ws.search_text("registers", None, 50, false).unwrap());
    time("search_text case-sensitive", 20, || ws.search_text("Note", None, 50, true).unwrap());
    time("search_topic #shared", 20, || ws.search_topic(TopicKind::Tag, "shared", 50).unwrap());
    time("list_tags", 20, || ws.tags());
    time("graph", 20, || ws.graph());
    time("backlinks", 20, || ws.backlinks(&note));
    time("list_postits", 20, || ws.postits());
}
