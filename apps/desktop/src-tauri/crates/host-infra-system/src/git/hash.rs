use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitFileDiff, GitFileStatus, GitUpstreamAheadBehind,
};

pub(crate) const GIT_WORKTREE_HASH_VERSION: u32 = 1;
const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;

pub(crate) struct Fnv1a64Hasher {
    state: u64,
}

impl Fnv1a64Hasher {
    pub(crate) fn new() -> Self {
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

    pub(crate) fn update_bool(&mut self, value: bool) {
        self.update_byte(u8::from(value));
    }

    pub(crate) fn update_u32(&mut self, value: u32) {
        self.update_bytes(&value.to_le_bytes());
    }

    pub(crate) fn update_u64(&mut self, value: u64) {
        self.update_bytes(&value.to_le_bytes());
    }

    pub(crate) fn update_str(&mut self, value: &str) {
        self.update_u64(value.len() as u64);
        self.update_bytes(value.as_bytes());
    }

    pub(crate) fn finish_hex(self) -> String {
        format!("{:016x}", self.state)
    }
}

pub(crate) fn hash_optional_str(hasher: &mut Fnv1a64Hasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update_byte(1);
            hasher.update_str(value);
        }
        None => hasher.update_byte(0),
    }
}

pub(crate) fn hash_upstream_ahead_behind(
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

pub(crate) fn hash_worktree_status_payload(
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

pub(crate) fn hash_worktree_diff_payload(file_diffs: &[GitFileDiff]) -> String {
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
