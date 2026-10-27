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
use arca_core::vault::TreeNode;
use arca_core::workspace::{Backlink, Graph, LinkTarget, NoteInfo, PostItEntry, TagCount};
use arca_core::Workspace;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{CmdError, CmdResult};
use crate::settings::{self, Pin, VaultSettings, VAULT_META_DIR};
use crate::state::AppState;
use crate::watcher;

/// Default cap on search results; the UI never shows more than this.
const DEFAULT_LIMIT: usize = 50;

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
    let s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
    Ok(AppStateDto {
        vault_path: s.vault_path.clone(),
        ui: s.ui.clone(),
    })
}

/// Stores the frontend's layout blob (called debounced on layout changes).
#[tauri::command]
pub async fn save_ui(state: State<'_, AppState>, ui: serde_json::Value) -> CmdResult<()> {
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
    // Index first, without holding any lock, so a slow scan never blocks
    // other commands touching the previous vault.
    let ws = Workspace::open(&path)?;
    let root: PathBuf = ws.root().to_path_buf();

    // Stop the old watcher before swapping vaults so its callback can't
    // refresh the new workspace with paths from the old one.
    *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *state.lock_ws() = Some(ws);
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
    state.with_ws(|ws| Ok(ws.tree()?))
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>) -> CmdResult<Vec<NoteInfo>> {
    state.with_ws(|ws| Ok(ws.notes()))
}

#[tauri::command]
pub async fn read_note(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    state.with_ws(|ws| Ok(ws.read_note(&path)?))
}

#[tauri::command]
pub async fn write_note(state: State<'_, AppState>, path: String, content: String) -> CmdResult<()> {
    // Marked *before* writing: the watcher may fire before we return.
    state.mark_written(&path);
    state.with_ws_mut(|ws| Ok(ws.write_note(&path, &content)?))
}

/// Creates a note; returns its final path (".md" appended if missing).
#[tauri::command]
pub async fn create_note(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    state.with_ws_mut(|ws| Ok(ws.create_note(&path)?))
}

#[tauri::command]
pub async fn create_folder(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    state.with_ws_mut(|ws| Ok(ws.create_folder(&path)?))
}

#[tauri::command]
pub async fn rename_entry(state: State<'_, AppState>, from: String, to: String) -> CmdResult<()> {
    state.with_ws_mut(|ws| Ok(ws.rename(&from, &to)?))
}

/// Moves a note/folder to `.trash/`; returns where it went.
#[tauri::command]
pub async fn trash_entry(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    state.with_ws_mut(|ws| Ok(ws.trash(&path)?))
}

// ----------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------

#[tauri::command]
pub async fn search_files(state: State<'_, AppState>, query: String, limit: Option<usize>) -> CmdResult<Vec<FileHit>> {
    state.with_ws(|ws| Ok(ws.search_files(&query, limit.unwrap_or(DEFAULT_LIMIT))?))
}

/// Full-text search. `scope` is a folder path; omit it to search everything.
#[tauri::command]
pub async fn search_text(
    state: State<'_, AppState>,
    query: String,
    scope: Option<String>,
    limit: Option<usize>,
) -> CmdResult<Vec<TextHit>> {
    state.with_ws(|ws| Ok(ws.search_text(&query, scope.as_deref(), limit.unwrap_or(DEFAULT_LIMIT))?))
}

/// Topic search. `kind` is `"tag"` or `"link"`.
#[tauri::command]
pub async fn search_topic(
    state: State<'_, AppState>,
    kind: String,
    term: String,
    limit: Option<usize>,
) -> CmdResult<Vec<TextHit>> {
    let kind = match kind.as_str() {
        "tag" => TopicKind::Tag,
        "link" => TopicKind::Link,
        other => return Err(CmdError(format!("unknown topic kind: {other}"))),
    };
    state.with_ws(|ws| Ok(ws.search_topic(kind, &term, limit.unwrap_or(DEFAULT_LIMIT))?))
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<TagCount>> {
    state.with_ws(|ws| Ok(ws.tags()))
}

// ----------------------------------------------------------------------
// Links, graph, post-its
// ----------------------------------------------------------------------

#[tauri::command]
pub async fn backlinks(state: State<'_, AppState>, path: String) -> CmdResult<Vec<Backlink>> {
    state.with_ws(|ws| Ok(ws.backlinks(&path)))
}

#[tauri::command]
pub async fn graph(state: State<'_, AppState>) -> CmdResult<Graph> {
    state.with_ws(|ws| Ok(ws.graph()))
}

#[tauri::command]
pub async fn list_postits(state: State<'_, AppState>) -> CmdResult<Vec<PostItEntry>> {
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
    state.mark_written(&path);
    state.with_ws_mut(|ws| Ok(ws.update_postit(&path, &id, &text, color.as_deref())?))
}

/// Returns a fresh post-it block (with a new id) for the editor to insert.
#[tauri::command]
pub async fn new_postit(color: Option<String>, text: Option<String>) -> CmdResult<String> {
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
    let abs = state.with_ws(|ws| Ok(ws.vault().resolve(&path)?))?;
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)?;
    Ok(())
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
    let vs: VaultSettings = settings::load(&vault_settings_path(&state)?)?;
    Ok(vs.pins)
}

#[tauri::command]
pub async fn set_pins(state: State<'_, AppState>, pins: Vec<Pin>) -> CmdResult<()> {
    let path = vault_settings_path(&state)?;
    // Load-modify-save keeps any other fields a future version adds.
    let mut vs: VaultSettings = settings::load(&path)?;
    vs.pins = pins;
    settings::save(&path, &vs)
}
