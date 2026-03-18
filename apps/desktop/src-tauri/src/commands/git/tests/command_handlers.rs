use super::super::{
    command_handlers::{parse_diff_scope, require_target_branch},
    snapshot::GIT_WORKTREE_HASH_VERSION,
};
use super::fixtures::{
    init_repo, invoke_json, run_git, sample_worktree_status_data,
    sample_worktree_status_summary_data, setup_command_git_fixture,
    setup_command_git_fixture_with_mutations, setup_command_git_fixture_with_summary,
    ResetWorktreeSelectionCall, ResetWorktreeSelectionResult, WorktreeStatusCall,
    WorktreeStatusResult, WorktreeStatusSummaryCall, WorktreeStatusSummaryResult,
};
use host_domain::{
    GitDiffScope, GitResetWorktreeSelection, GitUpstreamAheadBehind, GitWorktreeStatus,
    GitWorktreeStatusSummary,
};
use serde_json::json;
use std::{fs, path::Path};

#[test]
fn git_get_worktree_status_rejects_unauthorized_repo() {
    let fixture = setup_command_git_fixture(
        "git-command-unauthorized",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        false,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
        }),
    )
    .expect_err("unauthorized repo should fail");

    assert!(
        error
            .to_string()
            .contains("Repository path is not in the configured workspace allowlist"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.worktree_status_calls.is_empty(),
        "git port should not run when authorization fails"
    );
}

#[test]
fn git_get_worktree_status_keeps_upstream_error_variant_and_snapshot_metadata() {
    let fixture = setup_command_git_fixture(
        "git-command-upstream-error",
        WorktreeStatusResult::Ok(sample_worktree_status_data(GitUpstreamAheadBehind::Error {
            message: "upstream not configured".to_string(),
        })),
        true,
    );

    let response = invoke_json(
        &fixture.webview,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "  origin/main  ",
            "diffScope": "uncommitted",
        }),
    )
    .expect("command should succeed");
    let status: GitWorktreeStatus =
        serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");

    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Error {
            message: "upstream not configured".to_string()
        }
    );
    assert_eq!(status.snapshot.target_branch, "origin/main");
    assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
    assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
    assert_eq!(status.snapshot.status_hash.len(), 16);
    assert_eq!(status.snapshot.diff_hash.len(), 16);

    let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
        .expect("repo should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(status.snapshot.effective_working_dir, expected_effective);

    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.worktree_status_calls.len(), 1);
    assert_eq!(
        state.worktree_status_calls[0],
        WorktreeStatusCall {
            repo_path: expected_effective,
            target_branch: "origin/main".to_string(),
            diff_scope: GitDiffScope::Uncommitted,
        }
    );
}

#[test]
fn git_get_worktree_status_propagates_upstream_status_collection_failures() {
    let fixture = setup_command_git_fixture(
        "git-command-status-failure",
        WorktreeStatusResult::Err("failed collecting upstream status".to_string()),
        true,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
        }),
    )
    .expect_err("git port failure should be returned");

    assert!(
        error
            .to_string()
            .contains("failed collecting upstream status"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.worktree_status_calls.len(), 1);
}

#[test]
fn git_get_worktree_status_rejects_unrelated_working_dir() {
    let fixture = setup_command_git_fixture(
        "git-command-working-dir-reject",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let external = fixture.root.join("external");
    init_repo(&external);

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "workingDir": external.to_string_lossy().to_string(),
        }),
    )
    .expect_err("unrelated working_dir should fail");

    assert!(
        error
            .to_string()
            .contains("working_dir is not within authorized repository or linked worktrees"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.worktree_status_calls.is_empty(),
        "git port should not run for unauthorized working_dir"
    );
}

#[test]
fn git_get_worktree_status_accepts_registered_worktree_working_dir() {
    let fixture = setup_command_git_fixture(
        "git-command-working-dir-accept",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 1,
                behind: 0,
            },
        )),
        true,
    );
    let worktree = fixture.root.join("repo-wt");
    let worktree_str = worktree.to_string_lossy().to_string();
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/command-working-dir",
            worktree_str.as_str(),
        ],
        Path::new(&fixture.repo_path),
    );

    let response = invoke_json(
        &fixture.webview,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "workingDir": worktree_str,
        }),
    )
    .expect("registered worktree should be accepted");
    let status: GitWorktreeStatus =
        serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");
    let expected_worktree = fs::canonicalize(&worktree)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(status.snapshot.effective_working_dir, expected_worktree);

    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.worktree_status_calls.len(), 1);
    assert_eq!(state.worktree_status_calls[0].repo_path, expected_worktree);
}

#[test]
fn git_reset_worktree_selection_rejects_unauthorized_repo() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-reset-command-unauthorized",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        false,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_reset_worktree_selection",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "snapshot": {
                "hashVersion": 1,
                "statusHash": "0123456789abcdef",
                "diffHash": "fedcba9876543210"
            },
            "selection": {
                "kind": "file",
                "file_path": "src/main.rs"
            }
        }),
    )
    .expect_err("unauthorized repo should fail");

    assert!(
        error
            .to_string()
            .contains("Repository path is not in the configured workspace allowlist"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.reset_worktree_selection_calls.is_empty(),
        "reset path should not run when authorization fails"
    );
}

#[test]
fn git_reset_worktree_selection_forwards_trimmed_target_branch_and_effective_working_dir() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-reset-command-success",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let worktree = fixture.root.join("repo-wt-reset");
    let worktree_str = worktree.to_string_lossy().to_string();
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/reset-command",
            worktree_str.as_str(),
        ],
        Path::new(&fixture.repo_path),
    );

    let response = invoke_json(
        &fixture.webview,
        "git_reset_worktree_selection",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "workingDir": worktree_str,
            "targetBranch": "  origin/main  ",
            "snapshot": {
                "hashVersion": 1,
                "statusHash": "0123456789abcdef",
                "diffHash": "fedcba9876543210"
            },
            "selection": {
                "kind": "hunk",
                "file_path": "src/main.rs",
                "hunk_index": 2
            }
        }),
    )
    .expect("reset command should succeed");

    assert_eq!(response["affectedPaths"], json!(["src/main.rs"]));
    let expected_worktree = fs::canonicalize(&worktree)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.reset_worktree_selection_calls.len(), 1);
    assert_eq!(
        state.reset_worktree_selection_calls[0],
        ResetWorktreeSelectionCall {
            repo_path: expected_worktree.clone(),
            working_dir: Some(expected_worktree),
            target_branch: "origin/main".to_string(),
            selection: GitResetWorktreeSelection::Hunk {
                file_path: "src/main.rs".to_string(),
                hunk_index: 2,
            },
        }
    );
}

#[test]
fn git_reset_worktree_selection_propagates_backend_failure() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-reset-command-failure",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned")
        .reset_worktree_selection_result =
        ResetWorktreeSelectionResult::Err("apply failed".to_string());

    let error = invoke_json(
        &fixture.webview,
        "git_reset_worktree_selection",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "snapshot": {
                "hashVersion": 1,
                "statusHash": "0123456789abcdef",
                "diffHash": "fedcba9876543210"
            },
            "selection": {
                "kind": "file",
                "file_path": "src/main.rs"
            }
        }),
    )
    .expect_err("backend failure should be returned");

    assert!(
        error.to_string().contains("apply failed"),
        "unexpected error: {error}"
    );
}

#[test]
fn git_get_worktree_status_summary_rejects_unauthorized_repo() {
    let fixture = setup_command_git_fixture(
        "git-command-summary-unauthorized",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        false,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status_summary",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
        }),
    )
    .expect_err("unauthorized repo should fail");

    assert!(
        error
            .to_string()
            .contains("Repository path is not in the configured workspace allowlist"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.worktree_status_summary_calls.is_empty(),
        "git port summary path should not run when authorization fails"
    );
}

#[test]
fn git_get_worktree_status_summary_keeps_upstream_error_variant_and_snapshot_metadata() {
    let fixture = setup_command_git_fixture_with_summary(
        "git-command-summary-upstream-error",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string(),
            },
        )),
        true,
        false,
    );

    let response = invoke_json(
        &fixture.webview,
        "git_get_worktree_status_summary",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "  origin/main  ",
            "diffScope": "uncommitted",
        }),
    )
    .expect("summary command should succeed");
    let status: GitWorktreeStatusSummary = serde_json::from_value(response)
        .expect("response should decode as GitWorktreeStatusSummary");

    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Error {
            message: "upstream not configured".to_string()
        }
    );
    assert_eq!(status.snapshot.target_branch, "origin/main");
    assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
    assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
    assert_eq!(status.snapshot.status_hash.len(), 16);
    assert_eq!(status.snapshot.diff_hash.len(), 16);

    let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
        .expect("repo should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(status.snapshot.effective_working_dir, expected_effective);

    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.worktree_status_summary_calls.len(), 1);
    assert_eq!(
        state.worktree_status_summary_calls[0],
        WorktreeStatusSummaryCall {
            repo_path: expected_effective,
            target_branch: "origin/main".to_string(),
            diff_scope: GitDiffScope::Uncommitted,
        }
    );
}

#[test]
fn git_get_worktree_status_summary_propagates_git_port_failures() {
    let fixture = setup_command_git_fixture_with_summary(
        "git-command-summary-status-failure",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        WorktreeStatusSummaryResult::Err("failed collecting summary status".to_string()),
        true,
        false,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status_summary",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
        }),
    )
    .expect_err("git port summary failure should be returned");

    assert!(
        error
            .to_string()
            .contains("failed collecting summary status"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.worktree_status_summary_calls.len(), 1);
}

#[test]
fn git_get_worktree_status_summary_rejects_invalid_diff_scope_before_git_port_call() {
    let fixture = setup_command_git_fixture(
        "git-command-summary-invalid-scope",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status_summary",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "diffScope": "staged",
        }),
    )
    .expect_err("invalid diff scope should fail");

    assert!(
        error
            .to_string()
            .contains("diffScope must be either 'target' or 'uncommitted'"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.worktree_status_summary_calls.is_empty(),
        "git port summary path should not run when diffScope is invalid"
    );
}

#[test]
fn git_get_worktree_status_summary_rejects_unrelated_working_dir() {
    let fixture = setup_command_git_fixture(
        "git-command-summary-working-dir-reject",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let external = fixture.root.join("external-summary");
    init_repo(&external);

    let error = invoke_json(
        &fixture.webview,
        "git_get_worktree_status_summary",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "targetBranch": "origin/main",
            "workingDir": external.to_string_lossy().to_string(),
        }),
    )
    .expect_err("unrelated working_dir should fail");

    assert!(
        error
            .to_string()
            .contains("working_dir is not within authorized repository or linked worktrees"),
        "unexpected error: {error}"
    );
    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert!(
        state.worktree_status_summary_calls.is_empty(),
        "git port summary path should not run for unauthorized working_dir"
    );
}

#[test]
fn require_target_branch_rejects_blank_values() {
    let error = require_target_branch("   ").expect_err("blank target branch should be rejected");
    assert_eq!(error, "targetBranch is required");
}

#[test]
fn parse_diff_scope_accepts_uncommitted_and_rejects_unknown_values() {
    assert_eq!(
        parse_diff_scope(Some("uncommitted")).expect("uncommitted scope should parse"),
        GitDiffScope::Uncommitted
    );

    let error = parse_diff_scope(Some("staged"))
        .expect_err("unknown diff scope should be rejected at command boundary");
    assert!(
        error.contains("diffScope must be either 'target' or 'uncommitted'"),
        "unexpected scope parse error: {error}"
    );
}
