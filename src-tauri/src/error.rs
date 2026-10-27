//! The error type every IPC command returns.

use serde::{Serialize, Serializer};

/// Wraps any failure as a human-readable message. Tauri requires command
/// errors to be `Serialize`; the frontend just gets the string and shows it
/// in a toast.
#[derive(Debug)]
pub struct CmdError(pub String);

impl Serialize for CmdError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl From<arca_core::CoreError> for CmdError {
    fn from(e: arca_core::CoreError) -> Self {
        Self(e.to_string())
    }
}

impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        Self(e.to_string())
    }
}

impl From<serde_json::Error> for CmdError {
    fn from(e: serde_json::Error) -> Self {
        Self(format!("invalid settings file: {e}"))
    }
}

impl From<tauri_plugin_opener::Error> for CmdError {
    fn from(e: tauri_plugin_opener::Error) -> Self {
        Self(format!("could not open: {e}"))
    }
}

/// Shorthand for command return types.
pub type CmdResult<T> = Result<T, CmdError>;
