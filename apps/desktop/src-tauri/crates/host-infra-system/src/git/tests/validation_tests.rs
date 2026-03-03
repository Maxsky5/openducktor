use host_domain::GitPort;

use super::super::GitCliPort;
use super::support::{git_available, setup_repo, TempPath};

#[test]
fn git_port_validates_non_empty_inputs_and_non_repo_paths() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("validation");
    let git = GitCliPort::new();
    let non_repo = TempPath::new("non-repo");

    assert!(git.get_branches(&non_repo.path).is_err());
    assert!(git.switch_branch(&repo.path, "   ", false).is_err());
    assert!(git
        .create_worktree(&repo.path, &TempPath::new("w").path, " ", true)
        .is_err());
    assert!(git
        .push_branch(&repo.path, "", "main", false, false)
        .is_err());
    assert!(git
        .push_branch(&repo.path, "origin", " ", false, false)
        .is_err());
}
