// Local git helpers. Commands run as `git -C <root> ...` with no shell and
// never touch the network (no fetch/pull/push here).
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChangedFile {
    pub code: String,
    pub path: String,
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("git spawn failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("git {} failed: {err}", args.join(" ")));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Reject absolute paths and `..` escapes before they reach git. (Git would
/// constrain `HEAD:path` lookups to the repo anyway; this fails fast.)
fn assert_repo_path(file: &str) -> Result<(), String> {
    if file.is_empty() || file.starts_with('/') || file.split('/').any(|s| s == "..") {
        return Err(format!(
            "rejected repo path: {}",
            file.chars().take(80).collect::<String>()
        ));
    }
    Ok(())
}

pub fn is_repo(root: &str) -> bool {
    matches!(
        run_git(root, &["rev-parse", "--is-inside-work-tree"]),
        Ok(out) if out.trim() == "true"
    )
}

pub fn status(root: &str) -> Result<Vec<ChangedFile>, String> {
    // Porcelain v2 gives stable machine-readable paths.
    let out = run_git(root, &["status", "--porcelain=v2", "--untracked-files=normal"])?;
    let mut files = Vec::new();
    for line in out.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let kind = line.as_bytes().first().copied().unwrap_or(b' ');
        if kind == b'1' || kind == b'2' {
            // "1 <xy> <subm> <mH> <mI> <mW> <hH> <hI> <path>"
            let parts: Vec<&str> = line.split(' ').collect();
            let (code, path) = if kind == b'1' {
                (parts.get(1), parts.get(8..).map(|p| p.join(" ")))
            } else {
                (parts.get(1), parts.get(9..).map(|p| p.join(" ")))
            };
            if let (Some(code), Some(path)) = (code, path) {
                files.push(ChangedFile {
                    code: code.to_string(),
                    path,
                });
            }
        } else if kind == b'?' {
            files.push(ChangedFile {
                code: "??".into(),
                path: line[2..].to_string(),
            });
        }
    }
    Ok(files)
}

// Kept (tested) for a future "last commit" header; not yet exposed via IPC.
#[allow(dead_code)]
pub fn diff(root: &str, file: &str) -> Result<String, String> {
    assert_repo_path(file)?;
    // Worktree diff for one path against HEAD.
    Ok(run_git(root, &["diff", "HEAD", "--", file]).unwrap_or_default())
}

pub fn show_head(root: &str, file: &str) -> Result<String, String> {
    assert_repo_path(file)?;
    // Original content of a path at HEAD; empty string when the file is new.
    let spec = format!("HEAD:{file}");
    Ok(run_git(root, &["show", &spec]).unwrap_or_default())
}

// Kept (tested) for a future "last commit" header; not yet exposed via IPC.
#[allow(dead_code)]
pub fn log(root: &str, n: usize) -> Result<Vec<String>, String> {
    let count = format!("--max-count={n}");
    let out = run_git(root, &["log", &count, "--format=%h %s"])?;
    let trimmed = out.trim();
    Ok(if trimmed.is_empty() {
        Vec::new()
    } else {
        trimmed.lines().map(|s| s.to_string()).collect()
    })
}

pub fn branch(root: &str) -> Result<String, String> {
    Ok(run_git(root, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sh(dir: &std::path::Path, args: &[&str]) {
        let st = Command::new("git").args(args).current_dir(dir).status().unwrap();
        assert!(st.success(), "git {args:?} failed");
    }

    fn fixture() -> std::path::PathBuf {
        let tag = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("me-git-test-{tag}"));
        fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "-q"]);
        sh(&dir, &["config", "user.email", "t@t.t"]);
        sh(&dir, &["config", "user.name", "t"]);
        sh(&dir, &["config", "commit.gpgsign", "false"]);
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-qm", "init"]);
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        dir
    }

    #[test]
    fn distinguishes_repos_from_plain_dirs() {
        let repo = fixture();
        let plain = std::env::temp_dir().join(format!(
            "me-plain-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&plain).unwrap();
        assert!(is_repo(&repo.to_string_lossy()));
        assert!(!is_repo(&plain.to_string_lossy()));
        fs::remove_dir_all(&repo).ok();
        fs::remove_dir_all(&plain).ok();
    }

    #[test]
    fn status_lists_modified_and_untracked() {
        let repo = fixture();
        let root = repo.to_string_lossy().into_owned();
        let files = status(&root).unwrap();
        let has_a = files.iter().any(|f| f.path == "a.txt");
        let new_txt = files.iter().find(|f| f.path == "new.txt");
        assert!(has_a, "modified file listed");
        assert_eq!(new_txt.map(|f| f.code.as_str()), Some("??"));
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn show_head_returns_head_or_empty() {
        let repo = fixture();
        let root = repo.to_string_lossy().into_owned();
        assert_eq!(show_head(&root, "a.txt").unwrap(), "one\n");
        assert_eq!(show_head(&root, "new.txt").unwrap(), "");
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn diff_returns_unified_diff() {
        let repo = fixture();
        let root = repo.to_string_lossy().into_owned();
        let d = diff(&root, "a.txt").unwrap();
        assert!(d.lines().any(|l| l == "+two"), "diff contains +two");
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn branch_and_log_work() {
        let repo = fixture();
        let root = repo.to_string_lossy().into_owned();
        assert!(!branch(&root).unwrap().is_empty());
        let entries = log(&root, 5).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].contains("init"));
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn rejects_escaping_paths() {
        let repo = fixture();
        let root = repo.to_string_lossy().into_owned();
        assert!(diff(&root, "../a.txt").is_err());
        assert!(show_head(&root, "/etc/hostname").is_err());
        fs::remove_dir_all(&repo).ok();
    }
}
