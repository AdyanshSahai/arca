//! Arca's Tauri shell.
//!
//! This crate is deliberately thin: all note logic lives in `arca-core`.
//! What it adds is the desktop glue:
//!
//! * [`commands`]: the IPC surface the React frontend calls with `invoke()`.
//! * [`watcher`]: a debounced file-system watcher that keeps the index in
//!   sync with edits made outside Arca and tells the UI to refresh.
//! * [`settings`]: small JSON files for app preferences (last vault, UI
//!   layout) and per-vault data (pins), stored next to the vault in
//!   `.arca/` so it travels with the notes.
//! * [`state`]: the single shared [`state::AppState`].

mod commands;
mod error;
mod settings;
mod state;
mod watcher;

use tauri::Manager;

/// Builds and runs the application. Called from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Load preferences from the OS config dir (e.g. ~/.config/dev.adyansh.arca).
            let config_dir = app.path().app_config_dir()?;
            app.manage(state::AppState::new(config_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_state,
            commands::save_ui,
            commands::open_vault,
            commands::vault_tree,
            commands::list_notes,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::trash_entry,
            commands::search_files,
            commands::search_text,
            commands::search_topic,
            commands::list_tags,
            commands::backlinks,
            commands::graph,
            commands::list_postits,
            commands::update_postit,
            commands::new_postit,
            commands::follow_link,
            commands::open_in_default_app,
            commands::export_notes,
            commands::list_templates,
            commands::create_from_template,
            commands::get_pins,
            commands::set_pins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arca");
}
