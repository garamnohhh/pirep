mod assets;
mod commands;
mod default_app;
mod external_files;
mod vault;

use commands::VaultState;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct PendingOpenFiles(Mutex<PendingOpenFilesState>);

#[derive(Default)]
struct PendingOpenFilesState {
    files: Vec<String>,
    frontend_ready: bool,
}

fn percent_decode(input: &str) -> Option<String> {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex(*bytes.get(index + 1)?)?;
            let low = hex(*bytes.get(index + 2)?)?;
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn parse_open_path(input: &str, home: &Path) -> Result<PathBuf, &'static str> {
    let input = input.trim();
    let input = if input.len() >= 2
        && ((input.starts_with('\'') && input.ends_with('\''))
            || (input.starts_with('"') && input.ends_with('"')))
    {
        &input[1..input.len() - 1]
    } else {
        input
    };
    if input.is_empty() || input.contains('?') || input.contains('#') {
        return Err("Invalid path");
    }

    let path = if let Some(rest) = input.strip_prefix("pirep:///") {
        let rest = percent_decode(rest).ok_or("Invalid path")?;
        if rest.starts_with('/') || rest.split('/').any(|part| part == "." || part == "..") {
            return Err("Invalid path");
        }
        Path::new("/").join(rest)
    } else if input.starts_with("pirep://") {
        return Err("Invalid path");
    } else if let Some(rest) = input.strip_prefix("file:///") {
        let rest = percent_decode(rest).ok_or("Invalid path")?;
        if rest.starts_with('/') || rest.split('/').any(|part| part == "." || part == "..") {
            return Err("Invalid path");
        }
        Path::new("/").join(rest)
    } else if input.starts_with("file://") {
        return Err("Invalid path");
    } else if let Some(rest) = input.strip_prefix("~/") {
        let rest = percent_decode(rest).ok_or("Invalid path")?;
        if rest.split('/').any(|part| part == "." || part == "..") {
            return Err("Invalid path");
        }
        home.join(rest)
    } else {
        let decoded = percent_decode(input).ok_or("Invalid path")?;
        if decoded.starts_with("//")
            || decoded.split('/').any(|part| part == "." || part == "..")
        {
            return Err("Invalid path");
        }
        PathBuf::from(decoded)
    };
    if !path.is_absolute() {
        return Err("Invalid path");
    }
    let path = path.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound { "File not found" } else { "Invalid path" }
    })?;
    let supported = path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "html" | "htm")
    });
    if !path.is_file() || !supported {
        return Err("Invalid path");
    }
    Ok(path)
}

fn queue_open_path(state: &PendingOpenFiles, path: String) -> bool {
    let mut pending = state.0.lock().expect("pending open files lock poisoned");
    if pending.frontend_ready {
        true
    } else {
        pending.files.push(path);
        false
    }
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

#[tauri::command]
fn resolve_open_path(input: String) -> Result<String, String> {
    parse_open_path(&input, &std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default())
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(str::to_string)
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
        .manage(external_files::ExternalFileRoots::default())
        .manage(external_files::ExternalHtmlWatchers::default())
        .manage(PendingOpenFiles::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().state::<external_files::ExternalFileRoots>().remove(window.label());
                window.app_handle().state::<external_files::ExternalHtmlWatchers>().remove(window.label());
            }
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
            commands::list_frontmatter_keys,
            commands::list_pinned_files,
            commands::toggle_pinned_file,
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
            commands::accept_change,
            commands::decide_version,
            commands::copy_diagram_image,
            commands::list_files,
            commands::list_dirs,
            commands::read_raw_file,
            commands::open_vault_file,
            commands::write_raw_file,
            commands::rename_raw_file,
            commands::trash_vault_item,
            commands::read_external_markdown,
            commands::write_external_markdown,
            commands::read_external_html,
            commands::write_external_html,
            external_files::register_external_file_root,
            external_files::watch_external_html,
            external_files::resolve_external_markdown_link,
            default_app::get_markdown_default_app,
            default_app::set_markdown_default_app,
            take_pending_open_files,
            resolve_open_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
                let paths = urls.iter()
                    .filter_map(|url| parse_open_path(url.as_str(), &home).ok())
                    .map(|path| path.to_string_lossy().into_owned());
                for path in paths {
                    let state = app.state::<PendingOpenFiles>();
                    let ready = queue_open_path(&state, path.clone());
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

#[cfg(test)]
mod open_path_tests {
    use super::{parse_open_path, queue_open_path, PendingOpenFiles};

    #[test]
    fn parses_supported_file_paths_and_rejects_invalid_inputs() {
        let base = std::env::temp_dir().join(format!("pirep-open-path-{}", std::process::id()));
        let home = base.join("home");
        let folder = home.join("My Base");
        std::fs::create_dir_all(&folder).unwrap();
        let markdown = folder.join("한 글.md");
        let long_markdown = folder.join("note.markdown");
        let html = folder.join("page.html");
        let htm = folder.join("old.htm");
        let text = folder.join("notes.txt");
        std::fs::write(&markdown, "note").unwrap();
        std::fs::write(&long_markdown, "note").unwrap();
        std::fs::write(&html, "page").unwrap();
        std::fs::write(&htm, "page").unwrap();
        std::fs::write(&text, "text").unwrap();
        let home = home.canonicalize().unwrap();
        let markdown = markdown.canonicalize().unwrap();

        let encoded = format!("pirep://{}/My%20Base/%ED%95%9C%20%EA%B8%80.md", home.display());
        let raw = format!("pirep://{}/My Base/한 글.md", home.display());
        let file_url = format!("file://{}/My%20Base/%ED%95%9C%20%EA%B8%80.md", home.display());
        for input in [encoded.as_str(), raw.as_str(), file_url.as_str(), markdown.to_str().unwrap()] {
            assert_eq!(parse_open_path(input, &home), Ok(markdown.clone()), "{input}");
        }
        assert_eq!(parse_open_path("'~/My Base/한 글.md'", &home), Ok(markdown.clone()));
        assert_eq!(parse_open_path("\"~/My Base/한 글.md\"", &home), Ok(markdown.clone()));
        for path in [long_markdown, html, htm] {
            let path = path.canonicalize().unwrap();
            assert_eq!(parse_open_path(path.to_str().unwrap(), &home), Ok(path));
        }

        let invalid = [
            format!("pirep://host{}/My%20Base/%ED%95%9C.md", home.display()),
            format!("pirep://{}/My%20Base/page.html?print=1", home.display()),
            format!("pirep://{}/My%20Base/../My%20Base/page.html", home.display()),
            format!("pirep://{}/My%ZZBase/page.html", home.display()),
            "relative.md".to_string(),
            text.to_string_lossy().into_owned(),
        ];
        for input in invalid {
            assert_eq!(parse_open_path(&input, &home), Err("Invalid path"), "{input}");
        }
        assert_eq!(parse_open_path("~/My Base/missing.md", &home), Err("File not found"));

        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn queues_open_paths_until_the_frontend_is_ready() {
        let pending = PendingOpenFiles::default();
        assert!(!queue_open_path(&pending, "/tmp/one.md".into()));
        {
            let mut state = pending.0.lock().unwrap();
            assert_eq!(state.files, ["/tmp/one.md"]);
            state.frontend_ready = true;
        }
        assert!(queue_open_path(&pending, "/tmp/two.md".into()));
        assert_eq!(pending.0.lock().unwrap().files, ["/tmp/one.md"]);
    }
}
