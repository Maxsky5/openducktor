use crate::parse_user_path;
use host_domain::{DirectoryEntry, DirectoryListing};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum FilesystemListDirectoryError {
    #[error("Unable to resolve the user home directory.")]
    HomeDirectoryUnavailable,
    #[error("{message}")]
    InvalidPath { message: String },
    #[error("Directory does not exist: {path}")]
    DirectoryDoesNotExist { path: String },
    #[error("Path is not a directory: {path}")]
    PathIsNotDirectory { path: String },
    #[error("Failed to read directory '{path}': {source}")]
    ReadFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

pub fn list_directory(
    path: Option<&str>,
) -> Result<DirectoryListing, FilesystemListDirectoryError> {
    let requested_path = resolve_requested_path(path)?;
    let current_path = canonicalize_directory(&requested_path)?;
    let current_path_display = path_display(&current_path);
    let entries = read_directory_entries(&current_path, &current_path_display)?;

    Ok(DirectoryListing {
        current_path: current_path_display,
        parent_path: current_path.parent().map(|path| path_display(path)),
        home_path: resolve_home_path().map(|path| path_display(&path)),
        entries,
    })
}

fn resolve_requested_path(path: Option<&str>) -> Result<PathBuf, FilesystemListDirectoryError> {
    match path {
        Some(raw_path) => {
            parse_user_path(raw_path).map_err(|error| FilesystemListDirectoryError::InvalidPath {
                message: error.to_string(),
            })
        }
        None => dirs::home_dir().ok_or(FilesystemListDirectoryError::HomeDirectoryUnavailable),
    }
}

fn canonicalize_directory(path: &Path) -> Result<PathBuf, FilesystemListDirectoryError> {
    let path_label = path_display(path);
    let canonical_path = fs::canonicalize(path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => FilesystemListDirectoryError::DirectoryDoesNotExist {
            path: path_label.clone(),
        },
        _ => FilesystemListDirectoryError::ReadFailed {
            path: path_label.clone(),
            source: error,
        },
    })?;

    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        FilesystemListDirectoryError::ReadFailed {
            path: path_display(&canonical_path),
            source: error,
        }
    })?;
    if !metadata.is_dir() {
        return Err(FilesystemListDirectoryError::PathIsNotDirectory {
            path: path_display(&canonical_path),
        });
    }

    Ok(canonical_path)
}

fn read_directory_entries(
    current_path: &Path,
    current_path_display: &str,
) -> Result<Vec<DirectoryEntry>, FilesystemListDirectoryError> {
    let mut entries = Vec::new();
    let directory_entries =
        fs::read_dir(current_path).map_err(|error| FilesystemListDirectoryError::ReadFailed {
            path: current_path_display.to_string(),
            source: error,
        })?;

    for entry in directory_entries {
        let entry = entry.map_err(|error| FilesystemListDirectoryError::ReadFailed {
            path: current_path_display.to_string(),
            source: error,
        })?;

        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let file_type =
            entry
                .file_type()
                .map_err(|error| FilesystemListDirectoryError::ReadFailed {
                    path: current_path_display.to_string(),
                    source: error,
                })?;
        if !file_type.is_dir() {
            continue;
        }

        let entry_path = entry.path();
        entries.push(DirectoryEntry {
            name,
            path: path_display(&entry_path),
            is_directory: true,
            is_git_repo: entry_path.join(".git").exists(),
        });
    }

    entries.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(entries)
}

fn resolve_home_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(fs::canonicalize(&home).unwrap_or(home))
}

fn path_display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{list_directory, FilesystemListDirectoryError};
    use host_test_support::{lock_env, EnvVarGuard};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDirFixture {
        path: PathBuf,
    }

    impl TempDirFixture {
        fn new(prefix: &str) -> Self {
            let unique_suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after UNIX_EPOCH")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "openducktor-filesystem-tests-{prefix}-{unique_suffix}"
            ));
            fs::create_dir_all(&path).expect("fixture directory should be created");
            Self { path }
        }
    }

    impl Drop for TempDirFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn list_directory_uses_home_when_path_is_omitted() {
        let _env_lock = lock_env();
        let home = TempDirFixture::new("home");
        let _home_guard = EnvVarGuard::set("HOME", home.path.to_string_lossy().as_ref());
        let canonical_home = fs::canonicalize(&home.path).expect("home path should canonicalize");

        let listing = list_directory(None).expect("home directory should list");

        assert_eq!(listing.current_path, canonical_home.to_string_lossy());
        assert_eq!(
            listing.home_path.as_deref(),
            Some(canonical_home.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn list_directory_hides_hidden_entries_marks_git_repos_and_sorts_results() {
        let root = TempDirFixture::new("visible");
        fs::create_dir(root.path.join("zeta")).expect("zeta directory should exist");
        fs::create_dir(root.path.join("Alpha")).expect("alpha directory should exist");
        fs::create_dir(root.path.join("repo-a")).expect("repo-a directory should exist");
        fs::create_dir(root.path.join("repo-a").join(".git")).expect("repo-a git dir should exist");
        fs::create_dir(root.path.join(".hidden-repo")).expect("hidden directory should exist");
        fs::write(root.path.join("notes.txt"), "not a directory")
            .expect("fixture file should exist");

        let listing = list_directory(Some(root.path.to_string_lossy().as_ref()))
            .expect("directory listing should succeed");

        assert_eq!(
            listing
                .entries
                .iter()
                .map(|entry| (entry.name.as_str(), entry.is_git_repo))
                .collect::<Vec<_>>(),
            vec![("Alpha", false), ("repo-a", true), ("zeta", false)]
        );
    }

    #[test]
    fn list_directory_expands_tilde_paths() {
        let _env_lock = lock_env();
        let home = TempDirFixture::new("tilde-home");
        let _home_guard = EnvVarGuard::set("HOME", home.path.to_string_lossy().as_ref());
        let projects_path = home.path.join("projects");
        fs::create_dir(&projects_path).expect("projects directory should exist");
        let canonical_projects_path =
            fs::canonicalize(&projects_path).expect("projects path should canonicalize");

        let listing = list_directory(Some("~/projects")).expect("tilde path should resolve");

        assert_eq!(
            listing.current_path,
            canonical_projects_path.to_string_lossy()
        );
    }

    #[test]
    fn list_directory_returns_not_found_for_missing_paths() {
        let root = TempDirFixture::new("missing");
        let missing_path = root.path.join("does-not-exist");

        let error = list_directory(Some(missing_path.to_string_lossy().as_ref()))
            .expect_err("missing path should fail");

        assert!(matches!(
            error,
            FilesystemListDirectoryError::DirectoryDoesNotExist { .. }
        ));
        assert_eq!(
            error.to_string(),
            format!(
                "Directory does not exist: {}",
                missing_path.to_string_lossy()
            )
        );
    }

    #[test]
    fn list_directory_rejects_file_paths() {
        let root = TempDirFixture::new("file");
        let file_path = root.path.join("plain.txt");
        fs::write(&file_path, "hello").expect("fixture file should exist");
        let canonical_file_path =
            fs::canonicalize(&file_path).expect("file path should canonicalize");

        let error = list_directory(Some(file_path.to_string_lossy().as_ref()))
            .expect_err("file path should fail");

        assert!(matches!(
            error,
            FilesystemListDirectoryError::PathIsNotDirectory { .. }
        ));
        assert_eq!(
            error.to_string(),
            format!(
                "Path is not a directory: {}",
                canonical_file_path.to_string_lossy()
            )
        );
    }
}
