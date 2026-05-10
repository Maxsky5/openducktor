use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;

fn fnv1a_update_bytes(state: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *state ^= u64::from(*byte);
        *state = state.wrapping_mul(FNV1A_64_PRIME);
    }
}

fn fnv1a_update_u64(state: &mut u64, value: u64) {
    fnv1a_update_bytes(state, &value.to_le_bytes());
}

fn fnv1a_update_u128(state: &mut u64, value: u128) {
    fnv1a_update_bytes(state, &value.to_le_bytes());
}

fn fnv1a_update_str(state: &mut u64, value: &str) {
    fnv1a_update_u64(state, value.len() as u64);
    fnv1a_update_bytes(state, value.as_bytes());
}

fn read_worktree_entry_gitdir(
    worktree_entry_dir: &Path,
    entry_name: &str,
) -> Result<(u128, String), String> {
    let gitdir_path = worktree_entry_dir.join("gitdir");
    let gitdir_metadata = fs::metadata(&gitdir_path).map_err(|e| {
        format!(
            "failed to read gitdir metadata for worktree entry '{entry_name}' ({}): {e}",
            gitdir_path.display()
        )
    })?;
    if !gitdir_metadata.is_file() {
        return Err(format!(
            "worktree entry '{entry_name}' has invalid gitdir metadata path: {}",
            gitdir_path.display()
        ));
    }
    let gitdir_modified_nanos = system_time_to_nanos(
        gitdir_metadata.modified().map_err(|e| {
            format!(
                "failed to read gitdir modified time for worktree entry '{entry_name}' ({}): {e}",
                gitdir_path.display()
            )
        })?,
        "git worktree gitdir modified time",
    )?;
    let gitdir_raw = fs::read_to_string(&gitdir_path).map_err(|e| {
        format!(
            "failed to read gitdir file for worktree entry '{entry_name}' ({}): {e}",
            gitdir_path.display()
        )
    })?;
    let gitdir = gitdir_raw.trim_end_matches(['\r', '\n']).to_string();
    if gitdir.is_empty() {
        return Err(format!(
            "worktree entry '{entry_name}' has an empty gitdir path: {}",
            gitdir_path.display()
        ));
    }
    Ok((gitdir_modified_nanos, gitdir))
}

fn read_git_dir_from_dot_git_file(
    canonical_repo: &Path,
    dot_git_file: &Path,
) -> Result<PathBuf, String> {
    let contents = fs::read_to_string(dot_git_file).map_err(|e| {
        format!(
            "failed to read git metadata file {}: {e}",
            dot_git_file.display()
        )
    })?;
    let git_dir_raw = contents
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:").map(str::trim))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "failed to parse gitdir from metadata file {}",
                dot_git_file.display()
            )
        })?;

    let git_dir_path = PathBuf::from(git_dir_raw);
    let resolved_git_dir = if git_dir_path.is_absolute() {
        git_dir_path
    } else {
        canonical_repo.join(git_dir_path)
    };
    fs::canonicalize(&resolved_git_dir).map_err(|e| {
        format!(
            "failed to canonicalize gitdir path {}: {e}",
            resolved_git_dir.display()
        )
    })
}

pub(crate) fn read_git_common_dir(canonical_repo: &Path) -> Result<PathBuf, String> {
    let dot_git = canonical_repo.join(".git");
    let dot_git_metadata = fs::metadata(&dot_git).map_err(|e| {
        format!(
            "failed to access repository metadata {}: {e}",
            dot_git.display()
        )
    })?;

    if dot_git_metadata.is_dir() {
        return fs::canonicalize(&dot_git).map_err(|e| {
            format!(
                "failed to canonicalize repository git directory {}: {e}",
                dot_git.display()
            )
        });
    }

    if !dot_git_metadata.is_file() {
        return Err(format!(
            "repository metadata path is neither a directory nor file: {}",
            dot_git.display()
        ));
    }

    let git_dir = read_git_dir_from_dot_git_file(canonical_repo, dot_git.as_path())?;
    let common_dir_path = git_dir.join("commondir");
    if !common_dir_path.exists() {
        return Ok(git_dir);
    }
    if !common_dir_path.is_file() {
        return Err(format!(
            "git commondir metadata is not a file: {}",
            common_dir_path.display()
        ));
    }

    let common_dir_raw = fs::read_to_string(&common_dir_path).map_err(|e| {
        format!(
            "failed to read git commondir metadata {}: {e}",
            common_dir_path.display()
        )
    })?;
    let common_dir_value = common_dir_raw.trim();
    if common_dir_value.is_empty() {
        return Err(format!(
            "git commondir metadata is empty: {}",
            common_dir_path.display()
        ));
    }

    let common_dir = PathBuf::from(common_dir_value);
    let resolved_common_dir = if common_dir.is_absolute() {
        common_dir
    } else {
        git_dir.join(common_dir)
    };
    fs::canonicalize(&resolved_common_dir).map_err(|e| {
        format!(
            "failed to canonicalize git common directory {}: {e}",
            resolved_common_dir.display()
        )
    })
}

fn system_time_to_nanos(value: SystemTime, context: &str) -> Result<u128, String> {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|e| format!("{context} is before unix epoch: {e}"))
}

pub(crate) fn read_worktree_state_token(canonical_repo: &Path) -> Result<String, String> {
    let common_git_dir = read_git_common_dir(canonical_repo)?;
    let worktrees_dir = common_git_dir.join("worktrees");
    let mut hash_state = FNV1A_64_OFFSET_BASIS;
    fnv1a_update_str(&mut hash_state, common_git_dir.to_string_lossy().as_ref());

    if !worktrees_dir.exists() {
        fnv1a_update_str(&mut hash_state, "worktrees=none");
        return Ok(format!(
            "{}|{:016x}",
            common_git_dir.to_string_lossy(),
            hash_state
        ));
    }

    let worktrees_metadata = fs::metadata(&worktrees_dir).map_err(|e| {
        format!(
            "failed to read git worktrees metadata {}: {e}",
            worktrees_dir.display()
        )
    })?;
    if !worktrees_metadata.is_dir() {
        return Err(format!(
            "git worktrees path is not a directory: {}",
            worktrees_dir.display()
        ));
    }

    let modified_nanos = system_time_to_nanos(
        worktrees_metadata.modified().map_err(|e| {
            format!(
                "failed to read git worktrees modified time {}: {e}",
                worktrees_dir.display()
            )
        })?,
        "git worktrees modified time",
    )?;
    fnv1a_update_str(&mut hash_state, "worktrees=present");
    fnv1a_update_u128(&mut hash_state, modified_nanos);

    let mut entries = fs::read_dir(&worktrees_dir)
        .map_err(|e| {
            format!(
                "failed to read git worktrees directory {}: {e}",
                worktrees_dir.display()
            )
        })?
        .map(|entry_result| {
            entry_result
                .map(|entry| {
                    (
                        entry.file_name().to_string_lossy().to_string(),
                        entry.path(),
                    )
                })
                .map_err(|e| {
                    format!(
                        "failed to read entry from git worktrees directory {}: {e}",
                        worktrees_dir.display()
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    fnv1a_update_u64(&mut hash_state, entries.len() as u64);
    for (entry_name, entry_path) in entries {
        let entry_metadata = fs::metadata(&entry_path).map_err(|e| {
            format!(
                "failed to read metadata for worktree entry '{entry_name}' ({}): {e}",
                entry_path.display()
            )
        })?;
        if !entry_metadata.is_dir() {
            return Err(format!(
                "git worktree entry is not a directory: {}",
                entry_path.display()
            ));
        }
        let entry_modified_nanos = system_time_to_nanos(
            entry_metadata.modified().map_err(|e| {
                format!(
                    "failed to read modified time for worktree entry '{entry_name}' ({}): {e}",
                    entry_path.display()
                )
            })?,
            "git worktree entry modified time",
        )?;
        let (gitdir_modified_nanos, gitdir) =
            read_worktree_entry_gitdir(entry_path.as_path(), entry_name.as_str())?;

        fnv1a_update_str(&mut hash_state, entry_name.as_str());
        fnv1a_update_u128(&mut hash_state, entry_modified_nanos);
        fnv1a_update_u128(&mut hash_state, gitdir_modified_nanos);
        fnv1a_update_str(&mut hash_state, gitdir.as_str());
    }

    Ok(format!(
        "{}|{:016x}",
        common_git_dir.to_string_lossy(),
        hash_state
    ))
}
