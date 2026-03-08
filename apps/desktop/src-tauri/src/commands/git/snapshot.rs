use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
    GitFileStatusCounts, GitUpstreamAheadBehind, GitWorktreeStatus, GitWorktreeStatusData,
    GitWorktreeStatusSnapshot, GitWorktreeStatusSummary,
};

pub(super) const GIT_WORKTREE_HASH_VERSION: u32 = 1;
const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;

struct Fnv1a64Hasher {
    state: u64,
}

impl Fnv1a64Hasher {
    fn new() -> Self {
        Self {
            state: FNV1A_64_OFFSET_BASIS,
        }
    }

    fn update_byte(&mut self, byte: u8) {
        self.state ^= u64::from(byte);
        self.state = self.state.wrapping_mul(FNV1A_64_PRIME);
    }

    fn update_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.update_byte(*byte);
        }
    }

    fn update_bool(&mut self, value: bool) {
        self.update_byte(u8::from(value));
    }

    fn update_u32(&mut self, value: u32) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_u64(&mut self, value: u64) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_str(&mut self, value: &str) {
        self.update_u64(value.len() as u64);
        self.update_bytes(value.as_bytes());
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.state)
    }
}

fn hash_optional_str(hasher: &mut Fnv1a64Hasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update_byte(1);
            hasher.update_str(value);
        }
        None => {
            hasher.update_byte(0);
        }
    }
}

fn hash_upstream_ahead_behind(
    hasher: &mut Fnv1a64Hasher,
    upstream_ahead_behind: &GitUpstreamAheadBehind,
) {
    match upstream_ahead_behind {
        GitUpstreamAheadBehind::Tracking { ahead, behind } => {
            hasher.update_str("tracking");
            hasher.update_u32(*ahead);
            hasher.update_u32(*behind);
        }
        GitUpstreamAheadBehind::Untracked { ahead } => {
            hasher.update_str("untracked");
            hasher.update_u32(*ahead);
        }
        GitUpstreamAheadBehind::Error { message } => {
            hasher.update_str("error");
            hasher.update_str(message);
        }
    }
}

pub(super) fn hash_worktree_status_payload(
    current_branch: &GitCurrentBranch,
    file_statuses: &[GitFileStatus],
    target_ahead_behind: &GitAheadBehind,
    upstream_ahead_behind: &GitUpstreamAheadBehind,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    hash_optional_str(&mut hasher, current_branch.name.as_deref());
    hasher.update_bool(current_branch.detached);

    hasher.update_u64(file_statuses.len() as u64);
    for status in file_statuses {
        hasher.update_str(&status.path);
        hasher.update_str(&status.status);
        hasher.update_bool(status.staged);
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);

    hash_upstream_ahead_behind(&mut hasher, upstream_ahead_behind);

    hasher.finish_hex()
}

pub(super) fn hash_worktree_diff_payload(file_diffs: &[GitFileDiff]) -> String {
    let mut hasher = Fnv1a64Hasher::new();
    hasher.update_u64(file_diffs.len() as u64);

    for diff in file_diffs {
        hasher.update_str(&diff.file);
        hasher.update_str(&diff.diff_type);
        hasher.update_u32(diff.additions);
        hasher.update_u32(diff.deletions);
        hasher.update_str(&diff.diff);
    }

    hasher.finish_hex()
}

pub(super) fn hash_worktree_diff_summary_payload(
    diff_scope: &GitDiffScope,
    target_ahead_behind: &GitAheadBehind,
    file_status_counts: &GitFileStatusCounts,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    match diff_scope {
        GitDiffScope::Target => hasher.update_str("target"),
        GitDiffScope::Uncommitted => hasher.update_str("uncommitted"),
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);
    hasher.update_u32(file_status_counts.total);
    hasher.update_u32(file_status_counts.staged);
    hasher.update_u32(file_status_counts.unstaged);

    hasher.finish_hex()
}

pub(super) struct WorktreeSnapshotMetadata {
    pub(super) effective_working_dir: String,
    pub(super) target_branch: String,
    pub(super) diff_scope: GitDiffScope,
    pub(super) observed_at_ms: u64,
    pub(super) hash_version: u32,
    pub(super) status_hash: String,
    pub(super) diff_hash: String,
}

fn snapshot_from_metadata(
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> GitWorktreeStatusSnapshot {
    GitWorktreeStatusSnapshot {
        effective_working_dir: snapshot_metadata.effective_working_dir,
        target_branch: snapshot_metadata.target_branch,
        diff_scope: snapshot_metadata.diff_scope,
        observed_at_ms: snapshot_metadata.observed_at_ms,
        hash_version: snapshot_metadata.hash_version,
        status_hash: snapshot_metadata.status_hash,
        diff_hash: snapshot_metadata.diff_hash,
    }
}

pub(super) fn build_worktree_status_with_snapshot(
    status_data: GitWorktreeStatusData,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> GitWorktreeStatus {
    GitWorktreeStatus {
        current_branch: status_data.current_branch,
        file_statuses: status_data.file_statuses,
        file_diffs: status_data.file_diffs,
        target_ahead_behind: status_data.target_ahead_behind,
        upstream_ahead_behind: status_data.upstream_ahead_behind,
        snapshot: snapshot_from_metadata(snapshot_metadata),
    }
}

pub(super) fn build_worktree_status_summary_with_snapshot(
    current_branch: GitCurrentBranch,
    file_status_counts: GitFileStatusCounts,
    target_ahead_behind: GitAheadBehind,
    upstream_ahead_behind: GitUpstreamAheadBehind,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> GitWorktreeStatusSummary {
    GitWorktreeStatusSummary {
        current_branch,
        file_status_counts,
        target_ahead_behind,
        upstream_ahead_behind,
        snapshot: snapshot_from_metadata(snapshot_metadata),
    }
}
