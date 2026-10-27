//! Small JSON settings files.
//!
//! There are two:
//!
//! * **App settings** (`<config dir>/settings.json`): which vault was open
//!   last, plus an opaque `ui` blob the frontend uses to restore its layout
//!   (drawer width, open panel…). Rust never looks inside `ui`.
//! * **Vault settings** (`<vault>/.arca/vault.json`): the pinned shortcuts.
//!   These live *inside* the vault, so pins follow the notes when the folder
//!   is synced or copied to another machine.

use std::fs;
use std::path::Path;

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::error::CmdResult;

/// Per-machine preferences.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Absolute path of the last opened vault.
    pub vault_path: Option<String>,
    /// Frontend-owned layout state, stored verbatim.
    pub ui: serde_json::Value,
}

/// One entry of the pinned shortcut bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: String,
    pub label: String,
    /// Vault-relative path of the pinned note, folder or file.
    pub path: String,
    /// "note" | "folder" | "file"; decides what a click does.
    pub kind: String,
}

/// Per-vault data stored in `.arca/vault.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultSettings {
    pub pins: Vec<Pin>,
}

/// Name of the hidden per-vault folder. Being hidden keeps it out of the
/// tree and the index automatically.
pub const VAULT_META_DIR: &str = ".arca";

/// Reads a JSON file, falling back to `T::default()` if it doesn't exist.
/// A file that exists but is corrupt is an error rather than being
/// silently replaced, so the user's pins are never wiped by a bad parse.
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> CmdResult<T> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

/// Writes a JSON file atomically (temp file + rename), creating its folder.
pub fn save<T: Serialize>(path: &Path, value: &T) -> CmdResult<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(value)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}
