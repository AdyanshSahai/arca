//! Watches the vault folder for changes made outside Arca.
//!
//! Events are debounced (bursts like `git checkout` collapse into one batch).
//! Each changed path is re-read into the workspace, and a `vault:changed`
//! event carrying the affected vault-relative paths is emitted to the
//! frontend. The frontend then refreshes the tree, graph and panels, and
//! reloads any open editor whose file changed under it.

use std::path::Path;
use std::time::Duration;

use arca_core::vault::Vault;
use notify::event::ModifyKind;
use notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// Quiet period before a batch of events is delivered.
const DEBOUNCE: Duration = Duration::from_millis(250);

/// Name of the event emitted to the frontend.
pub const CHANGED_EVENT: &str = "vault:changed";

/// Owning handle; dropping it stops the watch.
pub type VaultWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Payload of [`CHANGED_EVENT`].
#[derive(Clone, Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

/// True for events that mean a file's contents or existence changed:
/// creation, removal, renames and data writes.
///
/// Everything else is ignored, above all *access* events. inotify reports
/// files being opened and read, and Arca reads files in response to
/// changes, so treating reads as changes created an endless loop: change →
/// refresh → the UI re-reads the tree and notes → "changes" → refresh… It
/// held the workspace lock almost constantly and made the whole app
/// sluggish. Metadata-only events (access times, permissions) are skipped
/// too.
fn is_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any | ModifyKind::Other)
    )
}

/// Starts watching `root` recursively.
pub fn start(app: AppHandle, root: &Path) -> notify::Result<VaultWatcher> {
    // The closure needs its own copy of the vault (for path conversion);
    // `Vault` is just a canonical root path, so cloning it is cheap.
    let vault = Vault::open(root).map_err(|e| notify::Error::generic(&e.to_string()))?;
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        // Watch errors (e.g. inotify limit reached) aren't fatal; skip the batch.
        let Ok(events) = result else { return };
        let state = app.state::<AppState>();

        // Unique, visible, vault-relative paths from this batch, from events
        // that are real changes only (see `is_change`).
        let mut changed: Vec<String> = events
            .iter()
            .filter(|ev| is_change(&ev.kind))
            .flat_map(|ev| ev.paths.iter())
            .filter_map(|p| vault.relativize(p))
            .filter(|rel| !rel.is_empty() && !Vault::is_hidden_rel(rel))
            // Our own autosaves were already indexed by `write_note`.
            .filter(|rel| !state.was_self_written(rel))
            .collect();
        changed.sort();
        changed.dedup();
        if changed.is_empty() {
            return;
        }

        // Errors here (e.g. a file deleted again mid-batch) are non-fatal;
        // the next event or a manual reopen will reconcile.
        let started = std::time::Instant::now();
        let _ = state.with_ws_mut(|ws| {
            for rel in &changed {
                let _ = ws.refresh(rel);
            }
            Ok(())
        });
        // Profiling: how long outside-change handling held the workspace lock.
        if std::env::var_os("ARCA_PROFILE").is_some() {
            eprintln!(
                "[arca-perf] watcher refresh {:?} {:.3}ms",
                changed,
                started.elapsed().as_secs_f64() * 1000.0
            );
        }
        let _ = app.emit(CHANGED_EVENT, ChangedPayload { paths: changed });
    })?;
    debouncer.watch(root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
