use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

struct AuthorizedWorktreeListEntry {
    path: String,
    prunable: bool,
}

pub(super) fn list_authorized_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("failed to enumerate authorized worktrees: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.trim();
        return Err(if reason.is_empty() {
            "failed to enumerate authorized worktrees".to_string()
        } else {
            format!("failed to enumerate authorized worktrees: {reason}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed_entries = parse_authorized_worktree_entries(stdout.as_ref());
    let mut worktrees = Vec::new();
    for entry in parsed_entries {
        if entry.prunable {
            continue;
        }

        let canonicalized = fs::canonicalize(entry.path.as_str()).map_err(|e| {
            format!(
                "failed to canonicalize authorized worktree path {}: {e}",
                entry.path
            )
        })?;
        worktrees.push(canonicalized);
    }
    Ok(worktrees)
}

fn parse_authorized_worktree_entries(stdout: &str) -> Vec<AuthorizedWorktreeListEntry> {
    let mut entries = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_prunable = false;

    let flush_current = |entries: &mut Vec<AuthorizedWorktreeListEntry>,
                         current_path: &mut Option<String>,
                         current_prunable: &mut bool| {
        if let Some(path) = current_path.take() {
            entries.push(AuthorizedWorktreeListEntry {
                path,
                prunable: *current_prunable,
            });
        }
        *current_prunable = false;
    };

    for line in stdout.lines() {
        if line.is_empty() {
            flush_current(&mut entries, &mut current_path, &mut current_prunable);
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            flush_current(&mut entries, &mut current_path, &mut current_prunable);
            current_path = Some(path.to_string());
            continue;
        }

        if line.starts_with("prunable") {
            current_prunable = true;
        }
    }

    flush_current(&mut entries, &mut current_path, &mut current_prunable);
    entries
}
