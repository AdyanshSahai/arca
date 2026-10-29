//! IPC commands exposed to the frontend.
//!
//! Each function is callable from TypeScript as
//! `invoke("snake_case_name", { camelCaseArgs })`; the typed wrappers live
//! in `src/lib/ipc.ts`. All commands are `async` so Tauri runs them on its
//! worker pool instead of blocking the UI thread.
//!
//! Every path argument is **vault-relative**; `arca-core` rejects anything
//! that tries to leave the vault.

use std::path::PathBuf;

use arca_core::postit;
use arca_core::search::{FileHit, TextHit, TopicKind};
use arca_core::vault::{TrashEntry, TreeNode};
use arca_core::history::{History, Snapshot};
use arca_core::workspace::{Backlink, Graph, LinkTarget, NoteInfo, PostItEntry, RenameReport, RestoreReport, TagCount};
use arca_core::Workspace;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{CmdError, CmdResult};
use crate::settings::{self, Pin, VaultSettings, VAULT_META_DIR};
use crate::state::AppState;
use crate::watcher;

/// Default cap on search results; the UI never shows more than this.
const DEFAULT_LIMIT: usize = 50;

// ----------------------------------------------------------------------
// Profiling (only active when the ARCA_PROFILE environment variable is set)
// ----------------------------------------------------------------------

/// True when Arca was started with ARCA_PROFILE set; checked once.
fn profiling() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("ARCA_PROFILE").is_some())
}

/// Prints how long a command took when it goes out of scope (profiling
/// only). Each command starts with `let _t = timed("name");`.
struct Timed {
    name: &'static str,
    start: std::time::Instant,
}

impl Drop for Timed {
    fn drop(&mut self) {
        if profiling() {
            eprintln!("[arca-perf] cmd {} {:.3}ms", self.name, self.start.elapsed().as_secs_f64() * 1000.0);
        }
    }
}

fn timed(name: &'static str) -> Timed {
    Timed { name, start: std::time::Instant::now() }
}

/// Lets the frontend's profiling run write its results to the same log
/// (stderr). Does nothing unless profiling.
#[tauri::command]
pub async fn perf_log(line: String) -> CmdResult<()> {
    if profiling() {
        eprintln!("[arca-perf] {line}");
    }
    Ok(())
}

// ----------------------------------------------------------------------
// App / vault lifecycle
// ----------------------------------------------------------------------

/// What the frontend needs at startup.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateDto {
    /// Last opened vault, if any (the frontend reopens it automatically).
    pub vault_path: Option<String>,
    pub ui: serde_json::Value,
}

#[tauri::command]
pub async fn app_state(state: State<'_, AppState>) -> CmdResult<AppStateDto> {
    let _t = timed("app_state");
    let s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
    Ok(AppStateDto {
        vault_path: s.vault_path.clone(),
        ui: s.ui.clone(),
    })
}

/// Stores the frontend's layout blob (called debounced on layout changes).
#[tauri::command]
pub async fn save_ui(state: State<'_, AppState>, ui: serde_json::Value) -> CmdResult<()> {
    let _t = timed("save_ui");
    state.settings.lock().unwrap_or_else(|e| e.into_inner()).ui = ui;
    state.save_settings()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// Canonical absolute path.
    pub root: String,
    /// Folder name, shown in the title bar.
    pub name: String,
}

/// Opens (indexes + watches) a vault folder and remembers it for next time.
#[tauri::command]
pub async fn open_vault(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<VaultInfo> {
    let _t = timed("open_vault");
    // Index first, without holding any lock, so a slow scan never blocks
    // other commands touching the previous vault.
    let ws = Workspace::open(&path)?;
    let root: PathBuf = ws.root().to_path_buf();

    // Stop the old watcher before swapping vaults so its callback can't
    // refresh the new workspace with paths from the old one.
    *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = None;
    // History belongs to the old vault; the frontend restarts it if enabled.
    *state.history.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *state.lock_ws() = Some(ws);
    // Let the webview load images from this vault (and only this vault)
    // through the asset protocol; nothing is allowed statically.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| CmdError(format!("cannot allow vault assets: {e}")))?;
    let w = watcher::start(app, &root).map_err(|e| CmdError(format!("cannot watch vault: {e}")))?;
    *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = Some(w);

    {
        let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
        s.vault_path = Some(root.to_string_lossy().into_owned());
    }
    state.save_settings()?;

    Ok(VaultInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        root: root.to_string_lossy().into_owned(),
    })
}

// ----------------------------------------------------------------------
// Files
// ----------------------------------------------------------------------

#[tauri::command]
pub async fn vault_tree(state: State<'_, AppState>) -> CmdResult<TreeNode> {
    let _t = timed("vault_tree");
    state.with_ws(|ws| Ok(ws.tree()?))
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>) -> CmdResult<Vec<NoteInfo>> {
    let _t = timed("list_notes");
    state.with_ws(|ws| Ok(ws.notes()))
}

#[tauri::command]
pub async fn read_note(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let _t = timed("read_note");
    state.with_ws(|ws| Ok(ws.read_note(&path)?))
}

#[tauri::command]
pub async fn write_note(state: State<'_, AppState>, path: String, content: String) -> CmdResult<()> {
    let _t = timed("write_note");
    // Marked *before* writing: the watcher may fire before we return.
    state.mark_written(&path);
    state.with_ws_mut(|ws| Ok(ws.write_note(&path, &content)?))
}

/// Creates a note; returns its final path (".md" appended if missing).
#[tauri::command]
pub async fn create_note(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let _t = timed("create_note");
    state.with_ws_mut(|ws| Ok(ws.create_note(&path)?))
}

#[tauri::command]
pub async fn create_folder(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let _t = timed("create_folder");
    state.with_ws_mut(|ws| Ok(ws.create_folder(&path)?))
}

#[tauri::command]
pub async fn rename_entry(state: State<'_, AppState>, from: String, to: String) -> CmdResult<RenameReport> {
    let _t = timed("rename_entry");
    state.with_ws_mut(|ws| Ok(ws.rename(&from, &to)?))
}

/// Sets the custom order of a folder's children ("" = vault root).
#[tauri::command]
pub async fn set_order(state: State<'_, AppState>, dir: String, names: Vec<String>) -> CmdResult<()> {
    let _t = timed("set_order");
    state.with_ws(|ws| Ok(ws.vault().set_order(&dir, names)?))
}

/// Everything in the vault's trash, newest first.
#[tauri::command]
pub async fn list_trash(state: State<'_, AppState>) -> CmdResult<Vec<TrashEntry>> {
    let _t = timed("list_trash");
    state.with_ws(|ws| Ok(ws.vault().list_trash()?))
}

/// Restores a trashed item to where it came from; returns its path.
#[tauri::command]
pub async fn restore_trash(state: State<'_, AppState>, trash_path: String) -> CmdResult<String> {
    let _t = timed("restore_trash");
    state.with_ws_mut(|ws| Ok(ws.restore_trash(&trash_path)?))
}

/// Permanently deletes one trashed item.
#[tauri::command]
pub async fn delete_trash(state: State<'_, AppState>, trash_path: String) -> CmdResult<()> {
    let _t = timed("delete_trash");
    state.with_ws(|ws| Ok(ws.vault().delete_trash(&trash_path)?))
}

/// Moves a note/folder to `.trash/`; returns where it went.
#[tauri::command]
pub async fn trash_entry(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let _t = timed("trash_entry");
    state.with_ws_mut(|ws| Ok(ws.trash(&path)?))
}

// ----------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------

#[tauri::command]
pub async fn search_files(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    case_sensitive: Option<bool>,
) -> CmdResult<Vec<FileHit>> {
    let _t = timed("search_files");
    state.with_ws(|ws| Ok(ws.search_files(&query, limit.unwrap_or(DEFAULT_LIMIT), case_sensitive.unwrap_or(false))?))
}

/// Full-text search. `scope` is a folder path; omit it to search everything.
#[tauri::command]
pub async fn search_text(
    state: State<'_, AppState>,
    query: String,
    scope: Option<String>,
    limit: Option<usize>,
    case_sensitive: Option<bool>,
) -> CmdResult<Vec<TextHit>> {
    let _t = timed("search_text");
    let cs = case_sensitive.unwrap_or(false);
    state.with_ws(|ws| Ok(ws.search_text(&query, scope.as_deref(), limit.unwrap_or(DEFAULT_LIMIT), cs)?))
}

/// Topic search. `kind` is `"tag"` or `"link"`.
#[tauri::command]
pub async fn search_topic(
    state: State<'_, AppState>,
    kind: String,
    term: String,
    limit: Option<usize>,
) -> CmdResult<Vec<TextHit>> {
    let _t = timed("search_topic");
    let kind = match kind.as_str() {
        "tag" => TopicKind::Tag,
        "link" => TopicKind::Link,
        other => return Err(CmdError(format!("unknown topic kind: {other}"))),
    };
    state.with_ws(|ws| Ok(ws.search_topic(kind, &term, limit.unwrap_or(DEFAULT_LIMIT))?))
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<TagCount>> {
    let _t = timed("list_tags");
    state.with_ws(|ws| Ok(ws.tags()))
}

// ----------------------------------------------------------------------
// Links, graph, post-its
// ----------------------------------------------------------------------

#[tauri::command]
pub async fn backlinks(state: State<'_, AppState>, path: String) -> CmdResult<Vec<Backlink>> {
    let _t = timed("backlinks");
    state.with_ws(|ws| Ok(ws.backlinks(&path)))
}

#[tauri::command]
pub async fn graph(state: State<'_, AppState>) -> CmdResult<Graph> {
    let _t = timed("graph");
    state.with_ws(|ws| Ok(ws.graph()))
}

#[tauri::command]
pub async fn list_postits(state: State<'_, AppState>) -> CmdResult<Vec<PostItEntry>> {
    let _t = timed("list_postits");
    state.with_ws(|ws| Ok(ws.postits()))
}

/// Edits one post-it on disk; returns the note's new full text.
#[tauri::command]
pub async fn update_postit(
    state: State<'_, AppState>,
    path: String,
    id: String,
    text: String,
    color: Option<String>,
) -> CmdResult<String> {
    let _t = timed("update_postit");
    state.mark_written(&path);
    state.with_ws_mut(|ws| Ok(ws.update_postit(&path, &id, &text, color.as_deref())?))
}

/// Returns a fresh post-it block (with a new id) for the editor to insert.
#[tauri::command]
pub async fn new_postit(color: Option<String>, text: Option<String>) -> CmdResult<String> {
    let _t = timed("new_postit");
    Ok(postit::render_block(
        &postit::new_id(),
        color.as_deref().unwrap_or(postit::DEFAULT_COLOR),
        text.as_deref().unwrap_or(""),
    ))
}

/// Resolves a clicked `[[link]]`. URLs and local files are opened with the
/// system's default app right here; notes (and missing notes) are returned
/// so the frontend can open or offer to create them.
#[tauri::command]
pub async fn follow_link(app: AppHandle, state: State<'_, AppState>, target: String, from: String) -> CmdResult<LinkTarget> {
    let _t = timed("follow_link");
    let resolved = state.with_ws(|ws| Ok(ws.resolve_link(&target, &from)))?;
    match &resolved {
        LinkTarget::Url { url } => app.opener().open_url(url, None::<&str>)?,
        LinkTarget::File { path } => app.opener().open_path(path, None::<&str>)?,
        LinkTarget::Note { .. } | LinkTarget::Missing { .. } => {}
    }
    Ok(resolved)
}

/// Opens a non-note vault file (e.g. a pinned PDF) with the default app.
#[tauri::command]
pub async fn open_in_default_app(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let _t = timed("open_in_default_app");
    let abs = state.with_ws(|ws| Ok(ws.vault().resolve(&path)?))?;
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)?;
    Ok(())
}

// ----------------------------------------------------------------------
// Attachments
// ----------------------------------------------------------------------

/// Decodes a percent-encoded header value (the frontend uses
/// encodeURIComponent, because HTTP-style headers must be ASCII).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // "%XX" needs two more characters after the "%". Header values are
        // ASCII (to_str checked that), so byte slicing is safe here.
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Saves pasted bytes (e.g. a clipboard image) as an attachment of a note.
/// The body is raw binary, not JSON; the note path and file name arrive in
/// the `x-arca-note` / `x-arca-name` headers. Returns the asset's
/// vault-relative path.
#[tauri::command]
pub async fn save_attachment(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let _t = timed("save_attachment");
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError("expected raw bytes".into()));
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
            .ok_or_else(|| CmdError(format!("missing {name} header")))
    };
    let note = header("x-arca-note")?;
    let name = header("x-arca-name")?;
    state.with_ws(|ws| Ok(ws.vault().save_asset(&note, &name, bytes)?))
}

/// Copies a file from anywhere on disk (dropped onto the editor) into the
/// note's `.assets/` folder. The source is only read, never moved.
#[tauri::command]
pub async fn import_attachment(state: State<'_, AppState>, note: String, source: String) -> CmdResult<String> {
    let _t = timed("import_attachment");
    let src = PathBuf::from(&source);
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| CmdError(format!("not a file: {source}")))?;
    if !src.is_file() {
        return Err(CmdError(format!("only files can be attached: {source}")));
    }
    let bytes = std::fs::read(&src)?;
    state.with_ws(|ws| Ok(ws.vault().save_asset(&note, &name, &bytes)?))
}

// ----------------------------------------------------------------------
// Version history (Time Machine)
// ----------------------------------------------------------------------

/// Runs `f` with the open vault's history, or explains that it's off.
fn with_history<T>(state: &AppState, f: impl FnOnce(&History) -> CmdResult<T>) -> CmdResult<T> {
    let guard = state.history.lock().unwrap_or_else(|e| e.into_inner());
    let h = guard.as_ref().ok_or_else(|| CmdError("version history is off for this vault".into()))?;
    f(h)
}

/// Switches history on for the open vault (creating it on first use) and
/// takes a first snapshot. Returns that snapshot's id, if anything changed.
#[tauri::command]
pub async fn history_start(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    let _t = timed("history_start");
    let root = state.with_ws(|ws| Ok(ws.root().to_path_buf()))?;
    let h = History::open_or_init(&root)?;
    let first = h.snapshot()?;
    *state.history.lock().unwrap_or_else(|e| e.into_inner()) = Some(h);
    Ok(first)
}

/// Switches history off (existing history stays on disk).
#[tauri::command]
pub async fn history_stop(state: State<'_, AppState>) -> CmdResult<()> {
    *state.history.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Records a snapshot if anything changed (called every few minutes).
#[tauri::command]
pub async fn history_snapshot(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    let _t = timed("history_snapshot");
    // Snapshot what autosave has written; hold the workspace lock so no
    // write lands half-way through.
    state.with_ws(|_ws| with_history(&state, |h| Ok(h.snapshot()?)))
}

/// The newest snapshots, optionally only those that changed one note.
#[tauri::command]
pub async fn history_timeline(state: State<'_, AppState>, limit: Option<usize>, path: Option<String>) -> CmdResult<Vec<Snapshot>> {
    let _t = timed("history_timeline");
    with_history(&state, |h| Ok(h.timeline(limit.unwrap_or(500), path.as_deref())?))
}

/// Every note in a snapshot.
#[tauri::command]
pub async fn history_files(state: State<'_, AppState>, id: String) -> CmdResult<Vec<String>> {
    with_history(&state, |h| Ok(h.files_at(&id)?))
}

/// A note's text in a snapshot (None if it didn't exist then).
#[tauri::command]
pub async fn history_read(state: State<'_, AppState>, id: String, path: String) -> CmdResult<Option<String>> {
    with_history(&state, |h| Ok(h.read_at(&id, &path)?))
}

/// Restores a note, a chapter or ("") the whole vault from a snapshot.
/// A snapshot of the current state is taken first, so the restore itself
/// can be undone from the Time Machine.
#[tauri::command]
pub async fn history_restore(state: State<'_, AppState>, id: String, prefix: String) -> CmdResult<RestoreReport> {
    let _t = timed("history_restore");
    let guard = state.history.lock().unwrap_or_else(|e| e.into_inner());
    let h = guard.as_ref().ok_or_else(|| CmdError("version history is off for this vault".into()))?;
    h.snapshot()?;
    let report = state.with_ws_mut(|ws| Ok(ws.restore_from_history(h, &id, &prefix)?))?;
    h.snapshot()?;
    Ok(report)
}

/// The backup remote's URL, if one is set.
#[tauri::command]
pub async fn history_remote(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    with_history(&state, |h| Ok(h.remote()))
}

/// Sets (or, with "", removes) the remote history is pushed to.
#[tauri::command]
pub async fn history_set_remote(state: State<'_, AppState>, url: String) -> CmdResult<()> {
    with_history(&state, |h| Ok(h.set_remote(&url)?))
}

/// Pushes history to the backup remote using the system `git`.
#[tauri::command]
pub async fn history_push(state: State<'_, AppState>) -> CmdResult<String> {
    let _t = timed("history_push");
    with_history(&state, |h| Ok(h.push()?))
}

// ----------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------

/// Compiles `scope` ("" = vault, a folder, or a note) into one HTML or
/// Markdown file at `dest`, an absolute path the user picked in a save
/// dialog (so it may be outside the vault). Optionally opens the result.
/// Returns how many notes were exported.
#[tauri::command]
pub async fn export_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: String,
    format: arca_core::export::ExportFormat,
    dest: String,
    open: bool,
) -> CmdResult<usize> {
    let _t = timed("export_notes");
    let exported = state.with_ws(|ws| Ok(arca_core::export::export(ws.vault(), &scope, format)?))?;
    std::fs::write(&dest, exported.content)?;
    if open {
        app.opener().open_path(&dest, None::<&str>)?;
    }
    Ok(exported.notes)
}

// ----------------------------------------------------------------------
// Templates (stored inside the vault in .arca/templates/)
// ----------------------------------------------------------------------

/// Starter templates written the first time templates are used. Embedded at
/// compile time from src-tauri/templates/.
const STARTER_TEMPLATES: &[(&str, &str)] = &[
    ("Bug Report.md", include_str!("../templates/Bug Report.md")),
    ("Study Log.md", include_str!("../templates/Study Log.md")),
    ("Meeting Notes.md", include_str!("../templates/Meeting Notes.md")),
    ("Daily Note.md", include_str!("../templates/Daily Note.md")),
    ("Chapter Overview.md", include_str!("../templates/Chapter Overview.md")),
];

/// Vault-relative folder holding templates. Hidden (".arca"), so templates
/// never appear in the tree, search or graph.
const TEMPLATE_DIR: &str = ".arca/templates";

#[derive(Serialize)]
pub struct TemplateInfo {
    /// Display name (file stem), e.g. "Study Log".
    pub name: String,
    /// Vault-relative path, editable like any note.
    pub path: String,
}

/// Lists the vault's templates. If the template folder doesn't exist yet,
/// it is created with the starter set first. A folder the user emptied on
/// purpose is left empty.
#[tauri::command]
pub async fn list_templates(state: State<'_, AppState>) -> CmdResult<Vec<TemplateInfo>> {
    let _t = timed("list_templates");
    state.with_ws_mut(|ws| {
        let dir = ws.vault().resolve(TEMPLATE_DIR)?;
        if !dir.exists() {
            for (name, body) in STARTER_TEMPLATES {
                ws.write_note(&format!("{TEMPLATE_DIR}/{name}"), body)?;
            }
        }
        let mut out: Vec<TemplateInfo> = std::fs::read_dir(&dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| arca_core::vault::is_note_path(p))
            .filter_map(|p| {
                let name = p.file_stem()?.to_string_lossy().into_owned();
                let file = p.file_name()?.to_string_lossy().into_owned();
                Some(TemplateInfo { name, path: format!("{TEMPLATE_DIR}/{file}") })
            })
            .collect();
        out.sort_by_key(|t| t.name.to_lowercase());
        Ok(out)
    })
}

/// Creates a note at `path` with the given (already filled-in) template
/// text. Variables like {{date}} are filled on the frontend, where the
/// user's local time zone is known. Fails rather than overwriting.
#[tauri::command]
pub async fn create_from_template(state: State<'_, AppState>, path: String, content: String) -> CmdResult<String> {
    let _t = timed("create_from_template");
    state.with_ws_mut(|ws| {
        let created = ws.create_note(&path)?;
        state.mark_written(&created);
        ws.write_note(&created, &content)?;
        Ok(created)
    })
}

// ----------------------------------------------------------------------
// Pins (stored inside the vault)
// ----------------------------------------------------------------------

/// `<vault>/.arca/vault.json`.
fn vault_settings_path(state: &AppState) -> CmdResult<PathBuf> {
    state.with_ws(|ws| Ok(ws.root().join(VAULT_META_DIR).join("vault.json")))
}

#[tauri::command]
pub async fn get_pins(state: State<'_, AppState>) -> CmdResult<Vec<Pin>> {
    let _t = timed("get_pins");
    let vs: VaultSettings = settings::load(&vault_settings_path(&state)?)?;
    Ok(vs.pins)
}

#[tauri::command]
pub async fn set_pins(state: State<'_, AppState>, pins: Vec<Pin>) -> CmdResult<()> {
    let _t = timed("set_pins");
    let path = vault_settings_path(&state)?;
    // Load-modify-save keeps any other fields a future version adds.
    let mut vs: VaultSettings = settings::load(&path)?;
    vs.pins = pins;
    settings::save(&path, &vs)
}
