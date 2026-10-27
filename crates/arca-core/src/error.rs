//! Error type shared by every module in the core crate.

use thiserror::Error;

/// Everything that can go wrong inside the engine.
///
/// The Tauri layer turns these into plain strings for the frontend, so the
/// `#[error]` messages are written to be shown to the user as they are.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    /// A path tried to leave the vault (`..`, an absolute path, or a symlink
    /// pointing outside). Refusing these is what keeps the app from touching
    /// anything outside the folder the user picked.
    #[error("path escapes the vault: {0}")]
    PathEscape(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("already exists: {0}")]
    AlreadyExists(String),

    #[error("invalid name: {0}")]
    InvalidName(String),

    #[error("search index error: {0}")]
    Search(#[from] tantivy::TantivyError),

    #[error("invalid regular expression: {0}")]
    Regex(#[from] regex::Error),
}

/// Shorthand used throughout the crate.
pub type Result<T> = std::result::Result<T, CoreError>;
