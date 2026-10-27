// Hides the extra console window on Windows release builds; no-op elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Binary entry point; all real setup lives in the library so it can be
/// shared with mobile targets, as the Tauri template recommends.
fn main() {
    arca_lib::run()
}
