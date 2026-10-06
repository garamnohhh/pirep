mod assets;
mod commands;
mod vault;

use commands::VaultState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct PendingOpenFiles(Mutex<PendingOpenFilesState>);

#[derive(Default)]
struct PendingOpenFilesState {
    files: Vec<String>,
    frontend_ready: bool,
}

#[cfg(target_os = "macos")]
fn should_hide_on_close(window_label: &str) -> bool {
    window_label == "main"
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state.0.lock().expect("pending open files lock poisoned");
    pending.frontend_ready = true;
    std::mem::take(&mut pending.files)
}

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
        .manage(PendingOpenFiles::default())
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if should_hide_on_close(window.label()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
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
            commands::read_external_markdown,
            commands::write_external_markdown,
            take_pending_open_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths = urls.iter().filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .filter(|path| {
                        path.rsplit_once('.').is_some_and(|(_, ext)| {
                            ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
                        })
                    });
                for path in paths {
                    let state = app.state::<PendingOpenFiles>();
                    let ready = {
                        let mut pending = state.0.lock().expect("pending open files lock poisoned");
                        if pending.frontend_ready { true } else {
                            pending.files.push(path.clone());
                            false
                        }
                    };
                    if ready { let _ = app.emit_to("main", "open-file-request", path); }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = &event {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
        });
}

#[cfg(all(test, target_os = "macos"))]
mod close_policy_tests {
    use super::should_hide_on_close;

    #[test]
    fn main_window_is_hidden_on_close_request() {
        assert!(should_hide_on_close("main"));
    }

    #[test]
    fn external_windows_are_allowed_to_close() {
        assert!(!should_hide_on_close("external-123"));
    }
}
