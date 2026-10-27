//! # arca-core
//!
//! The headless engine behind Arca. Everything here works on plain `.md`
//! files on disk; there is no database. The pieces are:
//!
//! * [`vault`]: safe, sandboxed file-system access rooted at the vault
//!   folder (read/write/rename/trash plus the chapter tree).
//! * [`postit`]: parses and rewrites the `<!-- postit:… -->` blocks embedded
//!   inside notes.
//! * [`links`]: extracts `[[WikiLinks]]` and `#tags` and resolves link
//!   targets to note paths.
//! * [`search`]: the in-memory Tantivy index (full-text and topic search)
//!   plus the fuzzy/regex filename matcher.
//! * [`workspace`]: ties the above together into one object that the Tauri
//!   shell keeps in memory for the open vault.

pub mod error;
pub mod links;
pub mod postit;
pub mod search;
pub mod vault;
pub mod workspace;

pub use error::{CoreError, Result};
pub use workspace::Workspace;
