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
use notify::RecursiveMode;
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

/// Starts watching `root` recursively.
pub fn start(app: AppHandle, root: &Path) -> notify::Result<VaultWatcher> {
    // The closure needs its own copy of the vault (for path conversion);
    // `Vault` is just a canonical root path, so cloning it is cheap.
    let vault = Vault::open(root).map_err(|e| notify::Error::generic(&e.to_string()))?;
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        // Watch errors (e.g. inotify limit reached) aren't fatal; skip the batch.
        let Ok(events) = result else { return };
        let state = app.state::<AppState>();

        // Unique, visible, vault-relative paths from this batch.
        let mut changed: Vec<String> = events
            .iter()
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
        let _ = state.with_ws_mut(|ws| {
            for rel in &changed {
                let _ = ws.refresh(rel);
            }
            Ok(())
        });
        let _ = app.emit(CHANGED_EVENT, ChangedPayload { paths: changed });
    })?;
    debouncer.watch(root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
