//! Shared application state, managed by Tauri and handed to every command.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use arca_core::history::History;
use arca_core::Workspace;

use crate::error::{CmdError, CmdResult};
use crate::settings::{self, AppSettings};
use crate::watcher::VaultWatcher;

/// How long after Arca writes a file the watcher ignores events for it.
/// Without this, every autosave would bounce back as an "external change".
const SELF_WRITE_GRACE: Duration = Duration::from_secs(2);

pub struct AppState {
    /// The open vault, or `None` before the user picks one. A `Mutex` (not
    /// `RwLock`) because Tantivy's writer is `Send` but not `Sync`.
    pub workspace: Mutex<Option<Workspace>>,
    /// Kept alive for as long as the vault is open; dropping it stops watching.
    pub watcher: Mutex<Option<VaultWatcher>>,
    /// Version history of the open vault, when the user has it switched on.
    pub history: Mutex<Option<History>>,
    /// Paths Arca itself just wrote → when. See [`SELF_WRITE_GRACE`].
    recent_writes: Mutex<HashMap<String, Instant>>,
    pub settings: Mutex<AppSettings>,
    /// Location of `settings.json`.
    settings_path: PathBuf,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> Self {
        let settings_path = config_dir.join("settings.json");
        // A broken settings file shouldn't stop the app from starting;
        // fall back to defaults (the file is rewritten on the next save).
        let settings = settings::load(&settings_path).unwrap_or_default();
        Self {
            workspace: Mutex::new(None),
            watcher: Mutex::new(None),
            history: Mutex::new(None),
            recent_writes: Mutex::new(HashMap::new()),
            settings: Mutex::new(settings),
            settings_path,
        }
    }

    /// Locks the workspace slot. Commands go through [`Self::with_ws`] /
    /// [`Self::with_ws_mut`], which also handle the "no vault open" case.
    pub fn lock_ws(&self) -> MutexGuard<'_, Option<Workspace>> {
        // A poisoned lock only means another command panicked mid-way; the
        // data is still usable, so recover instead of crashing every call.
        self.workspace.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Runs `f` with read access to the open workspace.
    pub fn with_ws<T>(&self, f: impl FnOnce(&Workspace) -> CmdResult<T>) -> CmdResult<T> {
        let guard = self.lock_ws();
        let ws = guard.as_ref().ok_or_else(no_vault)?;
        f(ws)
    }

    /// Runs `f` with write access to the open workspace.
    pub fn with_ws_mut<T>(&self, f: impl FnOnce(&mut Workspace) -> CmdResult<T>) -> CmdResult<T> {
        let mut guard = self.lock_ws();
        let ws = guard.as_mut().ok_or_else(no_vault)?;
        f(ws)
    }

    /// Records that Arca wrote `rel` just now.
    pub fn mark_written(&self, rel: &str) {
        let mut map = self.recent_writes.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        // Opportunistically drop stale entries so the map never grows.
        map.retain(|_, t| now.duration_since(*t) < SELF_WRITE_GRACE);
        map.insert(rel.to_string(), now);
    }

    /// `true` if `rel` was written by Arca within the grace period.
    pub fn was_self_written(&self, rel: &str) -> bool {
        let map = self.recent_writes.lock().unwrap_or_else(|e| e.into_inner());
        map.get(rel)
            .is_some_and(|t| t.elapsed() < SELF_WRITE_GRACE)
    }

    /// Persists the app settings to disk.
    pub fn save_settings(&self) -> CmdResult<()> {
        let s = self.settings.lock().unwrap_or_else(|e| e.into_inner());
        settings::save(&self.settings_path, &*s)
    }
}

fn no_vault() -> CmdError {
    CmdError("no vault is open".into())
}
