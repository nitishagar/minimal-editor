// Local filesystem helpers. No network. Every path operation is contained
// inside `root` (see resolve_in_root).
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const MAX_TREE_ENTRIES: usize = 8000;
pub const MAX_FILE_BYTES: u64 = 1024 * 1024; // 1 MiB preview cap
pub const MAX_RESULTS: usize = 200;

fn skip_dirs() -> HashSet<&'static str> {
    [
        ".git",
        "node_modules",
        "dist",
        "out",
        "build",
        "__pycache__",
        ".venv",
        "target",
        ".cache",
        ".idea",
        ".vscode",
    ]
    .into_iter()
    .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TreeNode {
    Dir {
        name: String,
        path: String,
        children: Vec<TreeNode>,
    },
    File {
        name: String,
        path: String,
        size: u64,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub content: Option<String>,
    pub truncated: bool,
    pub binary: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

/// Join `rel` onto `root`, rejecting absolute paths and any `..` escape.
/// Stricter than lexical containment: `..` components are refused outright.
pub fn resolve_in_root(root: &str, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("rejected path outside root: <empty>".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("rejected path outside root: {}", head(rel)));
    }
    for c in rel_path.components() {
        match c {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(format!("rejected path outside root: {}", head(rel)))
            }
            _ => {}
        }
    }
    Ok(Path::new(root).join(rel_path))
}

fn head(s: &str) -> String {
    s.chars().take(80).collect()
}

fn join_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

pub fn list_tree(root: &str) -> Result<Vec<TreeNode>, String> {
    let skip = skip_dirs();
    let mut budget = 0usize;
    list_tree_inner(Path::new(root), "", 0, &skip, &mut budget)
}

fn list_tree_inner(
    root: &Path,
    rel: &str,
    depth: u8,
    skip: &HashSet<&str>,
    budget: &mut usize,
) -> Result<Vec<TreeNode>, String> {
    let dir = root.join(rel);
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir failed: {e}"))?;
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    let mut out = Vec::new();
    for name in names {
        if *budget >= MAX_TREE_ENTRIES {
            break;
        }
        if skip.contains(name.as_str()) {
            continue;
        }
        let child_rel = join_rel(rel, &name);
        let full = root.join(&child_rel);
        let meta = fs::symlink_metadata(&full).map_err(|e| format!("stat failed: {e}"))?;
        *budget += 1;
        if meta.file_type().is_dir() && !meta.file_type().is_symlink() {
            let children = if depth < 12 {
                list_tree_inner(root, &child_rel, depth + 1, skip, budget)?
            } else {
                Vec::new()
            };
            out.push(TreeNode::Dir {
                name,
                path: child_rel,
                children,
            });
        } else if meta.file_type().is_file() {
            out.push(TreeNode::File {
                name,
                path: child_rel,
                size: meta.len(),
            });
        }
        // Symlinks are skipped: they can point outside root.
    }
    out.sort_by(|a, b| match (a, b) {
        (TreeNode::Dir { name: an, .. }, TreeNode::Dir { name: bn, .. })
        | (TreeNode::File { name: an, .. }, TreeNode::File { name: bn, .. }) => {
            an.to_lowercase().cmp(&bn.to_lowercase())
        }
        (TreeNode::Dir { .. }, _) => std::cmp::Ordering::Less,
        (_, TreeNode::Dir { .. }) => std::cmp::Ordering::Greater,
    });
    Ok(out)
}

pub fn read_file(root: &str, rel: &str) -> Result<ReadResult, String> {
    let full = resolve_in_root(root, rel)?;
    let meta = fs::symlink_metadata(&full).map_err(|e| format!("stat failed: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err("rejected path outside root: symlink".into());
    }
    let size = meta.len();
    if size > MAX_FILE_BYTES {
        return Ok(ReadResult {
            content: None,
            truncated: true,
            binary: false,
            size,
        });
    }
    let bytes = fs::read(&full).map_err(|e| format!("read failed: {e}"))?;
    if bytes.contains(&0) {
        return Ok(ReadResult {
            content: None,
            truncated: false,
            binary: true,
            size,
        });
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(ReadResult {
        content: Some(content),
        truncated: false,
        binary: false,
        size,
    })
}

pub fn write_file(root: &str, rel: &str, content: &str) -> Result<bool, String> {
    let full = resolve_in_root(root, rel)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    if full.is_symlink() {
        return Err("rejected path outside root: symlink".into());
    }
    fs::write(&full, content).map_err(|e| format!("write failed: {e}"))?;
    Ok(true)
}

const SEARCHABLE: &[&str] = &[
    "ts", "js", "tsx", "jsx", "mjs", "cjs", "py", "md", "markdown", "json", "txt", "css", "scss",
    "html", "htm", "c", "h", "cpp", "hpp", "rs", "go", "java", "kt", "sh", "bash", "yml", "yaml",
    "toml", "xml", "vue", "svelte", "sql",
];

fn searchable(name: &str) -> bool {
    match name.rsplit('.').next() {
        Some(ext) => SEARCHABLE.contains(&ext.to_lowercase().as_str()),
        None => false,
    }
}

pub fn search(root: &str, query: &str) -> Result<Vec<SearchHit>, String> {
    let mut results = Vec::new();
    if query.is_empty() {
        return Ok(results);
    }
    let skip = skip_dirs();
    search_inner(Path::new(root), "", &query.to_lowercase(), &skip, &mut results)?;
    Ok(results)
}

fn search_inner(
    root: &Path,
    rel: &str,
    q: &str,
    skip: &HashSet<&str>,
    results: &mut Vec<SearchHit>,
) -> Result<(), String> {
    if results.len() >= MAX_RESULTS {
        return Ok(());
    }
    let dir = root.join(rel);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    for name in names {
        if results.len() >= MAX_RESULTS {
            break;
        }
        let child_rel = join_rel(rel, &name);
        let full = root.join(&child_rel);
        let meta = match fs::symlink_metadata(&full) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.file_type().is_dir() {
            if skip.contains(name.as_str()) {
                continue;
            }
            search_inner(root, &child_rel, q, skip, results)?;
        } else {
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            if name.to_lowercase().contains(q) {
                results.push(SearchHit {
                    path: child_rel,
                    line: 0,
                    preview: name,
                });
                continue;
            }
            if !searchable(&name) {
                continue;
            }
            let bytes = match fs::read(&full) {
                Ok(b) => b,
                Err(_) => continue,
            };
            if bytes.contains(&0) {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes);
            for (i, line) in text.lines().enumerate() {
                if results.len() >= MAX_RESULTS {
                    break;
                }
                if line.to_lowercase().contains(q) {
                    let preview: String = line.trim().chars().take(160).collect();
                    results.push(SearchHit {
                        path: child_rel.clone(),
                        line: i + 1,
                        preview,
                    });
                    break; // one hit per file keeps results scannable
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let tag = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("me-fs-test-{tag}"));
        fs::create_dir_all(dir.join("src/sub")).unwrap();
        fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
        fs::write(dir.join("src/a.ts"), "export const x = 1;\n").unwrap();
        fs::write(dir.join("src/sub/b.py"), "print(\"needle-here\")\n").unwrap();
        fs::write(dir.join("README.md"), "# hello\n").unwrap();
        fs::write(dir.join("node_modules/dep/x.js"), "needle-here\n").unwrap();
        fs::write(dir.join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        dir
    }

    fn cleanup(dir: &Path) {
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn tree_skips_node_modules_and_sorts_dirs_first() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        let tree = list_tree(&root).unwrap();
        let names: Vec<String> = tree
            .iter()
            .map(|n| match n {
                TreeNode::Dir { name, .. } => name.clone(),
                TreeNode::File { name, .. } => name.clone(),
            })
            .collect();
        assert!(!names.contains(&"node_modules".to_string()));
        assert_eq!(names, vec!["src", "blob.bin", "README.md"]);
        match &tree[0] {
            TreeNode::Dir { children, .. } => {
                let kids: Vec<String> = children
                    .iter()
                    .map(|n| match n {
                        TreeNode::Dir { name, .. } => name.clone(),
                        TreeNode::File { name, .. } => name.clone(),
                    })
                    .collect();
                assert_eq!(kids, vec!["sub", "a.ts"]);
            }
            _ => panic!("src should be a dir"),
        }
        cleanup(&dir);
    }

    #[test]
    fn read_detects_binary_and_returns_text() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        let bin = read_file(&root, "blob.bin").unwrap();
        assert!(bin.binary);
        assert!(bin.content.is_none());
        let txt = read_file(&root, "src/a.ts").unwrap();
        assert_eq!(txt.content.as_deref(), Some("export const x = 1;\n"));
        cleanup(&dir);
    }

    #[test]
    fn write_round_trips() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        assert!(write_file(&root, "src/new.txt", "hi").unwrap());
        let back = read_file(&root, "src/new.txt").unwrap();
        assert_eq!(back.content.as_deref(), Some("hi"));
        cleanup(&dir);
    }

    #[test]
    fn search_finds_content_but_not_node_modules() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        let hits = search(&root, "needle-here").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "src/sub/b.py");
        assert_eq!(hits[0].line, 1);
        cleanup(&dir);
    }

    #[test]
    fn search_matches_filenames() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        let hits = search(&root, "README").unwrap();
        assert!(hits.iter().any(|h| h.path == "README.md"));
        cleanup(&dir);
    }

    #[test]
    fn resolve_rejects_escapes() {
        let dir = fixture();
        let root = dir.to_string_lossy().into_owned();
        assert!(read_file(&root, "../outside.txt").is_err());
        assert!(read_file(&root, "/etc/hostname").is_err());
        assert!(write_file(&root, "../../tmp/evil.txt", "x").is_err());
        assert!(write_file(&root, "", "x").is_err());
        // Symlink escapes are rejected too.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hostname", dir.join("link.txt")).unwrap();
            assert!(read_file(&root, "link.txt").is_err());
        }
        cleanup(&dir);
    }
}
