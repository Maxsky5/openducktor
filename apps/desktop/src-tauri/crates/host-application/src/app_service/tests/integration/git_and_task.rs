#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, GitAheadBehind, GitBranch, GitCommitAllRequest,
    GitCommitAllResult, GitCurrentBranch, GitDiffScope, GitFetchRequest, GitFileDiff,
    GitFileStatus, GitPort, GitPullRequest, GitPullResult, GitRebaseBranchRequest,
    GitRebaseBranchResult, GitResetSnapshot, GitResetWorktreeSelection,
    GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult, GitUpstreamAheadBehind,
    GitWorktreeStatusData, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState,
    RunSummary, RuntimeInstanceSummary, TaskAction, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
use crate::app_service::opencode_runtime::test_support::{
    read_opencode_process_registry, with_locked_opencode_process_registry,
    OpencodeProcessRegistryInstance, TrackedOpencodeProcessGuard,
    OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, create_failing_opencode,
    create_fake_bd, create_fake_opencode, create_orphanable_opencode, empty_patch, init_git_repo,
    lock_env, make_emitter, make_session, make_task, prepend_path, process_is_alive,
    remove_env_var, set_env_var, spawn_sleep_process, unique_temp_path,
    wait_for_orphaned_opencode_process, wait_for_path_exists, wait_for_process_exit,
    write_executable_script, write_private_file, FakeTaskStore, GitCall, TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_version, resolve_mcp_command,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    validate_parent_relationships_for_update, AgentRuntimeProcess, AppService, RunProcess,
};

fn assert_branch_missing(repo_path: &Path, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["branch", "--list", branch])
        .output()
        .with_context(|| format!("failed listing branch {branch} in {}", repo_path.display()))?;
    if !output.status.success() {
        return Err(anyhow!(
            "git branch --list failed for {branch} in {}",
            repo_path.display()
        ));
    }

    assert!(
        String::from_utf8_lossy(&output.stdout).trim().is_empty(),
        "branch {branch} should have been removed"
    );
    Ok(())
}

#[test]
fn git_get_branches_returns_git_data_without_task_store_initialization() -> Result<()> {
    let repo_path = "/tmp/odt-repo";
    let expected = vec![
        GitBranch {
            name: "main".to_string(),
            is_current: true,
            is_remote: false,
        },
        GitBranch {
            name: "origin/main".to_string(),
            is_current: false,
            is_remote: true,
        },
    ];
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![],
        expected.clone(),
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let branches = service.git_get_branches(repo_path)?;
    assert_eq!(branches, expected);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.ensure_calls.is_empty());
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert_eq!(
        git_state.calls,
        vec![GitCall::GetBranches {
            repo_path: repo_path.to_string()
        }]
    );
    Ok(())
}

#[test]
fn git_get_current_branch_does_not_touch_task_store_initialization() -> Result<()> {
    let repo_path = "/tmp/odt-repo-cache";
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("feature/demo".to_string()),
            detached: false,
            revision: None,
        },
    );

    let first = service.git_get_current_branch(repo_path)?;
    let second = service.git_get_current_branch(repo_path)?;
    assert_eq!(first.name.as_deref(), Some("feature/demo"));
    assert_eq!(second.name.as_deref(), Some("feature/demo"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.ensure_calls.is_empty());
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert_eq!(
        git_state.calls,
        vec![
            GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string()
            },
            GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string()
            }
        ]
    );
    Ok(())
}

#[test]
fn git_branch_reads_do_not_fail_when_task_store_initialization_is_broken() -> Result<()> {
    let repo_path = "/tmp/odt-repo-branch-read";
    let expected = vec![GitBranch {
        name: "main".to_string(),
        is_current: true,
        is_remote: false,
    }];
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        expected.clone(),
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    task_state.lock().expect("task lock poisoned").ensure_error =
        Some("beads init failed".to_string());

    let branches = service.git_get_branches(repo_path)?;
    let current = service.git_get_current_branch(repo_path)?;

    assert_eq!(branches, expected);
    assert_eq!(current.name.as_deref(), Some("main"));
    Ok(())
}

#[test]
fn git_switch_branch_forwards_create_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-switch";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let branch = service.git_switch_branch(repo_path, "feature/new-ui", true)?;
    assert_eq!(branch.name.as_deref(), Some("feature/new-ui"));
    assert!(!branch.detached);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::SwitchBranch {
        repo_path: repo_path.to_string(),
        branch: "feature/new-ui".to_string(),
        create: true,
    }));
    Ok(())
}

#[test]
fn git_create_worktree_rejects_empty_path() {
    let repo_path = "/tmp/odt-repo-worktree";
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .git_create_worktree(repo_path, "   ", "feature/new", true)
        .expect_err("empty worktree path should fail");
    assert!(error.to_string().contains("worktree path cannot be empty"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.ensure_calls.is_empty());
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state
        .calls
        .iter()
        .all(|call| !matches!(call, GitCall::CreateWorktree { .. })));
}

#[test]
fn git_remove_worktree_forwards_force_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-remove-worktree";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    assert!(service.git_remove_worktree(repo_path, "/tmp/wt-1", true)?);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::RemoveWorktree {
        repo_path: repo_path.to_string(),
        worktree_path: "/tmp/wt-1".to_string(),
        force: true,
    }));
    Ok(())
}

#[test]
fn git_remove_worktree_rejects_repository_root() {
    let repo_path = "/tmp/odt-repo-remove-worktree-root";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .git_remove_worktree(repo_path, repo_path, true)
        .expect_err("repo root removal should be rejected");

    assert!(error.to_string().contains("repository root"));
    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(!git_state
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::RemoveWorktree { .. })));
}

#[test]
fn git_remove_worktree_removes_leftover_directory_after_git_cleanup() -> Result<()> {
    let root = unique_temp_path("git-remove-worktree-leftover-directory");
    let repo_path = root.join("repo");
    let worktree_path = root.join("worktree");
    fs::create_dir_all(worktree_path.join("nested"))?;
    fs::write(
        worktree_path.join("nested").join("leftover.txt"),
        "leftover\n",
    )?;

    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    assert!(service.git_remove_worktree(
        repo_path.to_string_lossy().as_ref(),
        worktree_path.to_string_lossy().as_ref(),
        true,
    )?);

    assert!(git_state.lock().expect("git lock poisoned").calls.contains(
        &GitCall::RemoveWorktree {
            repo_path: repo_path.to_string_lossy().to_string(),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            force: true,
        }
    ));
    assert!(
        !worktree_path.exists(),
        "leftover directory should be removed"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn git_create_worktree_copies_configured_files() -> Result<()> {
    let root = unique_temp_path("git-create-worktree-copies-files");
    let repo = root.join("repo");
    let worktree = root.join("worktree");
    init_git_repo(&repo)?;
    write_private_file(repo.join(".env").as_path(), "API_KEY=manual-copy\n")?;

    let task_state = Arc::new(Mutex::new(TaskStoreState::default()));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore { state: task_state });
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let service = AppService::new(task_store, config_store);
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: vec![".env".to_string()],
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    service.git_create_worktree(
        repo_path.as_str(),
        worktree.to_string_lossy().as_ref(),
        "feature/manual-copy",
        true,
    )?;

    assert_eq!(
        fs::read_to_string(worktree.join(".env"))?,
        "API_KEY=manual-copy\n"
    );

    service.git_remove_worktree(
        repo_path.as_str(),
        worktree.to_string_lossy().as_ref(),
        true,
    )?;
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn git_create_worktree_cleans_up_when_configured_file_copy_fails() -> Result<()> {
    let root = unique_temp_path("git-create-worktree-copy-failure");
    let repo = root.join("repo");
    let worktree = root.join("worktree");
    init_git_repo(&repo)?;

    let task_state = Arc::new(Mutex::new(TaskStoreState::default()));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore { state: task_state });
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let service = AppService::new(task_store, config_store);
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: vec![".env".to_string()],
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .git_create_worktree(
            repo_path.as_str(),
            worktree.to_string_lossy().as_ref(),
            "feature/manual-copy-failure",
            true,
        )
        .expect_err("missing configured copy source should fail");
    assert!(error
        .to_string()
        .contains("Configured worktree file copy failed"));
    assert!(
        !worktree.exists(),
        "manual worktree creation should remove the failed worktree"
    );
    assert_branch_missing(repo.as_path(), "feature/manual-copy-failure")?;

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn git_delete_local_branch_forwards_force_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-delete-local-branch";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    assert!(service.git_delete_local_branch(repo_path, "obp/task-123-cleanup", true)?);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::DeleteLocalBranch {
        repo_path: repo_path.to_string(),
        branch: "obp/task-123-cleanup".to_string(),
        force: true,
    }));
    Ok(())
}

#[test]
fn git_push_branch_defaults_remote_to_origin() -> Result<()> {
    let repo_path = "/tmp/odt-repo-push";
    let working_dir = "/tmp/odt-repo-push-worktree";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let result = service.git_push_branch(
        repo_path,
        Some(working_dir),
        Some("   "),
        "feature/x",
        true,
        false,
    )?;
    match result {
        host_domain::GitPushResult::Pushed { remote, branch, .. } => {
            assert_eq!(remote, "origin");
            assert_eq!(branch, "feature/x");
        }
        other => panic!("expected pushed result, got {other:?}"),
    }

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::PushBranch {
        repo_path: working_dir.to_string(),
        remote: "origin".to_string(),
        branch: "feature/x".to_string(),
        set_upstream: true,
        force_with_lease: false,
    }));
    Ok(())
}

#[test]
fn git_pull_branch_forwards_working_dir_and_returns_result() -> Result<()> {
    let repo_path = "/tmp/odt-repo-pull";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.pull_branch_result = GitPullResult::Pulled {
            output: "updated from upstream".to_string(),
        };
    }

    let result = service.git_pull_branch(
        repo_path,
        GitPullRequest {
            working_dir: Some("/tmp/odt-repo-pull-worktree".to_string()),
        },
    )?;

    assert_eq!(
        result,
        GitPullResult::Pulled {
            output: "updated from upstream".to_string(),
        }
    );

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::PullBranch {
        repo_path: "/tmp/odt-repo-pull-worktree".to_string(),
        working_dir: Some("/tmp/odt-repo-pull-worktree".to_string()),
    }));

    Ok(())
}

#[test]
fn git_fetch_remote_forwards_working_dir_and_trimmed_target_branch() -> Result<()> {
    let repo_path = "/tmp/odt-repo-fetch";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let result = service.git_fetch_remote(
        repo_path,
        GitFetchRequest {
            working_dir: Some("/tmp/odt-repo-fetch-worktree".to_string()),
            target_branch: "  origin/main  ".to_string(),
        },
    )?;

    assert_eq!(
        result,
        host_domain::GitFetchResult::Fetched {
            output: "Fetched origin".to_string()
        }
    );

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::FetchRemote {
        repo_path: "/tmp/odt-repo-fetch-worktree".to_string(),
        working_dir: Some("/tmp/odt-repo-fetch-worktree".to_string()),
        target_branch: "origin/main".to_string(),
    }));

    Ok(())
}

#[test]
fn git_commit_all_rejects_empty_message() {
    let repo_path = "/tmp/odt-repo-commit-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .git_commit_all(
            repo_path,
            GitCommitAllRequest {
                working_dir: None,
                message: "   ".to_string(),
            },
        )
        .expect_err("blank commit message should fail");

    assert!(error.to_string().contains("commit message cannot be empty"));
}

#[test]
fn git_commit_all_returns_committed_and_trims_message() -> Result<()> {
    let repo_path = "/tmp/odt-repo-commit-success";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.commit_all_result = GitCommitAllResult::Committed {
            commit_hash: "abc1234".to_string(),
            output: "ok commit".to_string(),
        };
    }

    let result = service.git_commit_all(
        repo_path,
        GitCommitAllRequest {
            working_dir: Some("/tmp/workspace".to_string()),
            message: "  commit message  ".to_string(),
        },
    )?;

    assert_eq!(
        result,
        GitCommitAllResult::Committed {
            commit_hash: "abc1234".to_string(),
            output: "ok commit".to_string(),
        }
    );

    let git_state = git_state.lock().expect("git lock poisoned");
    assert_eq!(
        git_state.calls,
        vec![GitCall::CommitAll {
            repo_path: "/tmp/workspace".to_string(),
            working_dir: Some("/tmp/workspace".to_string()),
            message: "commit message".to_string(),
        }]
    );

    Ok(())
}

#[test]
fn git_commit_all_returns_no_changes() -> Result<()> {
    let repo_path = "/tmp/odt-repo-commit-no-changes";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.commit_all_result = GitCommitAllResult::NoChanges {
            output: "nothing to commit".to_string(),
        };
    }

    let result = service.git_commit_all(
        repo_path,
        GitCommitAllRequest {
            working_dir: None,
            message: "commit all".to_string(),
        },
    )?;

    assert_eq!(
        result,
        GitCommitAllResult::NoChanges {
            output: "nothing to commit".to_string(),
        }
    );

    assert_eq!(
        git_state
            .lock()
            .expect("git lock poisoned")
            .calls
            .first()
            .cloned()
            .expect("expected commit_all call"),
        GitCall::CommitAll {
            repo_path: repo_path.to_string(),
            working_dir: None,
            message: "commit all".to_string(),
        }
    );

    Ok(())
}

#[test]
fn git_reset_worktree_selection_forwards_request_fields_to_git_port() -> Result<()> {
    let repo_path = "/tmp/odt-repo-reset";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.reset_worktree_selection_result = GitResetWorktreeSelectionResult {
            affected_paths: vec!["src/main.ts".to_string()],
        };
    }

    let result = service.git_reset_worktree_selection(
        repo_path,
        GitResetWorktreeSelectionRequest {
            working_dir: Some("/tmp/odt-repo-reset-worktree".to_string()),
            target_branch: "  origin/main  ".to_string(),
            snapshot: GitResetSnapshot {
                hash_version: 1,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
            selection: GitResetWorktreeSelection::Hunk {
                file_path: "src/main.ts".to_string(),
                hunk_index: 2,
            },
        },
    )?;

    assert_eq!(
        result,
        GitResetWorktreeSelectionResult {
            affected_paths: vec!["src/main.ts".to_string()],
        }
    );

    assert_eq!(
        git_state
            .lock()
            .expect("git lock poisoned")
            .calls
            .last()
            .cloned()
            .expect("expected reset call"),
        GitCall::ResetWorktreeSelection {
            repo_path: "/tmp/odt-repo-reset-worktree".to_string(),
            working_dir: Some("/tmp/odt-repo-reset-worktree".to_string()),
            target_branch: "  origin/main  ".to_string(),
            snapshot: GitResetSnapshot {
                hash_version: 1,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
            selection: GitResetWorktreeSelection::Hunk {
                file_path: "src/main.ts".to_string(),
                hunk_index: 2,
            },
        }
    );

    Ok(())
}

#[test]
fn git_rebase_branch_rejects_empty_target_branch() {
    let repo_path = "/tmp/odt-repo-rebase-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .git_rebase_branch(
            repo_path,
            GitRebaseBranchRequest {
                working_dir: None,
                target_branch: "   ".to_string(),
            },
        )
        .expect_err("blank target branch should fail");

    assert!(error.to_string().contains("target branch cannot be empty"));
}

#[test]
fn git_rebase_branch_forwards_trimmed_target_branch_and_can_conflict() -> Result<()> {
    let repo_path = "/tmp/odt-repo-rebase-conflict";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.rebase_branch_result = GitRebaseBranchResult::Conflicts {
            conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            output: "conflicts found".to_string(),
        };
    }

    let result = service.git_rebase_branch(
        repo_path,
        GitRebaseBranchRequest {
            working_dir: None,
            target_branch: "  origin/main  ".to_string(),
        },
    )?;

    assert_eq!(
        result,
        GitRebaseBranchResult::Conflicts {
            conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            output: "conflicts found".to_string(),
        }
    );

    assert_eq!(
        git_state
            .lock()
            .expect("git lock poisoned")
            .calls
            .first()
            .cloned()
            .expect("expected rebase call"),
        GitCall::RebaseBranch {
            repo_path: repo_path.to_string(),
            working_dir: None,
            target_branch: "origin/main".to_string(),
        }
    );

    Ok(())
}

#[test]
fn git_port_get_worktree_status_returns_configured_payload_from_fake_port() -> Result<()> {
    let repo_path = "/tmp/odt-repo-worktree-status";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let expected = GitWorktreeStatusData {
        current_branch: GitCurrentBranch {
            name: Some("feature/composite".to_string()),
            detached: false,
            revision: None,
        },
        file_statuses: vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "modified".to_string(),
            staged: false,
        }],
        file_diffs: vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 2,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
        }],
        target_ahead_behind: GitAheadBehind {
            ahead: 3,
            behind: 1,
        },
        upstream_ahead_behind: GitUpstreamAheadBehind::Tracking {
            ahead: 4,
            behind: 5,
        },
    };

    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.worktree_status_data = Some(expected.clone());
    }

    let actual = service.git_port().get_worktree_status(
        Path::new(repo_path),
        "origin/main",
        GitDiffScope::Target,
    )?;
    assert_eq!(actual, expected);

    let state = git_state.lock().expect("git state lock poisoned");
    assert!(state.calls.contains(&GitCall::GetWorktreeStatus {
        repo_path: repo_path.to_string(),
        target_branch: "origin/main".to_string(),
        diff_scope: GitDiffScope::Target,
    }));

    Ok(())
}
