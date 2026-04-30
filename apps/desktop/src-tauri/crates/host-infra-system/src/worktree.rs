use anyhow::{anyhow, Context, Result};
use host_domain::DEFAULT_BRANCH_PREFIX;
use std::fs;
use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
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

pub fn remove_worktree_path_if_present(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Failed reading file metadata for {}", path.display()));
        }
    };
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .with_context(|| format!("Failed removing directory {}", path.display()))?;
    } else {
        fs::remove_file(path)
            .with_context(|| format!("Failed removing file {}", path.display()))?;
    }

    Ok(())
}

fn resolve_worktree_cleanup_path(repo_path: &Path, worktree_path: &Path) -> PathBuf {
    if worktree_path.is_absolute() {
        return worktree_path.to_path_buf();
    }

    repo_path.join(worktree_path)
}

pub fn copy_configured_worktree_files(
    repo_path: &Path,
    worktree_path: &Path,
    configured_files: &[String],
) -> Result<()> {
    let repo_root = repo_path
        .canonicalize()
        .with_context(|| format!("Failed resolving repository path: {}", repo_path.display()))?;
    let worktree_root = worktree_path.canonicalize().with_context(|| {
        format!(
            "Failed resolving worktree path before copying configured files: {}",
            worktree_path.display()
        )
    })?;

    for configured_copy in configured_files {
        let relative_path = Path::new(configured_copy);
        validate_worktree_copy_path(relative_path, configured_copy)?;
        reject_symlinked_components(repo_path, relative_path, configured_copy, "source")?;

        let source_path = repo_path.join(relative_path);
        let canonical_source = source_path.canonicalize().with_context(|| {
            format!(
                "Configured worktree copy source is unavailable: {}",
                source_path.display()
            )
        })?;
        ensure_path_within_root(&repo_root, &canonical_source, configured_copy, "source")?;
        let source_metadata = fs::metadata(&source_path).with_context(|| {
            format!(
                "Configured worktree copy source is unavailable: {}",
                source_path.display()
            )
        })?;

        let destination_path = worktree_path.join(relative_path);
        if source_metadata.is_dir() {
            copy_worktree_directory_recursive(
                worktree_path,
                &worktree_root,
                relative_path,
                source_path.as_path(),
                destination_path.as_path(),
                &source_metadata,
                configured_copy,
            )?;
        } else if source_metadata.is_file() {
            copy_worktree_file(
                worktree_path,
                &worktree_root,
                relative_path,
                source_path.as_path(),
                destination_path.as_path(),
                configured_copy,
            )?;
        } else {
            return Err(anyhow!(
                "Configured worktree copy source is not a file or directory: {}",
                source_path.display()
            ));
        }
    }

    Ok(())
}

fn copy_worktree_file(
    worktree_path: &Path,
    worktree_root: &Path,
    relative_path: &Path,
    source_path: &Path,
    destination_path: &Path,
    original: &str,
) -> Result<()> {
    reject_symlinked_components(worktree_path, relative_path, original, "destination")?;
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating configured worktree copy directory: {}",
                parent.display()
            )
        })?;
        let canonical_parent = parent.canonicalize().with_context(|| {
            format!(
                "Failed resolving configured worktree copy directory: {}",
                parent.display()
            )
        })?;
        ensure_path_within_root(worktree_root, &canonical_parent, original, "destination")?;
    }

    fs::copy(source_path, destination_path).with_context(|| {
        format!(
            "Failed copying configured worktree path {} to {}",
            source_path.display(),
            destination_path.display()
        )
    })?;

    Ok(())
}

fn copy_worktree_directory_recursive(
    worktree_path: &Path,
    worktree_root: &Path,
    relative_path: &Path,
    source_path: &Path,
    destination_path: &Path,
    source_metadata: &fs::Metadata,
    original: &str,
) -> Result<()> {
    reject_symlinked_components(worktree_path, relative_path, original, "destination")?;
    fs::create_dir_all(destination_path).with_context(|| {
        format!(
            "Failed creating configured worktree copy directory: {}",
            destination_path.display()
        )
    })?;
    let canonical_destination = destination_path.canonicalize().with_context(|| {
        format!(
            "Failed resolving configured worktree copy directory: {}",
            destination_path.display()
        )
    })?;
    ensure_path_within_root(
        worktree_root,
        &canonical_destination,
        original,
        "destination",
    )?;

    for entry_result in fs::read_dir(source_path).with_context(|| {
        format!(
            "Failed reading configured worktree copy directory: {}",
            source_path.display()
        )
    })? {
        let entry = entry_result.with_context(|| {
            format!(
                "Failed reading configured worktree copy directory entry in {}",
                source_path.display()
            )
        })?;
        let entry_source = entry.path();
        let entry_relative = relative_path.join(entry.file_name());
        let entry_destination = worktree_path.join(&entry_relative);
        let entry_metadata = fs::symlink_metadata(&entry_source).with_context(|| {
            format!(
                "Failed inspecting configured worktree copy source: {}",
                entry_source.display()
            )
        })?;

        if entry_metadata.file_type().is_symlink() {
            return Err(anyhow!(
                "Configured worktree copy source cannot include symlink: {}",
                entry_source.display()
            ));
        }

        if entry_metadata.is_dir() {
            copy_worktree_directory_recursive(
                worktree_path,
                worktree_root,
                &entry_relative,
                entry_source.as_path(),
                entry_destination.as_path(),
                &entry_metadata,
                original,
            )?;
        } else if entry_metadata.is_file() {
            copy_worktree_file(
                worktree_path,
                worktree_root,
                &entry_relative,
                entry_source.as_path(),
                entry_destination.as_path(),
                original,
            )?;
        } else {
            return Err(anyhow!(
                "Configured worktree copy source is not a file or directory: {}",
                entry_source.display()
            ));
        }
    }

    fs::set_permissions(destination_path, source_metadata.permissions()).with_context(|| {
        format!(
            "Failed setting configured worktree copy directory permissions: {}",
            destination_path.display()
        )
    })?;

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

fn reject_symlinked_components(
    root_path: &Path,
    relative_path: &Path,
    original: &str,
    path_role: &str,
) -> Result<()> {
    let mut current = root_path.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(segment) = component else {
            continue;
        };
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(anyhow!(
                        "Configured worktree copy {path_role} cannot use symlinked path components: {original}"
                    ));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "Failed inspecting configured worktree copy {path_role} path: {}",
                        current.display()
                    )
                });
            }
        }
    }

    Ok(())
}

fn ensure_path_within_root(
    root_path: &Path,
    candidate_path: &Path,
    original: &str,
    path_role: &str,
) -> Result<()> {
    if candidate_path.starts_with(root_path) {
        return Ok(());
    }

    Err(anyhow!(
        "Configured worktree copy {path_role} escapes its root via symlinked path components: {original}"
    ))
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

    let cleanup_path = resolve_worktree_cleanup_path(repo_path, worktree_path);
    remove_worktree_path_if_present(cleanup_path.as_path()).with_context(|| {
        format!(
            "git worktree removal left filesystem path cleanup incomplete for {}",
            cleanup_path.display()
        )
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_branch_name, copy_configured_worktree_files, pick_free_port, remove_worktree,
        remove_worktree_path_if_present, slugify_title,
    };
    use host_domain::DEFAULT_BRANCH_PREFIX;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
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
    fn pick_free_port_returns_nonzero_port() {
        let port = pick_free_port().expect("free port should resolve");
        assert!(port > 0, "picked port should be nonzero");
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
    fn copy_configured_worktree_files_copies_directory_recursively() {
        let root = unique_temp_path("copy-configured-directory");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(repo.join(".vscode").join("profiles"))
            .expect("repo config directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::write(
            repo.join(".vscode").join("settings.json"),
            "{\"editor.tabSize\":2}\n",
        )
        .expect("settings file should write");
        fs::write(
            repo.join(".vscode").join("profiles").join("local.json"),
            "{\"name\":\"local\"}\n",
        )
        .expect("nested settings file should write");
        fs::write(repo.join(".vscode").join(".hidden"), "hidden\n")
            .expect("hidden nested file should write");

        copy_configured_worktree_files(&repo, &worktree, &[".vscode".to_string()])
            .expect("configured directory should copy");

        assert_eq!(
            fs::read_to_string(worktree.join(".vscode").join("settings.json"))
                .expect("copied settings file should exist"),
            "{\"editor.tabSize\":2}\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.join(".vscode").join("profiles").join("local.json"))
                .expect("copied nested settings file should exist"),
            "{\"name\":\"local\"}\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.join(".vscode").join(".hidden"))
                .expect("copied hidden nested file should exist"),
            "hidden\n"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_configured_worktree_files_copies_empty_directory() {
        let root = unique_temp_path("copy-configured-empty-directory");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(repo.join("scripts").join("local"))
            .expect("repo empty directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");

        copy_configured_worktree_files(&repo, &worktree, &["scripts/local".to_string()])
            .expect("configured empty directory should copy");

        let copied_directory = worktree.join("scripts").join("local");
        assert!(
            copied_directory.is_dir(),
            "copied empty directory should exist"
        );
        assert_eq!(
            fs::read_dir(copied_directory)
                .expect("copied empty directory should be readable")
                .count(),
            0
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn copy_configured_worktree_files_rejects_symlink_inside_directory() {
        let root = unique_temp_path("copy-configured-directory-symlink");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        let outside = root.join("outside");
        fs::create_dir_all(repo.join(".vscode")).expect("repo config directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::create_dir_all(&outside).expect("outside directory should exist");
        fs::write(repo.join(".vscode").join("settings.json"), "{}\n")
            .expect("repo file should write");
        symlink(
            outside.join("secret.env"),
            repo.join(".vscode").join("bad-link"),
        )
        .expect("nested symlink should exist");

        let error = copy_configured_worktree_files(&repo, &worktree, &[".vscode".to_string()])
            .expect_err("nested symlink should be rejected");
        let message = error.to_string();
        assert!(
            message.contains("source cannot include symlink"),
            "unexpected copy error: {error}"
        );
        assert!(
            message.contains("bad-link"),
            "symlink error should name the offending path: {error}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_configured_worktree_files_handles_mixed_files_and_directories() {
        let root = unique_temp_path("copy-configured-mixed");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(repo.join("scripts").join("local"))
            .expect("repo scripts directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::write(repo.join(".env"), "TOKEN=secret\n").expect("env file should write");
        fs::write(
            repo.join("scripts").join("local").join("bootstrap.sh"),
            "#!/bin/sh\n",
        )
        .expect("script file should write");

        copy_configured_worktree_files(
            &repo,
            &worktree,
            &[".env".to_string(), "scripts".to_string()],
        )
        .expect("configured file and directory should copy");

        assert_eq!(
            fs::read_to_string(worktree.join(".env")).expect("copied env file should exist"),
            "TOKEN=secret\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.join("scripts").join("local").join("bootstrap.sh"))
                .expect("copied script file should exist"),
            "#!/bin/sh\n"
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

    #[cfg(unix)]
    #[test]
    fn copy_configured_worktree_files_rejects_symlinked_source_components() {
        let root = unique_temp_path("copy-configured-source-symlink");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        let outside = root.join("outside");
        fs::create_dir_all(&repo).expect("repo directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::create_dir_all(&outside).expect("outside directory should exist");
        fs::write(outside.join("secret.env"), "TOKEN=secret\n").expect("outside file should write");
        symlink(&outside, repo.join("config")).expect("repo config symlink should exist");

        let error =
            copy_configured_worktree_files(&repo, &worktree, &["config/secret.env".to_string()])
                .expect_err("symlinked source component should be rejected");
        assert!(
            error
                .to_string()
                .contains("source cannot use symlinked path components"),
            "unexpected copy error: {error}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn copy_configured_worktree_files_rejects_symlinked_destination_components() {
        let root = unique_temp_path("copy-configured-destination-symlink");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        let outside = root.join("outside");
        fs::create_dir_all(repo.join("config")).expect("repo config directory should exist");
        fs::create_dir_all(&worktree).expect("worktree directory should exist");
        fs::create_dir_all(&outside).expect("outside directory should exist");
        fs::write(repo.join("config").join("local.json"), "{}\n").expect("repo file should write");
        symlink(&outside, worktree.join("config")).expect("worktree config symlink should exist");

        let error =
            copy_configured_worktree_files(&repo, &worktree, &["config/local.json".to_string()])
                .expect_err("symlinked destination component should be rejected");
        assert!(
            error
                .to_string()
                .contains("destination cannot use symlinked path components"),
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

    #[test]
    fn remove_worktree_path_if_present_removes_leftover_directory() {
        let root = unique_temp_path("worktree-leftover-directory");
        let leftover = root.join("leftover");
        fs::create_dir_all(leftover.join("nested")).expect("leftover directory should exist");
        fs::write(leftover.join("nested").join("debug.log"), "log\n")
            .expect("leftover file should exist");

        remove_worktree_path_if_present(&leftover)
            .expect("leftover worktree directory should be removed");

        assert!(!leftover.exists(), "leftover directory should be removed");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn remove_worktree_path_if_present_removes_broken_symlink() {
        let root = unique_temp_path("worktree-broken-symlink");
        fs::create_dir_all(&root).expect("temp root should exist");
        let broken_link = root.join("broken-link");
        symlink(root.join("missing-target"), &broken_link).expect("broken symlink should exist");

        remove_worktree_path_if_present(&broken_link).expect("broken symlink should be removed");

        assert!(!broken_link.exists(), "broken symlink should be removed");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_worktree_resolves_relative_cleanup_path_against_repo() {
        if !git_available() {
            return;
        }

        let root = unique_temp_path("worktree-relative-cleanup");
        let repo = root.join("repo");
        init_repo(&repo);
        let status = Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                "feature/relative",
                "relative-worktree",
            ])
            .current_dir(&repo)
            .status()
            .expect("git worktree add should run");
        assert!(status.success(), "git worktree add should succeed");

        remove_worktree(&repo, Path::new("relative-worktree"))
            .expect("relative worktree removal should succeed");

        assert!(
            !repo.join("relative-worktree").exists(),
            "relative worktree directory should be removed"
        );
        let _ = fs::remove_dir_all(root);
    }
}
