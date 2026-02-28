use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"))?;
    let repo_id = compute_repo_id(repo_path)?;
    let repo_root = home.join(".openducktor").join("beads").join(repo_id);
    fs::create_dir_all(&repo_root).with_context(|| {
        format!(
            "Failed to create centralized Beads directory {}",
            repo_root.display()
        )
    })?;
    Ok(repo_root.join(".beads"))
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
    use super::{compute_repo_id, compute_repo_slug, resolve_central_beads_dir};
    use std::path::Path;

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
        let resolved =
            resolve_central_beads_dir(Path::new("/tmp/openducktor-test/repo")).expect("beads dir");
        let as_string = resolved.to_string_lossy();
        assert!(as_string.contains(".openducktor/beads/"));
        assert!(as_string.ends_with("/.beads"));
    }
}
