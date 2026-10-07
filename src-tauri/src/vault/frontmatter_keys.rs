use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct FrontmatterKeyCount {
    pub key: String,
    pub count: usize,
}

pub fn collect(root: &Path) -> Result<Vec<FrontmatterKeyCount>, String> {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && e.file_name().to_str().is_some_and(|n| n.starts_with('.'))))
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()).is_none_or(|e| !e.eq_ignore_ascii_case("md")) { continue; }
        let Ok(content) = std::fs::read_to_string(path) else { continue };
        let mut lines = content.lines();
        if lines.next().map(str::trim) != Some("---") { continue; }
        let mut seen = std::collections::HashSet::new();
        for line in lines {
            let line = line.trim();
            if line == "---" { break; }
            if let Some((key, _)) = line.split_once(':') {
                let key = key.trim().to_ascii_lowercase();
                if !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { seen.insert(key); }
            }
        }
        for key in seen { *counts.entry(key).or_default() += 1; }
    }
    let mut result: Vec<_> = counts.into_iter().map(|(key, count)| FrontmatterKeyCount { key, count }).collect();
    result.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aggregates_unique_frontmatter_keys_by_document_and_frequency() {
        let root = std::env::temp_dir().join(format!("pirep-key-count-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.md"), "---\nauthor: A\ntags: [x]\nauthor: B\n---\nbody").unwrap();
        std::fs::write(root.join("b.md"), "---\nauthor: C\nstatus: Draft\n---\nbody").unwrap();
        std::fs::write(root.join("c.md"), "# no frontmatter").unwrap();
        let got = collect(&root).unwrap();
        assert_eq!(got.iter().map(|k| (&*k.key, k.count)).collect::<Vec<_>>(), vec![("author", 2), ("status", 1), ("tags", 1)]);
        std::fs::remove_dir_all(root).unwrap();
    }
}
