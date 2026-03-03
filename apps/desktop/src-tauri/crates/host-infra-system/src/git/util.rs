use anyhow::{anyhow, Result};
use std::path::Path;

pub(super) fn normalize_non_empty(value: &str, label: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("git {label} cannot be empty"));
    }
    Ok(trimmed.to_string())
}

pub(super) fn path_to_string(path: &Path, label: &str) -> Result<String> {
    path.to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("Invalid {label}: {}", path.display()))
}

fn normalize_merge_ref(merge_ref: &str) -> String {
    if merge_ref.starts_with("refs/") {
        merge_ref.to_string()
    } else {
        format!("refs/heads/{merge_ref}")
    }
}

pub(super) fn resolve_upstream_ref(remote: &str, merge_ref: &str) -> String {
    let normalized_merge = normalize_merge_ref(merge_ref);
    if remote == "." {
        return normalized_merge;
    }
    let branch_ref = normalized_merge
        .strip_prefix("refs/heads/")
        .unwrap_or(normalized_merge.as_str());
    format!("refs/remotes/{remote}/{branch_ref}")
}

pub(super) fn combine_output(stdout: String, stderr: String) -> String {
    match (stdout.trim(), stderr.trim()) {
        ("", "") => String::new(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n{stderr}"),
    }
}
