//! Shared application state, managed by Tauri and handed to every command.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use arca_core::history::History;
use arca_core::Workspace;

use crate::error::{CmdError, CmdResult};
use crate::settings::{self, AppSettings};
use crate::watcher::VaultWatcher;

/// Fingerprint of a file's text, to recognise Arca's own writes.
fn fingerprint(text: &str) -> u64 {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

pub struct AppState {
    /// The open vault, or `None` before the user picks one. A `Mutex` (not
    /// `RwLock`) because Tantivy's writer is `Send` but not `Sync`.
    pub workspace: Mutex<Option<Workspace>>,
    /// Kept alive for as long as the vault is open; dropping it stops watching.
    pub watcher: Mutex<Option<VaultWatcher>>,
    /// Version history of the open vault, when the user has it switched on.
    pub history: Mutex<Option<History>>,
    /// Paths Arca itself wrote → fingerprint of the text it wrote. See
    /// [`Self::was_self_written`].
    recent_writes: Mutex<HashMap<String, u64>>,
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

    /// Records that Arca wrote `content` to `rel`.
    pub fn mark_written(&self, rel: &str, content: &str) {
        let mut map = self.recent_writes.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(rel.to_string(), fingerprint(content));
    }

    /// `true` if the file at `abs` (vault-relative `rel`) still holds
    /// exactly what Arca last wrote there, i.e. a watcher event for it is
    /// just the echo of our own save.
    ///
    /// This compares contents rather than ignoring a file for a while after
    /// each save: a time window also swallowed real edits made by another
    /// program within it, so they were never noticed (and the next
    /// autosave overwrote them).
    pub fn was_self_written(&self, rel: &str, abs: &Path) -> bool {
        let Some(expected) = self.recent_writes.lock().unwrap_or_else(|e| e.into_inner()).get(rel).copied() else {
            return false;
        };
        std::fs::read_to_string(abs).is_ok_and(|text| fingerprint(&text) == expected)
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
