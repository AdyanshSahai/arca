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

/// Makes GTK file dialogs (open vault, export "Save as") look like a normal
/// desktop window: the window manager's title bar with _ □ X at the top
/// right, and Cancel / Open buttons at the bottom. GTK's default puts
/// Cancel and Open in a header bar at the top, with Cancel in the corner
/// where a close button usually is.
///
/// This only changes the setting inside Arca's own process; it doesn't
/// touch system-wide GTK configuration.
fn use_classic_gtk_dialogs() {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkSettingsExt;
        if let Some(settings) = gtk::Settings::default() {
            settings.set_gtk_dialogs_use_header(false);
        }
    }
}

/// Builds and runs the application. Called from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use_classic_gtk_dialogs();
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
            commands::list_trash,
            commands::restore_trash,
            commands::delete_trash,
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
            commands::history_start,
            commands::history_stop,
            commands::history_snapshot,
            commands::history_timeline,
            commands::history_files,
            commands::history_read,
            commands::history_restore,
            commands::history_remote,
            commands::history_set_remote,
            commands::history_push,
            commands::save_attachment,
            commands::import_attachment,
            commands::export_notes,
            commands::list_templates,
            commands::create_from_template,
            commands::get_pins,
            commands::perf_log,
            commands::set_pins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arca");
}
