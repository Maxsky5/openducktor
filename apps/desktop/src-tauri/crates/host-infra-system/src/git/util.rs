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

pub(super) fn normalize_merge_ref(merge_ref: &str) -> String {
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

// Converts a verified remote target ref into the local branch name to checkout.
// Callers must only use this for remote-tracking refs or `remote/branch` names
// that have already been confirmed as remote branches.
pub(super) fn checkout_branch_from_target_ref(target_branch: &str) -> String {
    let trimmed = target_branch.trim();
    if let Some(local_branch) = trimmed.strip_prefix("refs/heads/") {
        return local_branch.to_string();
    }
    if let Some(remote_ref) = trimmed.strip_prefix("refs/remotes/") {
        let mut segments = remote_ref.splitn(2, '/');
        let _remote = segments.next();
        if let Some(branch) = segments.next() {
            return branch.to_string();
        }
    }
    if let Some((_, branch)) = trimmed.split_once('/') {
        if !branch.is_empty() {
            return branch.to_string();
        }
    }
    trimmed.to_string()
}

pub(super) fn combine_output(stdout: String, stderr: String) -> String {
    match (stdout.trim(), stderr.trim()) {
        ("", "") => String::new(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n{stderr}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{checkout_branch_from_target_ref, combine_output};

    #[test]
    fn combine_output_prefers_non_empty_streams_and_preserves_both() {
        assert_eq!(combine_output("".to_string(), "".to_string()), "");
        assert_eq!(
            combine_output("stdout".to_string(), "".to_string()),
            "stdout"
        );
        assert_eq!(
            combine_output("".to_string(), "stderr".to_string()),
            "stderr"
        );
        assert_eq!(
            combine_output("stdout".to_string(), "stderr".to_string()),
            "stdout\nstderr"
        );
    }

    #[test]
    fn checkout_branch_from_target_ref_strips_remote_tracking_prefixes() {
        assert_eq!(checkout_branch_from_target_ref("origin/main"), "main");
        assert_eq!(
            checkout_branch_from_target_ref("upstream/release"),
            "release"
        );
        assert_eq!(
            checkout_branch_from_target_ref("refs/remotes/upstream/release"),
            "release"
        );
        assert_eq!(checkout_branch_from_target_ref("refs/heads/main"), "main");
        assert_eq!(checkout_branch_from_target_ref("main"), "main");
    }
}
