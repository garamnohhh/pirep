use std::path::{Component, Path};

fn path(root: &Path) -> std::path::PathBuf { root.join(".pirep").join("pins.json") }

pub fn read(root: &Path) -> Result<Vec<String>, String> {
    let file = path(root);
    if !file.exists() { return Ok(vec![]); }
    let raw = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
    let mut files: Vec<String> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let original = files.clone();
    files.retain(|rel| valid(rel) && root.join(rel).is_file());
    files.sort(); files.dedup();
    if files != original { write(root, &files)?; }
    Ok(files)
}

fn valid(rel: &str) -> bool {
    let path = Path::new(rel);
    !path.as_os_str().is_empty() && path.components().all(|c| matches!(c, Component::Normal(_)))
}

pub fn write(root: &Path, files: &[String]) -> Result<(), String> {
    let dir = root.join(".pirep");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut files: Vec<_> = files.iter().filter(|p| valid(p)).cloned().collect();
    files.sort(); files.dedup();
    let temp = dir.join("pins.json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(&files).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path(root)).map_err(|e| e.to_string())
}

pub fn toggle(root: &Path, rel: &str) -> Result<Vec<String>, String> {
    if !valid(rel) || !root.join(rel).is_file() { return Err("invalid path".into()); }
    let mut files = read(root)?;
    if files.iter().any(|p| p == rel) { files.retain(|p| p != rel); } else { files.push(rel.into()); }
    write(root, &files)?;
    read(root)
}

pub fn rename(root: &Path, old: &str, new: &str) -> Result<(), String> {
    let file = path(root);
    let raw = if file.exists() { std::fs::read_to_string(file).map_err(|e| e.to_string())? } else { "[]".into() };
    let mut files: Vec<String> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(pin) = files.iter_mut().find(|p| p.as_str() == old) { *pin = new.into(); }
    write(root, &files)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("pirep-pins-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(root.join(".pirep")).unwrap();
        std::fs::write(root.join("a.csv"), "x").unwrap(); root
    }
    #[test] fn pins_read_write_toggle_rename_and_prune_deleted_files() {
        let root = fixture();
        assert!(read(&root).unwrap().is_empty());
        assert_eq!(toggle(&root, "a.csv").unwrap(), vec!["a.csv"]);
        assert_eq!(std::fs::read_to_string(root.join(".pirep/pins.json")).unwrap(), "[\n  \"a.csv\"\n]");
        std::fs::rename(root.join("a.csv"), root.join("b.csv")).unwrap();
        rename(&root, "a.csv", "b.csv").unwrap();
        assert_eq!(read(&root).unwrap(), vec!["b.csv"]);
        std::fs::remove_file(root.join("b.csv")).unwrap();
        assert!(read(&root).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
