use anyhow::{anyhow, Context, Result};
use host_domain::DEFAULT_BRANCH_PREFIX;
use std::fs;
use std::net::TcpListener;
use std::path::{Component, Path};
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
    let trimmed_prefix = prefix.trim().trim_end_matches('/');
    let clean_prefix = if trimmed_prefix.is_empty() {
        DEFAULT_BRANCH_PREFIX
    } else {
        trimmed_prefix
    };
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

pub fn copy_configured_worktree_files(
    repo_path: &Path,
    worktree_path: &Path,
    configured_files: &[String],
) -> Result<()> {
    for configured_file in configured_files {
        let relative_path = Path::new(configured_file);
        validate_worktree_copy_path(relative_path, configured_file)?;

        let source_path = repo_path.join(relative_path);
        let source_metadata = fs::metadata(&source_path).with_context(|| {
            format!(
                "Configured worktree copy source is unavailable: {}",
                source_path.display()
            )
        })?;
        if !source_metadata.is_file() {
            return Err(anyhow!(
                "Configured worktree copy source is not a file: {}",
                source_path.display()
            ));
        }

        let destination_path = worktree_path.join(relative_path);
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "Failed creating configured worktree copy directory: {}",
                    parent.display()
                )
            })?;
        }

        fs::copy(&source_path, &destination_path).with_context(|| {
            format!(
                "Failed copying configured worktree file {} to {}",
                source_path.display(),
                destination_path.display()
            )
        })?;
    }

    Ok(())
}

fn validate_worktree_copy_path(path: &Path, original: &str) -> Result<()> {
    if original.trim().is_empty() {
        return Err(anyhow!("Configured worktree copy path cannot be empty"));
    }
    if path.is_absolute() {
        return Err(anyhow!(
            "Configured worktree copy path must be relative: {original}"
        ));
    }

    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(anyhow!(
                    "Configured worktree copy path cannot traverse outside the repository: {original}"
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!(
                    "Configured worktree copy path must be relative: {original}"
                ));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }

    Ok(())
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
    use super::{
        build_branch_name, copy_configured_worktree_files, pick_free_port, remove_worktree,
        slugify_title,
    };
    use host_domain::DEFAULT_BRANCH_PREFIX;
    use std::fs;
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "openducktor-worktree-test-{label}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn run_git_ok(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git command should execute");
        assert!(
            output.status.success(),
            "git {} failed\nstdout: {}\nstderr: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).expect("repo directory should be created");
        run_git_ok(path, &["init"]);
        run_git_ok(path, &["config", "user.email", "tests@openducktor.local"]);
        run_git_ok(path, &["config", "user.name", "OpenDucktor Tests"]);
        fs::write(path.join("README.md"), "# worktree test\n").expect("seed file should write");
        run_git_ok(path, &["add", "README.md"]);
        run_git_ok(path, &["commit", "-m", "initial"]);
        run_git_ok(path, &["branch", "-M", "main"]);
    }

    #[test]
    fn slugify_title_normalizes_and_limits_length() {
        let slug = slugify_title("  Build API: v2 + queue processors now!  ");
        assert_eq!(slug, "build-api-v2-queue-processors-now");

        let long =
            slugify_title("a very long title that should be truncated to forty chars exactly");
        assert!(long.len() <= 40);
    }

    #[test]
    fn build_branch_name_applies_defaults() {
        let branch = build_branch_name("", "task-123", "Implement feature");
        assert!(branch.starts_with(&format!("{}/", DEFAULT_BRANCH_PREFIX)));
        assert!(branch.contains("task-123-implement-feature"));
    }

    #[test]
    fn build_branch_name_falls_back_when_slug_is_empty() {
        let branch = build_branch_name("custom", "task-9", "!!!");
        assert_eq!(branch, "custom/task-9");
    }

    #[test]
    fn build_branch_name_trims_prefix_and_drops_trailing_slashes() {
        let branch = build_branch_name(" feature/ ", "task-5", "Implement feature");
        assert_eq!(branch, "feature/task-5-implement-feature");
    }

    #[test]
    fn pick_free_port_returns_bindable_localhost_port() {
        let port = pick_free_port().expect("free port should resolve");
        let listener = TcpListener::bind(("127.0.0.1", port)).expect("port should be bindable");
        drop(listener);
    }

    #[test]
    fn copy_configured_worktree_files_copies_hidden_and_nested_files() {
        let root = unique_temp_path("copy-configured-files");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(repo.join("config")).expect("repo config directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::write(repo.join(".env"), "TOKEN=secret\n").expect("hidden file should write");
        fs::write(repo.join("config").join("local.json"), "{}\n")
            .expect("nested file should write");

        copy_configured_worktree_files(
            &repo,
            &worktree,
            &[".env".to_string(), "config/local.json".to_string()],
        )
        .expect("configured files should copy");

        assert_eq!(
            fs::read_to_string(worktree.join(".env")).expect("copied hidden file should exist"),
            "TOKEN=secret\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.join("config").join("local.json"))
                .expect("copied nested file should exist"),
            "{}\n"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_configured_worktree_files_rejects_parent_traversal() {
        let root = unique_temp_path("copy-configured-parent");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(&repo).expect("repo directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");

        let error = copy_configured_worktree_files(&repo, &worktree, &["../.env".to_string()])
            .expect_err("parent traversal should be rejected");
        assert!(
            error
                .to_string()
                .contains("cannot traverse outside the repository"),
            "unexpected copy error: {error}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_worktree_removes_existing_worktree_path() {
        if !git_available() {
            return;
        }

        let root = unique_temp_path("remove-success");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        init_repo(&repo);
        run_git_ok(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature/remove-success",
                worktree.to_string_lossy().as_ref(),
            ],
        );
        assert!(worktree.exists(), "worktree should exist before removal");

        remove_worktree(&repo, &worktree).expect("worktree removal should succeed");
        assert!(!worktree.exists(), "worktree should be removed");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_worktree_returns_error_when_git_removal_fails() {
        if !git_available() {
            return;
        }

        let root = unique_temp_path("remove-failure");
        let repo = root.join("repo");
        let missing_worktree = root.join("missing-worktree");
        init_repo(&repo);

        let error = remove_worktree(&repo, &missing_worktree).expect_err("removal should fail");
        assert!(
            error.to_string().contains("git worktree remove failed for"),
            "unexpected remove_worktree error: {error}"
        );
        let _ = fs::remove_dir_all(root);
    }
}
