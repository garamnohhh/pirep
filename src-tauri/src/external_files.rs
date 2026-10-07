use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{State, Webview};

#[derive(Default)]
pub struct ExternalFileRoots(Mutex<HashMap<String, PathBuf>>);

impl ExternalFileRoots {
    pub fn get(&self, label: &str) -> Option<PathBuf> {
        self.0.lock().ok()?.get(label).cloned()
    }

    pub fn remove(&self, label: &str) {
        if let Ok(mut roots) = self.0.lock() {
            roots.remove(label);
        }
    }

    fn register(&self, label: &str, file: &str) -> Result<(), String> {
        if !label.starts_with("external-") {
            return Err("not an external document window".into());
        }
        let file = Path::new(file).canonicalize().map_err(|e| e.to_string())?;
        if !is_markdown(&file) || has_hidden_component(&file) {
            return Err("not an accessible Markdown file".into());
        }
        let root = file.parent().ok_or("invalid Markdown path")?.to_path_buf();
        let mut roots = self.0.lock().map_err(|_| "external roots unavailable")?;
        if roots
            .get(label)
            .is_some_and(|registered| registered != &root)
        {
            return Err("external file root is already registered".into());
        }
        roots.insert(label.to_string(), root);
        Ok(())
    }
}

#[tauri::command]
pub fn register_external_file_root(
    path: String,
    webview: Webview,
    roots: State<'_, ExternalFileRoots>,
) -> Result<(), String> {
    roots.register(webview.label(), &path)
}

#[tauri::command]
pub fn resolve_external_markdown_link(
    source_path: String,
    target: String,
    wiki: bool,
    webview: Webview,
    roots: State<'_, ExternalFileRoots>,
) -> Result<Option<String>, String> {
    let root = roots
        .get(webview.label())
        .ok_or("external file root is not registered")?;
    Ok(
        resolve_markdown_link(&root, Path::new(&source_path), &target, wiki, &home_dir())
            .map(|path| path.to_string_lossy().into_owned()),
    )
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

fn has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(part) => part.to_string_lossy().starts_with('.'),
        _ => false,
    })
}

fn is_shallow_root(root: &Path, home: &Path) -> bool {
    if root == Path::new("/") || root == Path::new("/Users") {
        return true;
    }
    if home.as_os_str().is_empty() {
        return true;
    }
    let Ok(home) = home.canonicalize() else {
        return true;
    };
    home.starts_with(root)
}

pub fn resolve_external_asset(root: &Path, requested: &Path, home: &Path) -> Result<PathBuf, u16> {
    let root = root.canonicalize().map_err(|_| 403u16)?;
    if !requested.is_absolute()
        || requested
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        || has_hidden_component(requested)
    {
        return Err(403);
    }
    let real = requested.canonicalize().map_err(|_| 404u16)?;
    let relative = real.strip_prefix(&root).map_err(|_| 403u16)?;
    if !real.is_file()
        || has_hidden_component(relative)
        || (is_shallow_root(&root, home) && relative.components().count() != 1)
        || !is_image(&real) && !is_markdown(&real)
    {
        return Err(403);
    }
    Ok(real)
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp"
            )
        })
}

fn valid_target(target: &str, wiki: bool) -> Option<PathBuf> {
    let target = target.split(['#', '?']).next()?.trim();
    if target.is_empty() || target.starts_with(['/', '\\']) || target.contains(['\\', ':']) {
        return None;
    }
    let target = if wiki
        && !Path::new(target).extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
        }) {
        format!("{target}.md")
    } else {
        target.to_string()
    };
    let path = PathBuf::from(target);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        || has_hidden_component(&path)
    {
        return None;
    }
    if !is_markdown(&path) {
        return None;
    }
    Some(path)
}

fn contained_markdown(root: &Path, candidate: &Path, shallow: bool) -> Option<PathBuf> {
    let real = candidate.canonicalize().ok()?;
    let relative = real.strip_prefix(root).ok()?;
    if !real.is_file() || !is_markdown(&real) || has_hidden_component(relative) {
        return None;
    }
    if shallow
        && relative
            .parent()
            .is_some_and(|parent| !parent.as_os_str().is_empty())
    {
        return None;
    }
    Some(real)
}

fn resolve_markdown_link(
    root: &Path,
    source: &Path,
    target: &str,
    wiki: bool,
    home: &Path,
) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let source = source.canonicalize().ok()?;
    let source_relative = source.strip_prefix(&root).ok()?;
    if !is_markdown(&source) || has_hidden_component(source_relative) {
        return None;
    }
    let target = valid_target(target, wiki)?;
    let parent = source.parent()?;
    let shallow = is_shallow_root(&root, home);

    if let Some(hit) = contained_markdown(&root, &parent.join(&target), shallow) {
        return Some(hit);
    }
    if !wiki || target.components().count() != 1 || shallow {
        return None;
    }

    const MAX_SEARCH_ENTRIES: usize = 1000;
    for entry in walkdir::WalkDir::new(&root)
        .min_depth(1)
        .max_depth(3)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
        })
        .take(MAX_SEARCH_ENTRIES)
        .flatten()
    {
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(target.file_name()?.to_string_lossy().as_ref())
        {
            if let Some(hit) = contained_markdown(&root, entry.path(), false) {
                return Some(hit);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "pirep-external-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn external_roots_are_isolated_by_window_label() {
        let dir = fixture();
        let one = dir.join("one");
        let two = dir.join("two");
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        std::fs::write(one.join("a.md"), "a").unwrap();
        std::fs::write(two.join("b.md"), "b").unwrap();
        let roots = ExternalFileRoots::default();
        roots
            .register("external-one", one.join("a.md").to_str().unwrap())
            .unwrap();
        roots
            .register("external-two", two.join("b.md").to_str().unwrap())
            .unwrap();
        assert_eq!(roots.get("external-one"), Some(one));
        assert_eq!(roots.get("external-two"), Some(two));
        assert_eq!(
            resolve_external_asset(
                &roots.get("external-one").unwrap(),
                &dir.join("two/b.md"),
                &dir
            ),
            Err(403),
        );
        roots.remove("external-one");
        assert_eq!(roots.get("external-one"), None);
        assert!(roots.get("external-two").is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn external_assets_allow_nested_images_and_markdown_only() {
        let dir = fixture();
        let root = dir.join("Outside");
        std::fs::create_dir_all(root.join("img")).unwrap();
        std::fs::write(root.join("doc.md"), "doc").unwrap();
        std::fs::write(root.join("img/pic.png"), "png").unwrap();
        std::fs::write(root.join("secret.txt"), "no").unwrap();
        assert!(resolve_external_asset(&root, &root.join("img/pic.png"), &dir).is_ok());
        assert!(resolve_external_asset(&root, &root.join("doc.md"), &dir).is_ok());
        assert_eq!(
            resolve_external_asset(&root, &root.join("secret.txt"), &dir),
            Err(403)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn external_assets_refuse_parent_absolute_dot_and_symlink_escape() {
        let dir = fixture();
        let root = dir.join("Outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("ok.png"), "ok").unwrap();
        std::fs::write(dir.join("secret.png"), "secret").unwrap();
        std::fs::write(root.join(".hidden.png"), "hidden").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("secret.png"), root.join("link.png")).unwrap();
        assert_eq!(
            resolve_external_asset(&root, &root.join("../secret.png"), &dir),
            Err(403)
        );
        assert_eq!(
            resolve_external_asset(&root, &dir.join("secret.png"), &dir),
            Err(403)
        );
        assert_eq!(
            resolve_external_asset(&root, &root.join(".hidden.png"), &dir),
            Err(403)
        );
        #[cfg(unix)]
        assert_eq!(
            resolve_external_asset(&root, &root.join("link.png"), &dir),
            Err(403)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn broad_roots_cannot_serve_or_resolve_child_files() {
        let dir = fixture();
        let root = dir.join("home");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("same.png"), "same").unwrap();
        std::fs::write(root.join("sub/child.png"), "child").unwrap();
        std::fs::write(root.join("same.md"), "same").unwrap();
        std::fs::write(root.join("sub/child.md"), "child").unwrap();
        assert!(resolve_external_asset(&root, &root.join("same.png"), &root).is_ok());
        assert_eq!(
            resolve_external_asset(&root, &root.join("sub/child.png"), &root),
            Err(403)
        );
        assert_eq!(
            resolve_external_asset(&root, &root.join("sub/child.png"), Path::new("")),
            Err(403)
        );
        assert!(resolve_markdown_link(&root, &root.join("same.md"), "same", true, &root).is_some());
        assert!(
            resolve_markdown_link(&root, &root.join("same.md"), "sub/child.md", false, &root)
                .is_none()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn broad_root_detection_canonicalizes_home_aliases() {
        let dir = fixture();
        let physical = dir.join("physical-home");
        let alias = dir.join("home-alias");
        std::fs::create_dir_all(&physical).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&physical, &alias).unwrap();
        #[cfg(unix)]
        assert!(is_shallow_root(&physical, &alias));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn external_markdown_links_resolve_relative_and_bounded_wiki_targets() {
        let dir = fixture();
        let root = dir.join("Outside");
        std::fs::create_dir_all(root.join("img")).unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("doc.md"), "doc").unwrap();
        std::fs::write(root.join("other.md"), "other").unwrap();
        std::fs::write(root.join("sub/deep.md"), "deep").unwrap();
        std::fs::write(dir.join("secret.md"), "secret").unwrap();
        assert_eq!(
            resolve_markdown_link(&root, &root.join("doc.md"), "sub/deep.md", false, &dir),
            Some(root.join("sub/deep.md"))
        );
        assert_eq!(
            resolve_markdown_link(&root, &root.join("doc.md"), "deep", true, &dir),
            Some(root.join("sub/deep.md"))
        );
        assert_eq!(
            resolve_markdown_link(&root, &root.join("doc.md"), "../secret.md", false, &dir),
            None
        );
        assert_eq!(
            resolve_markdown_link(&root, &root.join("doc.md"), "/secret.md", false, &dir),
            None
        );
        assert_eq!(
            resolve_markdown_link(&root, &root.join("doc.md"), ".hidden", true, &dir),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
