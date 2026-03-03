#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCommitAllRequest,
    GitCommitAllResult, GitCurrentBranch, GitPort, GitPullRequest, GitPullResult,
    GitRebaseBranchRequest, GitRebaseBranchResult, PlanSubtaskInput, QaReportDocument, QaVerdict,
    RunEvent, RunState, RunSummary, TaskAction, TaskStatus, TaskStore, UpdateTaskPatch,
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
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, create_failing_opencode,
    create_failing_opencode_with_worktree_cleanup, create_fake_bd, create_fake_opencode,
    create_orphanable_opencode, empty_patch, init_git_repo, lock_env, make_emitter, make_session,
    make_task, prepend_path, process_is_alive, remove_env_var, set_env_var, spawn_sleep_process,
    unique_temp_path, wait_for_orphaned_opencode_process, wait_for_path_exists,
    wait_for_process_exit, write_executable_script, FakeTaskStore, GitCall, TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_process_registry, read_opencode_version,
    resolve_mcp_command, resolve_opencode_binary_path, terminate_child_process,
    terminate_process_by_pid, validate_parent_relationships_for_update,
    with_locked_opencode_process_registry, AgentRuntimeProcess, OpencodeProcessRegistryInstance,
    RunProcess, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};

#[test]
fn git_get_branches_initializes_repo_and_returns_git_data() -> Result<()> {
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
        },
    );

    let branches = service.git_get_branches(repo_path)?;
    assert_eq!(branches, expected);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
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
fn git_get_current_branch_uses_repo_init_cache() -> Result<()> {
    let repo_path = "/tmp/odt-repo-cache";
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("feature/demo".to_string()),
            detached: false,
        },
    );

    let first = service.git_get_current_branch(repo_path)?;
    let second = service.git_get_current_branch(repo_path)?;
    assert_eq!(first.name.as_deref(), Some("feature/demo"));
    assert_eq!(second.name.as_deref(), Some("feature/demo"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls.len(), 1);
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
fn git_switch_branch_forwards_create_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-switch";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
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
        },
    );

    let error = service
        .git_create_worktree(repo_path, "   ", "feature/new", true)
        .expect_err("empty worktree path should fail");
    assert!(error.to_string().contains("worktree path cannot be empty"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
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
fn git_push_branch_defaults_remote_to_origin() -> Result<()> {
    let repo_path = "/tmp/odt-repo-push";
    let working_dir = "/tmp/odt-repo-push-worktree";
    let (service, _task_state, git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let summary = service.git_push_branch(
        repo_path,
        Some(working_dir),
        Some("   "),
        "feature/x",
        true,
        false,
    )?;
    assert_eq!(summary.remote, "origin");
    assert_eq!(summary.branch, "feature/x");

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
fn git_commit_all_rejects_empty_message() {
    let repo_path = "/tmp/odt-repo-commit-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
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
fn git_rebase_branch_rejects_empty_target_branch() {
    let repo_path = "/tmp/odt-repo-rebase-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
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
