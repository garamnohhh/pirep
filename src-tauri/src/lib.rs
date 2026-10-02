mod assets;
mod commands;
mod vault;

use commands::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol(assets::SCHEME, assets::handler)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(VaultState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // No set_icon here: on macOS tao's set_window_icon is a no-op
                // (windows have no icon), and the Dock icon comes from
                // icons/icon.icns — the bundle's in a release build, and the
                // same file baked in by tauri-codegen in dev.
                //
                // Minimal macOS menu: standard app/edit/window items only.
                // Removing the menu entirely (old approach) killed ⌘Q/⌘W/⌘H/⌘M; a full
                // default menu intercepted our app shortcuts. These predefined items bind
                // only ⌘Q/W/H/M/X/C/V/A/Z — never our ⌘E/⌘K/⌘F/⌘\ etc.
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let app_menu = SubmenuBuilder::new(app, "pirep")
                    .about(None)
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let window_menu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .close_window()
                    .build()?;
                let menu = MenuBuilder::new(app)
                    .items(&[&app_menu, &edit_menu, &window_menu])
                    .build()?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_vault,
            commands::read_doc,
            commands::write_doc,
            commands::mark_read,
            commands::mark_read_many,
            commands::list_updates,
            commands::diff,
            commands::list_changes,
            commands::revert,
            commands::create_doc,
            commands::create_folder,
            commands::rename_doc,
            commands::delete_doc,
            commands::accept_change,
            commands::decide_version,
            commands::copy_diagram_image,
            commands::list_files,
            commands::list_dirs,
            commands::read_raw_file,
            commands::open_vault_file,
            commands::write_raw_file,
            commands::rename_raw_file,
            commands::delete_raw_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
