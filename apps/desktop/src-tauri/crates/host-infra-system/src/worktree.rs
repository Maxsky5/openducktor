use anyhow::{anyhow, Result};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;

pub fn slugify_title(value: &str) -> String {
    let mut slug = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').chars().take(40).collect()
}

pub fn build_branch_name(prefix: &str, task_id: &str, title: &str) -> String {
    let clean_prefix = if prefix.is_empty() { "obp" } else { prefix };
    let slug = slugify_title(title);
    if slug.is_empty() {
        format!("{}/{}", clean_prefix, task_id)
    } else {
        format!("{}/{}-{}", clean_prefix, task_id, slug)
    }
}

pub fn pick_free_port() -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let status = Command::new("git")
        .arg("worktree")
        .arg("remove")
        .arg(worktree_path)
        .arg("--force")
        .current_dir(repo_path)
        .status()?;

    if !status.success() {
        return Err(anyhow!(
            "git worktree remove failed for {}",
            worktree_path.display()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_branch_name, slugify_title};

    #[test]
    fn slugify_title_normalizes_and_limits_length() {
        let slug = slugify_title("  Build API: v2 + queue processors now!  ");
        assert_eq!(slug, "build-api-v2-queue-processors-now");

        let long = slugify_title("a very long title that should be truncated to forty chars exactly");
        assert!(long.len() <= 40);
    }

    #[test]
    fn build_branch_name_applies_defaults() {
        let branch = build_branch_name("", "task-123", "Implement feature");
        assert!(branch.starts_with("obp/"));
        assert!(branch.contains("task-123-implement-feature"));
    }

    #[test]
    fn build_branch_name_falls_back_when_slug_is_empty() {
        let branch = build_branch_name("custom", "task-9", "!!!");
        assert_eq!(branch, "custom/task-9");
    }
}
