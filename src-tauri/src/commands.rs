use crate::vault;
use crate::vault::change::ChangeRecord;
use crate::vault::db::{Db, DocEntry};
use crate::vault::diff::DiffResult;
use crate::vault::DocContent;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

pub struct VaultState {
    pub root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    pending: Arc<Mutex<Coalescer>>,
    flusher_started: Mutex<bool>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            root: Mutex::new(None),
            watcher: Mutex::new(None),
            pending: Arc::new(Mutex::new(Coalescer::default())),
            flusher_started: Mutex::new(false),
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// How long the filesystem must be quiet before we announce what changed.
const QUIET_MS: u64 = 400;

/// Remembers what kinds of thing changed and releases them only once the
/// filesystem has gone quiet.
///
/// The previous rule announced the FIRST event of a burst and then ignored
/// everything for 500ms. One user action arrives as a burst — creating a folder
/// holding two notes produced 11 events in the same millisecond — so the first
/// event decided the whole burst and the rest were dropped for good. When that
/// first event happened to be the folder rather than a note, only
/// "files-changed" was sent and the new markdown never appeared. The leading
/// edge was wrong for a second reason too: the frontend re-read the vault while
/// the remaining files were still landing.
#[derive(Default)]
struct Coalescer {
    md: bool,
    other: bool,
    last_ms: u64,
}

impl Coalescer {
    fn note(&mut self, md: bool, other: bool, now: u64) {
        if !(md || other) {
            return;
        }
        self.md |= md;
        self.other |= other;
        self.last_ms = now;
    }

    fn take_if_quiet(&mut self, now: u64, quiet: u64) -> Option<(bool, bool)> {
        if !(self.md || self.other) || now.saturating_sub(self.last_ms) < quiet {
            return None;
        }
        let out = (self.md, self.other);
        self.md = false;
        self.other = false;
        Some(out)
    }
}

fn get_root(state: &State<VaultState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no vault open".to_string())
}

fn relative_path(rel_path: &str) -> Result<&Path, String> {
    let path = Path::new(rel_path);
    if path.as_os_str().is_empty() || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("invalid path".to_string());
    }
    Ok(path)
}

fn vault_file(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative_path(rel_path)?)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("invalid path".to_string());
    }
    Ok(path)
}

fn new_vault_file(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative_path(rel_path)?);
    let parent = path.parent().ok_or_else(|| "invalid path".to_string())?;
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent.starts_with(&root) {
        return Err("invalid path".to_string());
    }
    Ok(path)
}

fn create_doc_at(root: &Path, rel_path: &str, content: &str) -> Result<Db, String> {
    new_vault_file(root, rel_path)?;
    vault::create_doc(root, rel_path, content)
}

fn rename_doc_at(root: &Path, doc_id: &str, new_rel_path: &str) -> Result<Db, String> {
    new_vault_file(root, new_rel_path)?;
    vault::rename_doc(root, doc_id, new_rel_path)
}

fn read_raw_file_at(root: &Path, rel_path: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(vault_file(root, rel_path)?).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn write_raw_file_at(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
    std::fs::write(vault_file(root, rel_path)?, content.as_bytes()).map_err(|e| e.to_string())
}

fn rename_raw_file_at(root: &Path, rel_path: &str, new_name: &str) -> Result<(), String> {
    let old = vault_file(root, rel_path)?;
    if Path::new(new_name).components().count() != 1
        || !matches!(Path::new(new_name).components().next(), Some(Component::Normal(_)))
    {
        return Err("invalid path".to_string());
    }
    let parent = Path::new(rel_path).parent().unwrap_or_else(|| Path::new(""));
    let new_rel = parent.join(new_name);
    let new = new_vault_file(root, new_rel.to_str().ok_or("invalid path")?)?;
    std::fs::rename(old, new).map_err(|e| e.to_string())
}

fn delete_raw_file_at(root: &Path, rel_path: &str) -> Result<(), String> {
    std::fs::remove_file(vault_file(root, rel_path)?).map_err(|e| e.to_string())
}

/// Split watcher paths into "needs a full markdown rescan" vs "only the non-md
/// file listing changed". Skips .pirep, hidden dirs, .DS_Store and volatile
/// sidecars (sqlite WAL, logs, temp) whose churn used to cause rescan storms.
fn classify_paths(paths: &[PathBuf], pirep: &std::path::Path) -> (bool, bool) {
    const VOLATILE: &[&str] = &[
        "db", "db-shm", "db-wal", "sqlite", "sqlite3", "log", "tmp", "temp", "swp", "lock",
        "part", "crdownload",
    ];
    let (mut md, mut other) = (false, false);
    for p in paths {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let visible = !p.starts_with(pirep)
            && !VOLATILE.contains(&ext)
            && p.file_name().map(|n| n != ".DS_Store").unwrap_or(true)
            && !p.components().any(|c| {
                c.as_os_str()
                    .to_str()
                    .map(|s| s.starts_with('.') && s.len() > 1)
                    .unwrap_or(false)
            });
        if !visible {
            continue;
        }
        if ext == "md" {
            md = true;
        } else {
            other = true;
        }
    }
    (md, other)
}

#[tauri::command]
pub fn scan_vault(
    path: String,
    state: State<VaultState>,
    app: tauri::AppHandle,
) -> Result<Db, String> {
    let r = PathBuf::from(&path);
    vault::db::migrate_legacy_dir(&r)?;
    let db = vault::scan(&r)?;
    *state.root.lock().unwrap() = Some(r.clone());

    // (Re)start the file watcher. Events are coalesced and announced once the
    // filesystem goes quiet — see Coalescer for why the leading edge lost changes.
    let pirep = r.join(".pirep");
    let pending = state.pending.clone();

    let mut w = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            let (md_changed, file_changed) = classify_paths(&ev.paths, &pirep);
            pending
                .lock()
                .unwrap()
                .note(md_changed, file_changed, now_ms());
        }
    })
    .map_err(|e| e.to_string())?;

    w.watch(&r, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(w);

    // One flusher for the app's lifetime; switching vaults replaces the watcher
    // above but keeps writing into the same pending state.
    {
        let mut started = state.flusher_started.lock().unwrap();
        if !*started {
            *started = true;
            let pending = state.pending.clone();
            let app_h = app.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let ready = pending.lock().unwrap().take_if_quiet(now_ms(), QUIET_MS);
                if let Some((md, other)) = ready {
                    // A markdown rescan refreshes the file listing too, so the
                    // heavier event stands in for both.
                    if md {
                        app_h.emit("vault-changed", ()).ok();
                    } else if other {
                        app_h.emit("files-changed", ()).ok();
                    }
                }
            });
        }
    }

    Ok(db)
}

#[tauri::command]
pub fn read_doc(doc_id: String, state: State<VaultState>) -> Result<DocContent, String> {
    vault::read_doc(&get_root(&state)?, &doc_id)
}

#[tauri::command]
pub fn write_doc(doc_id: String, content: String, state: State<VaultState>) -> Result<Db, String> {
    vault::write_doc(&get_root(&state)?, &doc_id, &content, "in-app")
}

#[tauri::command]
pub fn mark_read(doc_id: String, state: State<VaultState>) -> Result<Db, String> {
    vault::mark_read(&get_root(&state)?, &doc_id)
}

#[tauri::command]
pub fn mark_read_many(doc_ids: Vec<String>, state: State<VaultState>) -> Result<Db, String> {
    vault::mark_read_many(&get_root(&state)?, &doc_ids)
}

#[tauri::command]
pub fn list_updates(state: State<VaultState>) -> Result<Vec<DocEntry>, String> {
    Ok(vault::list_updates(&get_root(&state)?))
}

#[tauri::command]
pub fn diff(
    doc_id: String,
    from: u32,
    to: u32,
    state: State<VaultState>,
) -> Result<DiffResult, String> {
    vault::diff(&get_root(&state)?, &doc_id, from, to)
}

#[tauri::command]
pub fn list_changes(doc_id: String, state: State<VaultState>) -> Result<Vec<ChangeRecord>, String> {
    Ok(vault::list_changes(&get_root(&state)?, &doc_id))
}

#[tauri::command]
pub fn revert(doc_id: String, version: u32, state: State<VaultState>) -> Result<Db, String> {
    vault::revert(&get_root(&state)?, &doc_id, version)
}

#[tauri::command]
pub fn create_doc(
    rel_path: String,
    content: String,
    state: State<VaultState>,
) -> Result<Db, String> {
    let root = get_root(&state)?;
    create_doc_at(&root, &rel_path, &content)
}

#[tauri::command]
pub fn create_folder(rel_path: String, state: State<VaultState>) -> Result<Db, String> {
    vault::create_folder(&get_root(&state)?, &rel_path)
}

#[tauri::command]
pub fn rename_doc(
    doc_id: String,
    new_rel_path: String,
    state: State<VaultState>,
) -> Result<Db, String> {
    let root = get_root(&state)?;
    rename_doc_at(&root, &doc_id, &new_rel_path)
}

#[tauri::command]
pub fn delete_doc(doc_id: String, state: State<VaultState>) -> Result<Db, String> {
    vault::delete_doc(&get_root(&state)?, &doc_id)
}

#[tauri::command]
pub fn accept_change(doc_id: String, state: State<VaultState>) -> Result<Db, String> {
    vault::accept_change(&get_root(&state)?, &doc_id)
}

#[tauri::command]
pub fn decide_version(doc_id: String, version: u32, state: State<VaultState>) -> Result<Db, String> {
    vault::decide_version(&get_root(&state)?, &doc_id, version)
}

#[tauri::command]
pub fn list_files(state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let pirep = root.join(".pirep");
    let mut files: Vec<String> = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            // Allow root; block hidden dirs and .pirep subtree
            e.depth() == 0
                || (!name.starts_with('.') && !e.path().starts_with(&pirep))
        })
    {
        let Ok(e) = entry else { continue };
        if !e.file_type().is_file() { continue }
        let p = e.path();
        if p.extension().map(|e| e == "md").unwrap_or(false) { continue }
        if p.file_name().map(|n| n == ".DS_Store").unwrap_or(false) { continue }
        if let Ok(rel) = p.strip_prefix(&root) {
            if let Some(s) = rel.to_str() {
                files.push(s.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn read_raw_file(rel_path: String, state: State<VaultState>) -> Result<String, String> {
    read_raw_file_at(&get_root(&state)?, &rel_path)
}

#[tauri::command]
pub fn open_vault_file(
    rel_path: String,
    state: State<VaultState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = vault_file(&get_root(&state)?, &rel_path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_raw_file(rel_path: String, content: String, state: State<VaultState>) -> Result<(), String> {
    write_raw_file_at(&get_root(&state)?, &rel_path, &content)
}

#[tauri::command]
pub fn list_dirs(state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let pirep = root.join(".pirep");
    let mut dirs: Vec<String> = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            !name.starts_with('.') && !e.path().starts_with(&pirep)
        })
    {
        let Ok(e) = entry else { continue };
        if !e.file_type().is_dir() { continue }
        if let Ok(rel) = e.path().strip_prefix(&root) {
            if let Some(s) = rel.to_str() {
                dirs.push(s.to_string());
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

#[tauri::command]
pub fn rename_raw_file(rel_path: String, new_name: String, state: State<VaultState>) -> Result<(), String> {
    rename_raw_file_at(&get_root(&state)?, &rel_path, &new_name)
}

#[tauri::command]
pub fn delete_raw_file(rel_path: String, state: State<VaultState>) -> Result<(), String> {
    delete_raw_file_at(&get_root(&state)?, &rel_path)
}

#[tauri::command]
pub fn copy_diagram_image(app: tauri::AppHandle, svg: String) -> Result<(), String> {
    use resvg::{tiny_skia, usvg};
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let mut opts = usvg::Options::default();
    opts.font_family = "Helvetica Neue".to_string();
    opts.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_str(&svg, &opts).map_err(|e| e.to_string())?;
    let size = tree.size();
    let w = (size.width() as u32).max(1);
    let h = (size.height() as u32).max(1);
    let mut pixmap = tiny_skia::Pixmap::new(w, h).ok_or("pixmap alloc failed")?;
    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    let png = pixmap.encode_png().map_err(|e| e.to_string())?;
    let image = tauri::image::Image::from_bytes(&png).map_err(|e| e.to_string())?;
    app.clipboard().write_image(&image).map_err(|e| e.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    // One user action arrives as a burst. Measured against a real watcher,
    // creating a folder holding a .html and two .md files produced 11 events in
    // the same millisecond, folder first. The old leading-edge rule announced
    // only that first event, so the new notes were never announced at all.
    #[test]
    fn a_burst_announces_every_kind_it_contained() {
        let mut c = Coalescer::default();
        c.note(false, true, 1000); // newfolder
        c.note(false, true, 1000); // a.html
        c.note(true, false, 1000); // b.md
        c.note(true, false, 1000); // c.md

        // Nothing escapes while the filesystem is still busy.
        assert_eq!(c.take_if_quiet(1200, QUIET_MS), None);
        // Once quiet, both kinds are reported — not just the first one seen.
        assert_eq!(c.take_if_quiet(1500, QUIET_MS), Some((true, true)));
        // And the pending state is cleared, so it fires once per burst.
        assert_eq!(c.take_if_quiet(9000, QUIET_MS), None);
    }

    #[test]
    fn trailing_events_extend_the_quiet_window() {
        let mut c = Coalescer::default();
        c.note(false, true, 1000);
        assert_eq!(c.take_if_quiet(1300, QUIET_MS), None);
        c.note(false, true, 1350); // still arriving — wait longer
        assert_eq!(c.take_if_quiet(1600, QUIET_MS), None);
        assert_eq!(c.take_if_quiet(1800, QUIET_MS), Some((false, true)));
    }

    #[test]
    fn ignored_paths_never_arm_the_flush() {
        let mut c = Coalescer::default();
        c.note(false, false, 1000); // .pirep snapshot, sqlite WAL, .DS_Store…
        assert_eq!(c.take_if_quiet(9000, QUIET_MS), None);
    }

    #[test]
    fn classify_routes_md_vs_files_and_ignores_noise() {
        let root = PathBuf::from("/v");
        let pirep = root.join(".pirep");
        let p = |s: &str| root.join(s);

        // a new .html → cheap file-list refresh only (the bug: it was ignored)
        assert_eq!(classify_paths(&[p("outputs/14-tool.html")], &pirep), (false, true));
        // markdown → full rescan
        assert_eq!(classify_paths(&[p("notes/a.md")], &pirep), (true, false));
        // both in one event
        assert_eq!(classify_paths(&[p("a.md"), p("b.csv")], &pirep), (true, true));
        // volatile sidecars / snapshots / hidden dirs / .DS_Store → nothing
        for noisy in ["bus.db-shm", "bus.db-wal", "app.log", "x.tmp", ".DS_Store"] {
            assert_eq!(classify_paths(&[p(noisy)], &pirep), (false, false), "{noisy}");
        }
        assert_eq!(classify_paths(&[pirep.join("snapshots/x.md")], &pirep), (false, false));
        assert_eq!(classify_paths(&[p(".git/index")], &pirep), (false, false));
    }

    #[test]
    fn vault_file_rejects_parent_escape() {
        let base = std::env::temp_dir().join(format!("pirep-open-{}", std::process::id()));
        let root = base.join("vault");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("inside.html"), "ok").unwrap();
        std::fs::write(base.join("outside.html"), "no").unwrap();

        assert!(vault_file(&root, "inside.html").is_ok());
        assert!(vault_file(&root, "../outside.html").is_err());
        assert!(vault_file(&root, base.join("outside.html").to_str().unwrap()).is_err());
        assert!(new_vault_file(&root, "new.md").is_ok());
        assert!(new_vault_file(&root, "../new.md").is_err());
        assert!(new_vault_file(&root, base.join("new.md").to_str().unwrap()).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&base, root.join("escape")).unwrap();
            assert!(vault_file(&root, "escape/outside.html").is_err());
            assert!(new_vault_file(&root, "escape/new.md").is_err());
        }

        std::fs::remove_dir_all(base).unwrap();
    }

    fn escape_fixture(name: &str) -> (PathBuf, PathBuf, Vec<String>) {
        let base = std::env::temp_dir().join(format!("pirep-{name}-{}", std::process::id()));
        let root = base.join("vault");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("inside.txt"), "inside").unwrap();
        std::fs::write(base.join("outside.txt"), "outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&base, root.join("escape")).unwrap();
        let paths = vec![
            "../outside.txt".to_string(),
            base.join("outside.txt").to_string_lossy().into_owned(),
            "escape/outside.txt".to_string(),
        ];
        (base, root, paths)
    }

    #[test]
    fn read_raw_file_rejects_all_escape_forms() {
        let (base, root, paths) = escape_fixture("read-escape");
        for path in paths {
            assert!(read_raw_file_at(&root, &path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn write_raw_file_rejects_all_escape_forms() {
        let (base, root, paths) = escape_fixture("write-escape");
        for path in paths {
            assert!(
                write_raw_file_at(&root, &path, "changed").is_err(),
                "{path}"
            );
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rename_raw_file_rejects_all_escape_forms() {
        let (base, root, paths) = escape_fixture("rename-raw-escape");
        for path in paths {
            assert!(
                rename_raw_file_at(&root, &path, "renamed.txt").is_err(),
                "{path}"
            );
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn delete_raw_file_rejects_all_escape_forms() {
        let (base, root, paths) = escape_fixture("delete-escape");
        for path in paths {
            assert!(delete_raw_file_at(&root, &path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn create_doc_rejects_all_escape_forms() {
        let (base, root, _) = escape_fixture("create-escape");
        let paths = [
            "../new.md".to_string(),
            base.join("new.md").to_string_lossy().into_owned(),
            "escape/new.md".to_string(),
        ];
        for path in paths {
            assert!(create_doc_at(&root, &path, "# no").is_err(), "{path}");
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rename_doc_rejects_all_escape_forms() {
        let (base, root, _) = escape_fixture("rename-doc-escape");
        std::fs::write(root.join("note.md"), "# Note").unwrap();
        vault::scan(&root).unwrap();
        let paths = [
            "../new.md".to_string(),
            base.join("new.md").to_string_lossy().into_owned(),
            "escape/new.md".to_string(),
        ];
        for path in paths {
            assert!(
                rename_doc_at(&root, "note.md", &path).is_err(),
                "{path}"
            );
        }
        std::fs::remove_dir_all(base).unwrap();
    }
}
