pub mod change;
pub mod db;
pub mod diff;
pub mod hash;
pub mod snapshot;
pub mod frontmatter_keys;

use change::ChangeRecord;
use db::{Db, DocEntry};
use diff::DiffResult;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct DocContent {
    pub content: String,
    pub meta: DocEntry,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn title_from(content: &str, fallback_path: &str) -> String {
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix("# ") {
            return rest.trim().to_string();
        }
    }
    Path::new(fallback_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_path)
        .to_string()
}

// Parse YAML frontmatter (--- block at top) for pinned and tags fields.
fn parse_frontmatter(content: &str) -> (bool, Vec<String>) {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (false, vec![]);
    }
    let mut pinned = false;
    let mut tags: Vec<String> = vec![];
    for line in lines {
        let t = line.trim();
        if t == "---" {
            break;
        }
        if let Some(rest) = t.strip_prefix("pinned:") {
            pinned = rest.trim().eq_ignore_ascii_case("true");
        } else if let Some(rest) = t.strip_prefix("tags:") {
            // inline list: tags: [a, b, c]
            let inner = rest.trim().trim_start_matches('[').trim_end_matches(']');
            tags = inner
                .split(',')
                .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if t.starts_with("- ") && !tags.is_empty() {
            // block list item (continuation)
        } else if t.starts_with("- ") {
            // block list under tags key not yet seen — skip
        }
    }
    (pinned, tags)
}

fn rel_doc_id(root: &Path, p: &Path) -> Result<(String, String), String> {
    let rel = p.strip_prefix(root).map_err(|e| e.to_string())?;
    let path = rel.to_string_lossy().replace('\\', "/");
    Ok((path.to_lowercase(), path))
}

// Walk the vault, detect new/changed/deleted .md files, snapshot + record changes.
pub fn scan(root: &Path) -> Result<Db, String> {
    let mut db = db::load(root);

    // Migration: entries that predate last_decided_version (serde default = 0).
    // Set ldv = lrv if user has read some version, else cv (never-read files are not "changed").
    let was_empty = db.docs.is_empty();
    for e in db.docs.values_mut() {
        if e.last_decided_version == 0 {
            e.last_decided_version = if e.last_read_version > 0 {
                e.last_read_version
            } else {
                e.current_version
            };
        }
        // Migration: `created` predates this field → seed from mtime.
        if e.created == 0 {
            e.created = e.mtime;
        }
    }

    let pirep = db::pirep_dir(root);
    let mut found = std::collections::HashSet::new();

    // Don't descend into .pirep (holds 1000s of snapshot .md), VCS, or
    // dependency/build dirs — keeps the walk small and avoids indexing stray
    // README.md under node_modules/target.
    let pruned = |name: &str| {
        name == ".pirep"
            || name == "node_modules"
            || name == "target"
            || (name.starts_with('.') && name.len() > 1)
    };
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && pruned(e.file_name().to_str().unwrap_or(""))))
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() || p.starts_with(&pirep) {
            continue;
        }
        if !p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
            e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown")
        }) {
            continue;
        }

        let (doc_id, path) = rel_doc_id(root, p)?;
        found.insert(doc_id.clone());
        let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
        let h = hash::sha256_hex(&content);

        let (fm_pinned, fm_tags) = parse_frontmatter(&content);

        match db.docs.get(&doc_id).cloned() {
            None => {
                snapshot::write_snapshot(root, &doc_id, 1, &content)?;
                // Initial vault scan: treat existing files as already read.
                // Files added after the first scan start as unread (lrv=0).
                let lrv = if was_empty { 1 } else { 0 };
                db.docs.insert(
                    doc_id.clone(),
                    DocEntry {
                        doc_id: doc_id.clone(),
                        path,
                        title: title_from(&content, &doc_id),
                        current_version: 1,
                        last_read_version: lrv,
                        last_decided_version: 1,
                        pinned: fm_pinned,
                        tags: fm_tags,
                        hash: h,
                        mtime: now(),
                        created: now(),
                    },
                );
            }
            Some(existing) if existing.hash != h => {
                let new_v = existing.current_version + 1;
                let prev =
                    snapshot::read_snapshot(root, &doc_id, existing.current_version).unwrap_or_default();
                let (ops, stats) = diff::word_diff(&prev, &content);
                snapshot::write_snapshot(root, &doc_id, new_v, &content)?;
                change::append_change(
                    root,
                    &doc_id,
                    ChangeRecord {
                        from: existing.current_version,
                        to: new_v,
                        at: now(),
                        source: "external".into(),
                        stats,
                        ops,
                    },
                )?;
                let e = db.docs.get_mut(&doc_id).unwrap();
                e.current_version = new_v;
                e.hash = h;
                e.mtime = now();
                e.title = title_from(&content, &doc_id);
                e.pinned = fm_pinned;
                e.tags = fm_tags;
            }
            Some(_) => {
                // hash unchanged — no new snapshot, but always sync frontmatter
                let e = db.docs.get_mut(&doc_id).unwrap();
                e.pinned = fm_pinned;
                e.tags = fm_tags;
            }
        }
    }

    // Remove docs whose files no longer exist on disk
    db.docs.retain(|id, _| found.contains(id));

    db::save(root, &db)?;
    Ok(db)
}

pub fn read_doc(root: &Path, doc_id: &str) -> Result<DocContent, String> {
    let meta = db::load(root)
        .docs
        .get(doc_id)
        .cloned()
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;
    let content = std::fs::read_to_string(root.join(&meta.path)).map_err(|e| e.to_string())?;
    Ok(DocContent { content, meta })
}

// Write new content to disk + snapshot + change record + version bump.
pub fn write_doc(root: &Path, doc_id: &str, content: &str, source: &str) -> Result<Db, String> {
    let mut db = db::load(root);
    let existing = db
        .docs
        .get(doc_id)
        .cloned()
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;

    let h = hash::sha256_hex(content);
    if h == existing.hash {
        return Ok(db); // nothing changed
    }

    // In-app edits are not "changes" to review (pirep reviews external/AI edits
    // only). No version bump: overwrite the current-version snapshot so it stays
    // the baseline for the next external diff, sync hash/meta, done.
    // Exception: a pending undecided external change (ldv < cv) — fall through to
    // the full path so that version's content and timeline aren't destroyed.
    if source == "in-app" && existing.last_decided_version == existing.current_version {
        std::fs::write(root.join(&existing.path), content).map_err(|e| e.to_string())?;
        snapshot::write_snapshot(root, doc_id, existing.current_version, content)?;
        let (fm_pinned, fm_tags) = parse_frontmatter(content);
        let e = db.docs.get_mut(doc_id).unwrap();
        e.hash = h;
        e.mtime = now();
        e.title = title_from(content, doc_id);
        e.pinned = fm_pinned;
        e.tags = fm_tags;
        db::save(root, &db)?;
        return Ok(db);
    }

    let new_v = existing.current_version + 1;
    let prev = snapshot::read_snapshot(root, doc_id, existing.current_version).unwrap_or_default();
    let (ops, stats) = diff::word_diff(&prev, content);

    std::fs::write(root.join(&existing.path), content).map_err(|e| e.to_string())?;
    snapshot::write_snapshot(root, doc_id, new_v, content)?;
    change::append_change(
        root,
        doc_id,
        ChangeRecord {
            from: existing.current_version,
            to: new_v,
            at: now(),
            source: source.into(),
            stats,
            ops,
        },
    )?;

    let (fm_pinned, fm_tags) = parse_frontmatter(content);
    let e = db.docs.get_mut(doc_id).unwrap();
    e.current_version = new_v;
    e.hash = h;
    e.mtime = now();
    e.title = title_from(content, doc_id);
    e.pinned = fm_pinned;
    e.tags = fm_tags;
    // edits the user made (or a revert they triggered) are read and decided by definition
    if source == "in-app" || source == "revert" {
        e.last_read_version = new_v;
        e.last_decided_version = new_v;
    }

    db::save(root, &db)?;
    Ok(db)
}

pub fn mark_read(root: &Path, doc_id: &str) -> Result<Db, String> {
    let mut db = db::load(root);
    let e = db
        .docs
        .get_mut(doc_id)
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;
    e.last_read_version = e.current_version;
    e.last_decided_version = e.current_version;
    db::save(root, &db)?;
    Ok(db)
}

pub fn mark_read_many(root: &Path, doc_ids: &[String]) -> Result<Db, String> {
    mark_read_many_with(root, doc_ids, db::save)
}

fn mark_read_many_with(
    root: &Path,
    doc_ids: &[String],
    save: impl FnOnce(&Path, &Db) -> Result<(), String>,
) -> Result<Db, String> {
    let mut db = db::load(root);
    for doc_id in doc_ids {
        let e = db
            .docs
            .get_mut(doc_id)
            .ok_or_else(|| format!("unknown doc: {doc_id}"))?;
        e.last_read_version = e.current_version;
        e.last_decided_version = e.current_version;
    }
    save(root, &db)?;
    Ok(db)
}

pub fn accept_change(root: &Path, doc_id: &str) -> Result<Db, String> {
    let mut db = db::load(root);
    let e = db
        .docs
        .get_mut(doc_id)
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;
    e.last_decided_version = e.current_version;
    db::save(root, &db)?;
    Ok(db)
}

pub fn decide_version(root: &Path, doc_id: &str, version: u32) -> Result<Db, String> {
    let mut db = db::load(root);
    let e = db
        .docs
        .get_mut(doc_id)
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;
    e.last_decided_version = version.min(e.current_version);
    db::save(root, &db)?;
    Ok(db)
}

pub fn list_updates(root: &Path) -> Vec<DocEntry> {
    let mut v: Vec<DocEntry> = db::load(root)
        .docs
        .into_values()
        .filter(|d| d.current_version > d.last_read_version)
        .collect();
    v.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    v
}

pub fn diff(root: &Path, doc_id: &str, from: u32, to: u32) -> Result<DiffResult, String> {
    let a = if from == 0 {
        String::new()
    } else {
        snapshot::read_snapshot(root, doc_id, from)?
    };
    let b = snapshot::read_snapshot(root, doc_id, to)?;
    let (ops, stats) = diff::word_diff(&a, &b);
    Ok(DiffResult {
        from,
        to,
        ops,
        stats,
    })
}

pub fn list_changes(root: &Path, doc_id: &str) -> Vec<ChangeRecord> {
    change::load_changes(root, doc_id)
}

// Restore snapshot at `version` back to disk as a new version.
pub fn revert(root: &Path, doc_id: &str, version: u32) -> Result<Db, String> {
    let snap = snapshot::read_snapshot(root, doc_id, version)?;
    write_doc(root, doc_id, &snap, "revert")
}

pub fn rename_doc(root: &Path, doc_id: &str, new_rel_path: &str) -> Result<Db, String> {
    let mut db = db::load(root);
    if !db.docs.contains_key(doc_id) {
        db = scan(root)?;
    }
    let existing = db.docs.get(doc_id).cloned()
        .ok_or_else(|| format!("파일을 찾을 수 없습니다: {doc_id}. Base를 다시 스캔한 뒤 재시도하세요."))?;

    let old_file = root.join(&existing.path);
    let new_file = root.join(new_rel_path);
    if new_file.exists() {
        return Err(format!("already exists: {new_rel_path}"));
    }
    if let Some(p) = new_file.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&old_file, &new_file).map_err(|e| e.to_string())?;

    let new_doc_id = new_rel_path.to_lowercase().replace('\\', "/");
    let pirep = db::pirep_dir(root);

    let old_snap = pirep.join("snapshots").join(db::storage_key(doc_id));
    let new_snap = pirep.join("snapshots").join(db::storage_key(&new_doc_id));
    if old_snap.exists() { std::fs::rename(&old_snap, &new_snap).ok(); }

    let old_chg = pirep.join("changes").join(format!("{}.json", db::storage_key(doc_id)));
    let new_chg = pirep.join("changes").join(format!("{}.json", db::storage_key(&new_doc_id)));
    if old_chg.exists() { std::fs::rename(&old_chg, &new_chg).ok(); }

    db.docs.remove(doc_id);
    let content = std::fs::read_to_string(&new_file).unwrap_or_default();
    let mut entry = existing;
    entry.doc_id = new_doc_id.clone();
    entry.path = new_rel_path.replace('\\', "/");
    entry.title = title_from(&content, new_rel_path);
    db.docs.insert(new_doc_id, entry);

    db::save(root, &db)?;
    Ok(db)
}

pub fn delete_doc(root: &Path, doc_id: &str) -> Result<Db, String> {
    let mut db = db::load(root);
    let existing = db.docs.get(doc_id).cloned()
        .ok_or_else(|| format!("unknown doc: {doc_id}"))?;

    std::fs::remove_file(root.join(&existing.path)).ok();

    let pirep = db::pirep_dir(root);
    std::fs::remove_dir_all(pirep.join("snapshots").join(db::storage_key(doc_id))).ok();
    std::fs::remove_file(pirep.join("changes").join(format!("{}.json", db::storage_key(doc_id)))).ok();

    db.docs.remove(doc_id);
    db::save(root, &db)?;
    Ok(db)
}

// Create an empty folder in the vault, then rescan. Rejects `..` traversal and
// any path that would escape the vault root.
pub fn create_folder(root: &Path, rel_path: &str) -> Result<Db, String> {
    let rel = rel_path.trim_matches('/');
    if rel.is_empty() {
        return Err("empty path".to_string());
    }
    if Path::new(rel)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("invalid path".to_string());
    }
    let target = root.join(rel);
    if !target.starts_with(root) {
        return Err("invalid path".to_string());
    }
    if target.exists() {
        return Err(format!("already exists: {rel}"));
    }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    scan(root)
}

// Create a brand-new markdown file in the vault, then rescan to index it.
pub fn create_doc(root: &Path, rel_path: &str, content: &str) -> Result<Db, String> {
    let target = root.join(rel_path);
    if target.exists() {
        return Err(format!("already exists: {rel_path}"));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, content).map_err(|e| e.to_string())?;
    scan(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let uniq = SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir()
            .join(format!("pirep-test-{}-{}-{uniq}", std::process::id(), now()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_then_external_change_bumps_version_keeps_unread() {
        let root = temp_vault();
        std::fs::write(root.join("note.md"), "# Note\nhello world").unwrap();

        // first scan: v1, read
        let db = scan(&root).unwrap();
        let d = &db.docs["note.md"];
        assert_eq!(d.current_version, 1);
        assert_eq!(d.last_read_version, 1);
        assert_eq!(d.title, "Note");

        // external edit + rescan: v2, still last-read v1 → unread
        std::fs::write(root.join("note.md"), "# Note\nhello rust").unwrap();
        let db = scan(&root).unwrap();
        let d = &db.docs["note.md"];
        assert_eq!(d.current_version, 2);
        assert_eq!(d.last_read_version, 1);
        assert!(d.current_version > d.last_read_version);

        // updates list sees it; mark_read clears it
        assert_eq!(list_updates(&root).len(), 1);
        mark_read(&root, "note.md").unwrap();
        assert_eq!(list_updates(&root).len(), 0);

        // diff v1→v2 carries the word change
        let r = diff(&root, "note.md", 1, 2).unwrap();
        assert!(r.ops.iter().any(|o| o.op == "del" && o.text.contains("world")));
        assert!(r.ops.iter().any(|o| o.op == "ins" && o.text.contains("rust")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_indexes_markdown_extension_as_a_document() {
        let root = temp_vault();
        std::fs::write(root.join("notes.markdown"), "# Notes\nbody").unwrap();
        let db = scan(&root).unwrap();
        assert!(db.docs.contains_key("notes.markdown"));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn mark_read_many_updates_current_versions_and_saves_once() {
        let root = temp_vault();
        std::fs::write(root.join("one.md"), "# One\nv1").unwrap();
        std::fs::write(root.join("two.md"), "# Two\nv1").unwrap();
        scan(&root).unwrap();

        std::fs::write(root.join("one.md"), "# One\nv2").unwrap();
        std::fs::write(root.join("two.md"), "# Two\nv2").unwrap();
        scan(&root).unwrap();

        let mut saves = 0;
        let db = mark_read_many_with(&root, &["one.md".into(), "two.md".into()], |root, db| {
            saves += 1;
            db::save(root, db)
        })
        .unwrap();

        assert_eq!(saves, 1);
        for id in ["one.md", "two.md"] {
            let doc = &db.docs[id];
            assert_eq!(doc.last_read_version, doc.current_version);
            assert_eq!(doc.last_decided_version, doc.current_version);
        }
        let saved = db::load(&root);
        assert_eq!(saved.docs["one.md"].last_read_version, 2);
        assert_eq!(saved.docs["two.md"].last_read_version, 2);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn in_app_save_makes_no_version_and_rebaselines_diff() {
        let root = temp_vault();
        std::fs::write(root.join("note.md"), "# Note\nhello world").unwrap();
        let db = scan(&root).unwrap();
        assert_eq!(db.docs["note.md"].current_version, 1);

        // in-app edit: no version bump, no change record, hash synced
        let db = write_doc(&root, "note.md", "# Note\nhello there", "in-app").unwrap();
        let d = &db.docs["note.md"];
        assert_eq!(d.current_version, 1, "in-app must not bump version");
        assert_eq!(d.hash, hash::sha256_hex("# Note\nhello there"));
        assert!(list_changes(&root, "note.md").is_empty(), "no change record");
        assert_eq!(list_updates(&root).len(), 0, "not shown as an update");

        // external edit now diffs against the user's in-app content ("there"),
        // proving the baseline snapshot was rebased (not the stale "world").
        std::fs::write(root.join("note.md"), "# Note\nhello everyone").unwrap();
        scan(&root).unwrap();
        let r = diff(&root, "note.md", 1, 2).unwrap();
        assert!(r.ops.iter().any(|o| o.op == "del" && o.text.contains("there")));
        assert!(r.ops.iter().any(|o| o.op == "ins" && o.text.contains("everyone")));
        assert!(!r.ops.iter().any(|o| o.op == "del" && o.text.contains("world")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn in_app_save_over_undecided_external_change_still_versions() {
        let root = temp_vault();
        std::fs::write(root.join("note.md"), "# Note\nv1").unwrap();
        scan(&root).unwrap();

        // external edit → v2, undecided (ldv=1 < cv=2)
        std::fs::write(root.join("note.md"), "# Note\nv2").unwrap();
        let db = scan(&root).unwrap();
        let d = &db.docs["note.md"];
        assert_eq!(d.current_version, 2);
        assert!(d.last_decided_version < d.current_version);

        // in-app edit on top must NOT clobber the undecided version → bumps to v3
        let db = write_doc(&root, "note.md", "# Note\nv3", "in-app").unwrap();
        assert_eq!(db.docs["note.md"].current_version, 3);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_folder_makes_dir_and_blocks_traversal() {
        let root = temp_vault();
        create_folder(&root, "a/b").unwrap();
        assert!(root.join("a/b").is_dir());
        // duplicate rejected
        assert!(create_folder(&root, "a/b").is_err());
        // traversal / empty rejected, nothing escapes root
        assert!(create_folder(&root, "../evil").is_err());
        assert!(create_folder(&root, "").is_err());
        assert!(!root.parent().unwrap().join("evil").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rename_doc_recovers_when_db_entry_is_stale() {
        let root = temp_vault();
        let old_path = "briefing/2026/2026-09-16.md";
        std::fs::create_dir_all(root.join("briefing/2026")).unwrap();
        std::fs::write(root.join(old_path), "# Briefing").unwrap();
        db::save(&root, &Db::default()).unwrap();

        let renamed = rename_doc(&root, old_path, "briefing/2026/renamed.md").unwrap();

        assert!(!root.join(old_path).exists());
        assert!(root.join("briefing/2026/renamed.md").is_file());
        assert!(renamed.docs.contains_key("briefing/2026/renamed.md"));
        let error = rename_doc(&root, "missing.md", "renamed-missing.md")
            .err()
            .unwrap();
        assert_eq!(
            error,
            "파일을 찾을 수 없습니다: missing.md. Base를 다시 스캔한 뒤 재시도하세요."
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
