use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::resolve_openducktor_base_dir;

pub fn compute_repo_slug(repo_path: &Path) -> String {
    let candidate = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    sanitize_slug(candidate)
}

pub fn compute_repo_id(repo_path: &Path) -> Result<String> {
    let resolved = canonical_or_absolute(repo_path)?;
    let canonical_string = resolved.to_string_lossy().to_string();
    let slug = compute_repo_slug(&resolved);

    let mut hasher = Sha256::new();
    hasher.update(canonical_string.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let short_hash = &digest[..8];

    Ok(format!("{slug}-{short_hash}"))
}

pub fn resolve_central_beads_dir(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_repo_scoped_openducktor_dir(repo_path, "beads")?.join(".beads"))
}

pub fn resolve_default_worktree_base_dir(repo_path: &Path) -> Result<PathBuf> {
    resolve_repo_scoped_openducktor_dir(repo_path, "worktrees")
}

pub fn resolve_effective_worktree_base_dir(
    repo_path: &Path,
    configured_worktree_base_path: Option<&str>,
) -> Result<PathBuf> {
    match configured_worktree_base_path {
        Some(configured_path) => Ok(PathBuf::from(configured_path)),
        None => resolve_default_worktree_base_dir(repo_path),
    }
}

fn resolve_repo_scoped_openducktor_dir(repo_path: &Path, namespace: &str) -> Result<PathBuf> {
    let base_dir = resolve_openducktor_base_dir()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(base_dir.join(namespace).join(repo_id))
}

fn canonical_or_absolute(repo_path: &Path) -> Result<PathBuf> {
    let absolute = if repo_path.is_absolute() {
        repo_path.to_path_buf()
    } else {
        env::current_dir()
            .context("Unable to resolve current working directory")?
            .join(repo_path)
    };

    Ok(fs::canonicalize(&absolute).unwrap_or(absolute))
}

fn sanitize_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for char in input.chars() {
        let lower = char.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }

        if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    while slug.starts_with('-') {
        slug.remove(0);
    }
    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_repo_id, compute_repo_slug, resolve_central_beads_dir,
        resolve_default_worktree_base_dir, resolve_effective_worktree_base_dir,
    };
    use host_test_support::lock_env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn slug_sanitizes_to_ascii_and_collapses_separators() {
        let slug = compute_repo_slug(Path::new("/tmp/___My Repo___"));
        assert_eq!(slug, "my-repo");
    }

    #[test]
    fn slug_falls_back_to_repo_when_empty() {
        let slug = compute_repo_slug(Path::new("///"));
        assert_eq!(slug, "repo");
    }

    #[test]
    fn repo_id_is_stable_for_same_path() {
        let path = Path::new("/tmp/example-project");
        let first = compute_repo_id(path).expect("first id");
        let second = compute_repo_id(path).expect("second id");
        assert_eq!(first, second);
    }

    #[test]
    fn repo_id_differs_for_different_paths_with_same_basename() {
        let first = compute_repo_id(Path::new("/tmp/a/project")).expect("first id");
        let second = compute_repo_id(Path::new("/tmp/b/project")).expect("second id");
        assert_ne!(first, second);
    }

    #[test]
    fn central_beads_dir_uses_expected_layout_suffix() {
        let _env_lock = lock_env();
        let resolved =
            resolve_central_beads_dir(Path::new("/tmp/openducktor-test/repo")).expect("beads dir");
        let as_string = resolved.to_string_lossy();
        assert!(as_string.contains(".openducktor/beads/"));
        assert!(as_string.ends_with("/.beads"));
    }

    #[test]
    fn central_beads_dir_resolution_does_not_create_directories() {
        let _env_lock = lock_env();
        let home = dirs::home_dir().expect("home directory should resolve");

        for attempt in 0..64 {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should be after epoch")
                .as_nanos();
            let candidate = PathBuf::from(format!(
                "/tmp/odt-beads-no-side-effect-{nanos}-{attempt}/repo"
            ));
            let repo_id = compute_repo_id(&candidate).expect("repo id should resolve");
            let repo_root = home.join(".openducktor").join("beads").join(repo_id);
            if repo_root.exists() {
                continue;
            }

            let resolved =
                resolve_central_beads_dir(&candidate).expect("beads path should resolve");
            assert_eq!(resolved, repo_root.join(".beads"));
            assert!(
                !repo_root.exists(),
                "resolve_central_beads_dir should not create {}",
                repo_root.display()
            );
            return;
        }

        panic!("failed to generate unique beads directory candidate path");
    }

    #[test]
    fn default_worktree_base_dir_uses_expected_layout() {
        let _env_lock = lock_env();
        let resolved = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
            .expect("worktree base dir");
        let as_string = resolved.to_string_lossy();
        assert!(as_string.contains(".openducktor/worktrees/"));
        assert!(!as_string.ends_with("/.beads"));
    }

    #[test]
    fn effective_worktree_base_dir_prefers_configured_override() {
        let override_path = "/tmp/custom-worktrees";
        let resolved = resolve_effective_worktree_base_dir(
            Path::new("/tmp/openducktor-test/repo"),
            Some(override_path),
        )
        .expect("effective worktree base dir");
        assert_eq!(resolved, PathBuf::from(override_path));
    }

    #[test]
    fn effective_worktree_base_dir_uses_default_when_override_missing() {
        let _env_lock = lock_env();
        let resolved =
            resolve_effective_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"), None)
                .expect("effective worktree base dir");
        let expected = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
            .expect("default worktree base dir");
        assert_eq!(resolved, expected);
    }
}
