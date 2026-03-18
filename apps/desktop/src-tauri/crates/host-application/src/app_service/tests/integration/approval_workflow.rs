#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitBranch, GitCurrentBranch, GitFileStatus, GitMergeBranchResult, GitMergeMethod,
    TaskPullRequestDetectResult, TaskStatus,
};
use host_infra_system::{
    AppConfigStore, GitProviderConfig, GitProviderRepository, HookSet, RepoConfig,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::app_service::test_support::{
    build_service_with_store, init_git_repo, lock_env, make_session, make_task, prepend_path,
    set_env_var, unique_temp_path, write_executable_script, GitCall,
};
use crate::RepoConfigUpdate;

fn base_repo_config(worktree_base: &Path) -> RepoConfig {
    RepoConfig {
        default_runtime_kind: "opencode".to_string(),
        worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
        branch_prefix: "odt".to_string(),
        default_target_branch: host_infra_system::GitTargetBranch {
            remote: Some("origin".to_string()),
            branch: "main".to_string(),
        },
        git: Default::default(),
        trusted_hooks: false,
        trusted_hooks_fingerprint: None,
        hooks: HookSet::default(),
        worktree_file_copies: Vec::new(),
        prompt_overrides: Default::default(),
        agent_defaults: Default::default(),
    }
}

fn github_repo_config(worktree_base: &Path) -> RepoConfig {
    github_repo_config_for_host(worktree_base, "github.com")
}

fn github_repo_config_for_host(worktree_base: &Path, host: &str) -> RepoConfig {
    let mut config = base_repo_config(worktree_base);
    config.git.providers.insert(
        "github".to_string(),
        GitProviderConfig {
            enabled: true,
            auto_detected: false,
            repository: Some(GitProviderRepository {
                host: host.to_string(),
                owner: "openai".to_string(),
                name: "openducktor".to_string(),
            }),
        },
    );
    config
}

fn configure_github_remote(repo_path: &Path, remote_name: &str, host: &str) -> Result<()> {
    let remote_url = format!("git@{host}:openai/openducktor.git");
    run_git(
        repo_path,
        &["remote", "add", remote_name, remote_url.as_str()],
    )
}

fn configure_builder_session(
    repo_path: &str,
    worktree_path: &Path,
    source_branch: &str,
    service: &crate::app_service::AppService,
    task_state: &std::sync::Arc<std::sync::Mutex<crate::app_service::test_support::TaskStoreState>>,
    git_state: &std::sync::Arc<std::sync::Mutex<crate::app_service::test_support::GitState>>,
) -> Result<()> {
    fs::create_dir_all(worktree_path)?;
    let repo_root = Path::new(repo_path);
    if run_git(repo_root, &["remote", "get-url", "origin"]).is_err() {
        configure_github_remote(repo_root, "origin", "github.com")?;
    }

    let mut session = make_session("task-1", "session-build");
    session.working_directory = worktree_path.to_string_lossy().to_string();
    task_state
        .lock()
        .expect("task state lock poisoned")
        .agent_sessions
        .push(session);

    let mut git = git_state.lock().expect("git state lock poisoned");
    git.current_branches_by_path.insert(
        worktree_path.to_string_lossy().to_string(),
        GitCurrentBranch {
            name: Some(source_branch.to_string()),
            detached: false,
            revision: None,
        },
    );
    git.branches = vec![
        GitBranch {
            name: source_branch.to_string(),
            is_current: false,
            is_remote: false,
        },
        GitBranch {
            name: "origin/main".to_string(),
            is_current: false,
            is_remote: true,
        },
    ];
    drop(git);

    service.workspace_add(repo_path)?;
    Ok(())
}

fn write_fake_gh(root: &Path) -> Result<PathBuf> {
    let bin_dir = root.join("bin");
    let gh_path = bin_dir.join("gh");
    write_executable_script(
        &gh_path,
        r#"#!/bin/sh
set -eu
if [ -n "${ODT_GH_LOG_FILE:-}" ]; then
  printf '%s\n' "$*" >> "$ODT_GH_LOG_FILE"
fi

case "${1:-}" in
  --hostname)
    shift 2
    ;;
esac

case "${1:-}" in
  --version)
    echo "gh version 2.73.0"
    ;;
  auth)
    if [ "${ODT_GH_AUTH_OK:-1}" = "1" ]; then
      echo "Logged in to github.com account ${ODT_GH_AUTH_LOGIN:-octocat}"
      exit 0
    fi
    echo "${ODT_GH_AUTH_ERROR:-GitHub authentication is not configured. Run gh auth login.}" >&2
    exit 1
    ;;
  repo)
    if [ "${ODT_GH_REPO_VIEW_OK:-0}" = "1" ]; then
      printf '{"nameWithOwner":"%s"}\n' "${ODT_GH_REPO_VIEW_NAME_WITH_OWNER:-openai/openducktor}"
      exit 0
    fi
    echo "repo view unavailable" >&2
    exit 1
    ;;
  api)
    method="GET"
    path=""
    expect_method_value="0"
    for arg in "$@"; do
      if [ "$expect_method_value" = "1" ]; then
        method="$arg"
        expect_method_value="0"
        continue
      fi
      if [ "$arg" = "--method" ]; then
        expect_method_value="1"
        continue
      fi
      case "$arg" in
        repos/*)
          path="$arg"
          ;;
      esac
    done

    if [ "$method" = "POST" ] && [ "$path" = "repos/openai/openducktor/pulls" ]; then
      cat "$ODT_GH_CREATE_RESPONSE"
      exit 0
    fi
    if [ "$method" = "PATCH" ] && [ "$path" = "repos/openai/openducktor/pulls/17" ]; then
      cat "$ODT_GH_UPDATE_RESPONSE"
      exit 0
    fi
    if [ "$method" = "GET" ] && [ "$path" = "repos/openai/openducktor/pulls/17" ]; then
      cat "$ODT_GH_FETCH_RESPONSE"
      exit 0
    fi
    if [ "$method" = "GET" ] && [ "$path" = "repos/openai/openducktor/pulls" ]; then
      if [ -n "${ODT_GH_LIST_RESPONSE:-}" ]; then
        cat "$ODT_GH_LIST_RESPONSE"
      else
        printf '[]\n'
      fi
      exit 0
    fi
    echo "unsupported gh api call: $*" >&2
    exit 1
    ;;
esac

echo "unsupported gh invocation: $*" >&2
exit 1
"#,
    )?;
    Ok(bin_dir)
}

fn write_json(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .status()
        .with_context(|| format!("failed to run git with args {args:?}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("git {:?} failed with status {}", args, status))
    }
}

#[test]
fn task_direct_merge_with_publish_target_stays_resumable_until_completion() -> Result<()> {
    let root = unique_temp_path("approval-direct-merge");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let unrelated_worktree_path = worktree_base.join("task-1-retry");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    let _ = run_git(&repo, &["remote", "remove", "origin"]);
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), base_repo_config(&worktree_base))?;

    let task =
        service.task_direct_merge(repo_path.as_str(), "task-1", GitMergeMethod::Rebase, None)?;
    let host_domain::TaskDirectMergeResult::Completed { task } = task else {
        panic!("expected completed direct merge result");
    };
    assert_eq!(task.status, TaskStatus::HumanReview);

    let state = task_state.lock().expect("task state lock poisoned");
    let record = state
        .direct_merge_records
        .get("task-1")
        .ok_or_else(|| anyhow!("direct merge record missing"))?;
    assert_eq!(record.method, GitMergeMethod::Rebase);
    assert_eq!(record.source_branch, "odt/task-1");
    assert_eq!(
        record.target_branch,
        host_domain::GitTargetBranch {
            remote: Some("origin".to_string()),
            branch: "main".to_string(),
        }
    );
    assert!(!state.pull_requests.contains_key("task-1"));
    drop(state);

    fs::create_dir_all(&unrelated_worktree_path)?;
    let mut unrelated_session = make_session("task-1", "session-build-retry");
    unrelated_session.started_at = "2026-02-20T12:30:00Z".to_string();
    unrelated_session.updated_at = Some("2026-02-20T12:30:10Z".to_string());
    unrelated_session.working_directory = unrelated_worktree_path.to_string_lossy().to_string();
    task_state
        .lock()
        .expect("task state lock poisoned")
        .agent_sessions
        .push(unrelated_session);
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            unrelated_worktree_path.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1-retry".to_string()),
                detached: false,
                revision: None,
            },
        );

    let git = git_state.lock().expect("git state lock poisoned");
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::MergeBranch {
            source_branch,
            target_branch,
            method,
            ..
        } if source_branch == "odt/task-1"
            && target_branch == "origin/main"
            && *method == GitMergeMethod::Rebase
    )));
    assert!(!git
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::RemoveWorktree { .. })));
    assert!(!git
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::SuggestedSquashCommitMessage { .. })));
    assert!(!git.calls.iter().any(
        |call| matches!(call, GitCall::DeleteLocalBranch { branch, .. } if branch == "odt/task-1")
    ));
    drop(git);

    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.commits_ahead_behind_result = host_domain::GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
    }
    let complete_error = service
        .task_direct_merge_complete(repo_path.as_str(), "task-1")
        .expect_err("publish-target direct merge should require a synchronized push");
    assert!(complete_error.to_string().contains("fully published"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert_eq!(
        state
            .tasks
            .iter()
            .find(|task| task.id == "task-1")
            .map(|task| &task.status),
        Some(&TaskStatus::HumanReview)
    );
    drop(state);

    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.commits_ahead_behind_result = host_domain::GitAheadBehind {
            ahead: 0,
            behind: 0,
        };
    }
    let completed = service.task_direct_merge_complete(repo_path.as_str(), "task-1")?;
    assert_eq!(completed.status, TaskStatus::Closed);

    let expected_cleanup_worktree = worktree_path.to_string_lossy().to_string();
    let unrelated_cleanup_worktree = unrelated_worktree_path.to_string_lossy().to_string();
    let git = git_state.lock().expect("git state lock poisoned");
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == expected_cleanup_worktree.as_str()
    )));
    assert!(!git.calls.iter().any(|call| matches!(
        call,
        GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == unrelated_cleanup_worktree.as_str()
    )));
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::DeleteLocalBranch {
            branch,
            force: false,
            ..
        } if branch == "odt/task-1"
    )));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_direct_merge_local_only_closes_task_records_metadata_and_cleans_builder_workspace(
) -> Result<()> {
    let root = unique_temp_path("approval-direct-merge-local-only");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    let _ = run_git(&repo, &["remote", "remove", "origin"]);
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    let mut repo_config = base_repo_config(&worktree_base);
    repo_config.default_target_branch = host_infra_system::GitTargetBranch {
        remote: None,
        branch: "release/2026.03".to_string(),
    };
    service.workspace_update_repo_config(repo_path.as_str(), repo_config)?;

    let task = service.task_direct_merge(
        repo_path.as_str(),
        "task-1",
        GitMergeMethod::Squash,
        Some("feat: release work".to_string()),
    )?;
    let host_domain::TaskDirectMergeResult::Completed { task } = task else {
        panic!("expected completed direct merge result");
    };
    assert_eq!(task.status, TaskStatus::Closed);

    let git = git_state.lock().expect("git state lock poisoned");
    assert!(git
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::RemoveWorktree { .. })));
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::DeleteLocalBranch {
            branch,
            force: true,
            ..
        } if branch == "odt/task-1"
    )));
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::MergeBranch {
            source_branch,
            target_branch,
            method,
            squash_commit_message,
            ..
        } if source_branch == "odt/task-1"
            && target_branch == "release/2026.03"
            && *method == GitMergeMethod::Squash
            && squash_commit_message.as_deref() == Some("feat: release work")
    )));
    assert!(!git
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::SuggestedSquashCommitMessage { .. })));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_direct_merge_complete_uses_safe_branch_delete_when_squash_branch_is_already_merged(
) -> Result<()> {
    let root = unique_temp_path("approval-direct-merge-complete-squash-up-to-date");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), base_repo_config(&worktree_base))?;

    task_state
        .lock()
        .expect("task state lock poisoned")
        .direct_merge_records
        .insert(
            "task-1".to_string(),
            host_domain::DirectMergeRecord {
                method: GitMergeMethod::Squash,
                source_branch: "odt/task-1".to_string(),
                target_branch: host_domain::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                merged_at: "2026-03-18T12:00:00Z".to_string(),
            },
        );
    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.commits_ahead_behind_result = host_domain::GitAheadBehind {
            ahead: 0,
            behind: 0,
        };
        git.is_ancestor_result = true;
    }

    let completed = service.task_direct_merge_complete(repo_path.as_str(), "task-1")?;
    assert_eq!(completed.status, TaskStatus::Closed);

    let git = git_state.lock().expect("git state lock poisoned");
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::IsAncestor {
            ancestor_ref,
            descendant_ref,
            ..
        } if ancestor_ref == "odt/task-1" && descendant_ref == "main"
    )));
    assert!(git.calls.iter().any(|call| matches!(
        call,
        GitCall::DeleteLocalBranch {
            branch,
            force: false,
            ..
        } if branch == "odt/task-1"
    )));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_approval_context_uses_pending_direct_merge_metadata_without_builder_worktree() -> Result<()>
{
    let root = unique_temp_path("approval-direct-merge-reopen");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let missing_worktree_path = worktree_base.join("missing").join("task-1");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), base_repo_config(&worktree_base))?;
    service.workspace_merge_repo_config(
        repo_path.as_str(),
        RepoConfigUpdate {
            default_target_branch: Some(host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "beta".to_string(),
            }),
            ..RepoConfigUpdate::default()
        },
    )?;

    let mut session = make_session("task-1", "session-build");
    session.working_directory = missing_worktree_path.to_string_lossy().to_string();
    let mut state = task_state.lock().expect("task state lock poisoned");
    state.agent_sessions.push(session);
    state.direct_merge_records.insert(
        "task-1".to_string(),
        host_domain::DirectMergeRecord {
            method: GitMergeMethod::Rebase,
            source_branch: "odt/task-1".to_string(),
            target_branch: host_domain::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            merged_at: "2026-03-12T12:00:00Z".to_string(),
        },
    );
    drop(state);
    let _ = fs::remove_dir_all(&missing_worktree_path);
    assert!(!missing_worktree_path.exists());

    let approval = service.task_approval_context_get(repo_path.as_str(), "task-1")?;
    assert_eq!(approval.working_directory, None);
    assert_eq!(approval.source_branch, "odt/task-1");
    assert_eq!(approval.target_branch.checkout_branch(), "main");
    assert_eq!(
        approval.publish_target.map(|target| target.canonical()),
        Some("origin/main".to_string())
    );
    let direct_merge = approval
        .direct_merge
        .ok_or_else(|| anyhow!("direct merge metadata missing"))?;
    assert_eq!(direct_merge.method, GitMergeMethod::Rebase);
    assert_eq!(direct_merge.target_branch.canonical(), "origin/main");
    assert_eq!(direct_merge.merged_at, "2026-03-12T12:00:00Z");

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_approval_context_reports_global_merge_default_and_dirty_worktree() -> Result<()> {
    let root = unique_temp_path("approval-context-dirty");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &_task_state,
        &git_state,
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), base_repo_config(&worktree_base))?;
    service.workspace_update_global_git_config(host_infra_system::GlobalGitConfig {
        default_merge_method: host_infra_system::GitMergeMethod::Rebase,
    })?;

    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.worktree_status_data = Some(host_domain::GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "modified".to_string(),
                staged: false,
            }],
            file_diffs: Vec::new(),
            target_ahead_behind: host_domain::GitAheadBehind {
                ahead: 0,
                behind: 0,
            },
            upstream_ahead_behind: host_domain::GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        });
    }

    let approval = service.task_approval_context_get(repo_path.as_str(), "task-1")?;
    assert_eq!(approval.default_merge_method, GitMergeMethod::Rebase);
    assert!(approval.has_uncommitted_changes);
    assert_eq!(approval.uncommitted_file_count, 1);
    assert_eq!(
        approval.suggested_squash_commit_message.as_deref(),
        Some("feat: builder change")
    );
    Ok(())
}

#[test]
fn approval_actions_reject_dirty_builder_worktree() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-dirty-actions");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "0");
    let _auth_error_guard = set_env_var(
        "ODT_GH_AUTH_ERROR",
        "GitHub authentication is not configured. Run gh auth login.",
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    run_git(&repo, &["remote", "remove", "origin"])?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;

    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.worktree_status_data = Some(host_domain::GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/lib.rs".to_string(),
                status: "modified".to_string(),
                staged: false,
            }],
            file_diffs: Vec::new(),
            target_ahead_behind: host_domain::GitAheadBehind {
                ahead: 0,
                behind: 0,
            },
            upstream_ahead_behind: host_domain::GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        });
    }

    let merge_error = service
        .task_direct_merge(
            repo_path.as_str(),
            "task-1",
            GitMergeMethod::MergeCommit,
            None,
        )
        .expect_err("direct merge should be blocked");
    assert!(merge_error.to_string().contains("uncommitted"));

    let pr_error = service
        .task_pull_request_upsert(repo_path.as_str(), "task-1", "Title", "Body")
        .expect_err("pull request should be blocked");
    assert!(pr_error.to_string().contains("uncommitted"));

    Ok(())
}

#[test]
fn human_request_changes_rejects_pending_direct_merge_completion() -> Result<()> {
    let root = unique_temp_path("approval-direct-merge-request-changes");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .direct_merge_records
        .insert(
            "task-1".to_string(),
            host_domain::DirectMergeRecord {
                method: GitMergeMethod::MergeCommit,
                source_branch: "odt/task-1".to_string(),
                target_branch: host_domain::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                merged_at: "2026-03-12T12:00:00Z".to_string(),
            },
        );

    let error = service
        .human_request_changes(repo_path.as_str(), "task-1", None)
        .expect_err("pending direct merge should block request changes");
    assert!(error.to_string().contains("local direct merge"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert_eq!(
        state
            .tasks
            .iter()
            .find(|task| task.id == "task-1")
            .map(|task| &task.status),
        Some(&TaskStatus::HumanReview)
    );
    let direct_merge = state
        .direct_merge_records
        .get("task-1")
        .ok_or_else(|| anyhow!("pending direct merge missing after rejection"))?;
    assert_eq!(direct_merge.method, GitMergeMethod::MergeCommit);
    assert_eq!(direct_merge.source_branch, "odt/task-1");
    assert_eq!(direct_merge.target_branch.canonical(), "origin/main");
    assert_eq!(direct_merge.merged_at, "2026-03-12T12:00:00Z");

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_approval_context_reports_pull_request_unavailable_when_github_auth_is_missing() -> Result<()>
{
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-auth-unavailable");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "0");
    let _auth_error_guard = set_env_var(
        "ODT_GH_AUTH_ERROR",
        "GitHub authentication is not configured. Run gh auth login.",
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    let _ = run_git(&repo, &["remote", "remove", "origin"]);
    run_git(
        &repo,
        &[
            "remote",
            "add",
            "upstream",
            "git@github.com:someone/else.git",
        ],
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;

    let context = service.task_approval_context_get(repo_path.as_str(), "task-1")?;
    let github = context
        .providers
        .iter()
        .find(|provider| provider.provider_id == "github")
        .ok_or_else(|| anyhow!("github provider missing"))?;
    assert!(!github.available);
    assert!(github
        .reason
        .as_deref()
        .unwrap_or_default()
        .contains("gh auth login"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_approval_context_uses_configured_github_host_for_auth_status() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-auth-host");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    configure_github_remote(&repo, "upstream", "github.mycorp.com")?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        github_repo_config_for_host(&worktree_base, "github.mycorp.com"),
    )?;

    let context = service.task_approval_context_get(repo_path.as_str(), "task-1")?;
    let github = context
        .providers
        .iter()
        .find(|provider| provider.provider_id == "github")
        .ok_or_else(|| anyhow!("github provider missing"))?;
    assert!(github.available);

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(gh_log_contents.contains("auth status --hostname github.mycorp.com"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_unlink_clears_linked_pull_request() -> Result<()> {
    let root = unique_temp_path("approval-pr-unlink");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    let _ = run_git(&repo, &["remote", "remove", "origin"]);
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .insert(
            "task-1".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:05:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );

    assert!(service.task_pull_request_unlink(repo_path.as_str(), "task-1")?);
    assert!(!task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .contains_key("task-1"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_upsert_creates_pr_and_transitions_ai_review_to_human_review() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-create");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    let create_response = root.join("create.json");
    let update_response = root.join("update.json");
    let fetch_response = root.join("fetch.json");
    init_git_repo(&repo)?;
    write_json(
        &create_response,
        r#"{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Create PR","draft":false,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:00:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"main"}}"#,
    )?;
    write_json(&update_response, "{}")?;
    write_json(&fetch_response, "{}")?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());
    let _create_guard = set_env_var(
        "ODT_GH_CREATE_RESPONSE",
        create_response.to_string_lossy().as_ref(),
    );
    let _update_guard = set_env_var(
        "ODT_GH_UPDATE_RESPONSE",
        update_response.to_string_lossy().as_ref(),
    );
    let _fetch_guard = set_env_var(
        "ODT_GH_FETCH_RESPONSE",
        fetch_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    let _ = run_git(&repo, &["remote", "remove", "origin"]);
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;

    let linked =
        service.task_pull_request_upsert(repo_path.as_str(), "task-1", "Create PR", "Body")?;
    assert_eq!(linked.number, 17);
    assert_eq!(linked.state, "open");

    let state = task_state.lock().expect("task state lock poisoned");
    assert_eq!(
        state
            .pull_requests
            .get("task-1")
            .map(|entry| entry.url.as_str()),
        Some("https://github.com/openai/openducktor/pull/17"),
    );
    let task = state
        .tasks
        .iter()
        .find(|task| task.id == "task-1")
        .ok_or_else(|| anyhow!("task not found after PR upsert"))?;
    assert_eq!(task.status, TaskStatus::HumanReview);
    drop(state);

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(gh_log_contents.contains("api --method POST repos/openai/openducktor/pulls"));
    assert!(gh_log_contents.contains("base=main"));
    assert!(gh_log_contents.contains("title=Create PR"));
    assert_eq!(
        git_state
            .lock()
            .expect("git state lock poisoned")
            .last_push_remote
            .as_deref(),
        Some("origin"),
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_upsert_reuses_existing_open_pull_request() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-update");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    let create_response = root.join("create.json");
    let update_response = root.join("update.json");
    let fetch_response = root.join("fetch.json");
    init_git_repo(&repo)?;
    write_json(&create_response, "{}")?;
    write_json(
        &update_response,
        r#"{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Updated PR","draft":false,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:05:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"main"}}"#,
    )?;
    write_json(&fetch_response, "{}")?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());
    let _create_guard = set_env_var(
        "ODT_GH_CREATE_RESPONSE",
        create_response.to_string_lossy().as_ref(),
    );
    let _update_guard = set_env_var(
        "ODT_GH_UPDATE_RESPONSE",
        update_response.to_string_lossy().as_ref(),
    );
    let _fetch_guard = set_env_var(
        "ODT_GH_FETCH_RESPONSE",
        fetch_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    configure_github_remote(&repo, "upstream", "github.mycorp.com")?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        github_repo_config_for_host(&worktree_base, "github.mycorp.com"),
    )?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .insert(
            "task-1".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );

    let linked =
        service.task_pull_request_upsert(repo_path.as_str(), "task-1", "Updated PR", "Body")?;
    assert_eq!(linked.number, 17);

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(gh_log_contents.contains(
        "--hostname github.mycorp.com api --method PATCH repos/openai/openducktor/pulls/17"
    ));
    assert!(!gh_log_contents.contains("api --method POST repos/openai/openducktor/pulls"));
    assert_eq!(
        git_state
            .lock()
            .expect("git state lock poisoned")
            .last_push_remote
            .as_deref(),
        Some("upstream"),
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_upsert_reuses_existing_draft_pull_request() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-update-draft");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    let create_response = root.join("create.json");
    let update_response = root.join("update.json");
    let fetch_response = root.join("fetch.json");
    init_git_repo(&repo)?;
    write_json(&create_response, "{}")?;
    write_json(
        &update_response,
        r#"{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Updated Draft PR","draft":true,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:05:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"main"}}"#,
    )?;
    write_json(&fetch_response, "{}")?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());
    let _create_guard = set_env_var(
        "ODT_GH_CREATE_RESPONSE",
        create_response.to_string_lossy().as_ref(),
    );
    let _update_guard = set_env_var(
        "ODT_GH_UPDATE_RESPONSE",
        update_response.to_string_lossy().as_ref(),
    );
    let _fetch_guard = set_env_var(
        "ODT_GH_FETCH_RESPONSE",
        fetch_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .insert(
            "task-1".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "draft".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );

    let linked = service.task_pull_request_upsert(
        repo_path.as_str(),
        "task-1",
        "Updated Draft PR",
        "Body",
    )?;
    assert_eq!(linked.number, 17);
    assert_eq!(linked.state, "draft");

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(gh_log_contents.contains("api --method PATCH repos/openai/openducktor/pulls/17"));
    assert!(!gh_log_contents.contains("api --method POST repos/openai/openducktor/pulls"));
    assert_eq!(
        git_state
            .lock()
            .expect("git state lock poisoned")
            .last_push_remote
            .as_deref(),
        Some("origin"),
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_links_existing_pull_request_for_builder_branch() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-detect-link");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let list_response = root.join("list.json");
    init_git_repo(&repo)?;
    write_json(
        &list_response,
        r#"[{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Existing PR","draft":false,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:10:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"main"}}]"#,
    )?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _list_guard = set_env_var(
        "ODT_GH_LIST_RESPONSE",
        list_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;

    let detected = service.task_pull_request_detect(repo_path.as_str(), "task-1")?;
    match detected {
        TaskPullRequestDetectResult::Linked { pull_request } => {
            assert_eq!(pull_request.provider_id, "github");
            assert_eq!(pull_request.number, 17);
            assert_eq!(
                pull_request.url,
                "https://github.com/openai/openducktor/pull/17"
            );
            assert_eq!(pull_request.state, "open");
            assert_eq!(pull_request.created_at, "2026-03-11T10:00:00Z");
            assert_eq!(pull_request.updated_at, "2026-03-11T10:10:00Z");
            assert!(pull_request.last_synced_at.is_some());
            assert_eq!(pull_request.merged_at, None);
            assert_eq!(pull_request.closed_at, None);
        }
        other => return Err(anyhow!("expected linked detection result, got {other:?}")),
    }

    let state = task_state.lock().expect("task state lock poisoned");
    let task = state
        .tasks
        .iter()
        .find(|task| task.id == "task-1")
        .ok_or_else(|| anyhow!("task not found after detect"))?;
    assert_eq!(task.status, TaskStatus::AiReview);
    let pull_request = state
        .pull_requests
        .get("task-1")
        .ok_or_else(|| anyhow!("pull request not linked"))?;
    assert_eq!(pull_request.number, 17);
    assert_eq!(pull_request.state, "open");
    assert!(pull_request.last_synced_at.is_some());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_finds_pull_request_even_when_base_differs_from_default_target_branch(
) -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-detect-ignores-base");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    let list_response = root.join("list.json");
    init_git_repo(&repo)?;
    write_json(
        &list_response,
        r#"[{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Existing PR","draft":false,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:10:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"develop"}}]"#,
    )?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());
    let _list_guard = set_env_var(
        "ODT_GH_LIST_RESPONSE",
        list_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    let mut repo_config = github_repo_config(&worktree_base);
    repo_config.default_target_branch.branch = "origin/main".to_string();
    service.workspace_update_repo_config(repo_path.as_str(), repo_config)?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;

    let detected = service.task_pull_request_detect(repo_path.as_str(), "task-1")?;
    match detected {
        TaskPullRequestDetectResult::Linked { pull_request } => {
            assert_eq!(pull_request.number, 17);
        }
        other => return Err(anyhow!("expected linked detection result, got {other:?}")),
    }

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(!gh_log_contents.contains("base=main"));
    assert!(gh_log_contents.contains("head=openai:odt/task-1"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_queries_by_branch_with_head_owner_filter() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-detect-branch-query");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    let list_response = root.join("list.json");
    init_git_repo(&repo)?;
    write_json(
        &list_response,
        r#"[{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Existing PR","draft":false,"state":"open","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:10:00Z","merged_at":null,"closed_at":null,"head":{"ref":"odt/task-1"},"base":{"ref":"main"}}]"#,
    )?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());
    let _list_guard = set_env_var(
        "ODT_GH_LIST_RESPONSE",
        list_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;

    let detected = service.task_pull_request_detect(repo_path.as_str(), "task-1")?;
    match detected {
        TaskPullRequestDetectResult::Linked { pull_request } => {
            assert_eq!(pull_request.number, 17);
        }
        other => return Err(anyhow!("expected linked detection result, got {other:?}")),
    }

    let gh_log_contents = fs::read_to_string(&gh_log)?;
    assert!(gh_log_contents.contains("api --method GET repos/openai/openducktor/pulls"));
    assert!(gh_log_contents.contains("head=openai:odt/task-1"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_returns_not_found_when_no_pull_request_matches() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-detect-not-found");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;

    let detected = service.task_pull_request_detect(repo_path.as_str(), "task-1")?;
    assert_eq!(
        detected,
        TaskPullRequestDetectResult::NotFound {
            source_branch: "odt/task-1".to_string(),
            target_branch: "main".to_string(),
        }
    );
    assert!(!task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .contains_key("task-1"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_rejects_tasks_that_already_have_a_linked_pull_request() -> Result<()> {
    let root = unique_temp_path("approval-pr-detect-existing-link");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .insert(
            "task-1".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:05:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );

    let error = service
        .task_pull_request_detect(repo_path.as_str(), "task-1")
        .expect_err("existing linked pull request should block detection");
    assert!(error
        .to_string()
        .contains("Task task-1 already has a linked pull request."));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn task_pull_request_detect_requires_matching_push_remote() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-detect-missing-remote");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    run_git(&repo, &["remote", "remove", "origin"])?;

    let error = service
        .task_pull_request_detect(repo_path.as_str(), "task-1")
        .expect_err("missing GitHub remote should block detection");
    assert!(error
        .to_string()
        .contains("No git remote matches the configured GitHub repository"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn repo_pull_request_sync_closes_tasks_when_linked_pull_request_is_merged() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-sync");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let create_response = root.join("create.json");
    let update_response = root.join("update.json");
    let fetch_response = root.join("fetch.json");
    init_git_repo(&repo)?;
    fs::create_dir_all(&worktree_path)?;
    write_json(&create_response, "{}")?;
    write_json(&update_response, "{}")?;
    write_json(
        &fetch_response,
        r#"{"number":17,"html_url":"https://github.com/openai/openducktor/pull/17","title":"Merged PR","draft":false,"state":"closed","created_at":"2026-03-11T10:00:00Z","updated_at":"2026-03-11T10:10:00Z","merged_at":"2026-03-11T10:10:00Z","closed_at":"2026-03-11T10:10:00Z","head":{"ref":"odt/task-1"},"base":{"ref":"main"}}"#,
    )?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _create_guard = set_env_var(
        "ODT_GH_CREATE_RESPONSE",
        create_response.to_string_lossy().as_ref(),
    );
    let _update_guard = set_env_var(
        "ODT_GH_UPDATE_RESPONSE",
        update_response.to_string_lossy().as_ref(),
    );
    let _fetch_guard = set_env_var(
        "ODT_GH_FETCH_RESPONSE",
        fetch_response.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;
    task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .insert(
            "task-1".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
    {
        let mut git = git_state.lock().expect("git state lock poisoned");
        git.branches = vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }];
    }

    assert!(service.repo_pull_request_sync(repo_path.as_str())?);

    let state = task_state.lock().expect("task state lock poisoned");
    let task = state
        .tasks
        .iter()
        .find(|task| task.id == "task-1")
        .ok_or_else(|| anyhow!("task not found after sync"))?;
    assert_eq!(task.status, TaskStatus::Closed);
    assert_eq!(
        state
            .pull_requests
            .get("task-1")
            .map(|entry| entry.state.as_str()),
        Some("merged"),
    );
    drop(state);

    let git = git_state.lock().expect("git state lock poisoned");
    assert!(git
        .calls
        .iter()
        .any(|call| matches!(call, GitCall::RemoveWorktree { .. })));
    assert!(git.calls.iter().any(
        |call| matches!(call, GitCall::DeleteLocalBranch { branch, .. } if branch == "odt/task-1")
    ));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn repo_pull_request_sync_does_not_discover_pull_requests_for_unlinked_tasks() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-sync-no-discovery");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    let worktree_path = worktree_base.join("task-1");
    let gh_log = root.join("gh.log");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");
    let _gh_log_guard = set_env_var("ODT_GH_LOG_FILE", gh_log.to_string_lossy().as_ref());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    configure_builder_session(
        repo_path.as_str(),
        &worktree_path,
        "odt/task-1",
        &service,
        &task_state,
        &git_state,
    )?;

    assert!(service.repo_pull_request_sync(repo_path.as_str())?);
    assert!(!task_state
        .lock()
        .expect("task state lock poisoned")
        .pull_requests
        .contains_key("task-1"));
    assert!(!gh_log.exists() || fs::read_to_string(&gh_log)?.trim().is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn repo_pull_request_sync_ignores_terminal_tasks_and_terminal_pull_requests() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-pr-sync-skip-terminal");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    init_git_repo(&repo)?;

    let bin_dir = write_fake_gh(&root)?;
    let _path_guard = prepend_path(&bin_dir);
    let _auth_ok_guard = set_env_var("ODT_GH_AUTH_OK", "1");
    let _auth_login_guard = set_env_var("ODT_GH_AUTH_LOGIN", "octocat");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![
            make_task("task-open-merged", "task", TaskStatus::HumanReview),
            make_task("task-closed-open", "task", TaskStatus::Closed),
            make_task("task-deferred-draft", "task", TaskStatus::Deferred),
        ],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(repo_path.as_str(), github_repo_config(&worktree_base))?;
    {
        let mut state = task_state.lock().expect("task state lock poisoned");
        state.pull_requests.insert(
            "task-open-merged".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "merged".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:10:00Z".to_string(),
                last_synced_at: None,
                merged_at: Some("2026-03-11T10:10:00Z".to_string()),
                closed_at: Some("2026-03-11T10:10:00Z".to_string()),
            },
        );
        state.pull_requests.insert(
            "task-closed-open".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
        state.pull_requests.insert(
            "task-deferred-draft".to_string(),
            host_domain::PullRequestRecord {
                provider_id: "github".to_string(),
                number: 17,
                url: "https://github.com/openai/openducktor/pull/17".to_string(),
                state: "draft".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
                updated_at: "2026-03-11T10:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
    }

    assert!(service.repo_pull_request_sync(repo_path.as_str())?);

    let state = task_state.lock().expect("task state lock poisoned");
    assert_eq!(
        state
            .tasks
            .iter()
            .find(|task| task.id == "task-open-merged")
            .map(|task| &task.status),
        Some(&TaskStatus::HumanReview),
    );
    assert_eq!(
        state
            .tasks
            .iter()
            .find(|task| task.id == "task-closed-open")
            .map(|task| &task.status),
        Some(&TaskStatus::Closed),
    );
    assert_eq!(
        state
            .tasks
            .iter()
            .find(|task| task.id == "task-deferred-draft")
            .map(|task| &task.status),
        Some(&TaskStatus::Deferred),
    );
    assert_eq!(
        state
            .pull_requests
            .get("task-open-merged")
            .and_then(|entry| entry.last_synced_at.as_ref()),
        None,
    );
    assert_eq!(
        state
            .pull_requests
            .get("task-closed-open")
            .and_then(|entry| entry.last_synced_at.as_ref()),
        None,
    );
    assert_eq!(
        state
            .pull_requests
            .get("task-deferred-draft")
            .and_then(|entry| entry.last_synced_at.as_ref()),
        None,
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn auto_detect_git_provider_enables_github_from_remote_when_gh_is_missing() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("approval-auto-detect");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    run_git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "git@github.com:openai/openducktor.git",
        ],
    )?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;

    service.auto_detect_git_provider_for_repo(repo_path.as_str())?;

    let repo_config = service.workspace_get_repo_config(repo_path.as_str())?;
    let github = repo_config
        .git
        .providers
        .get("github")
        .ok_or_else(|| anyhow!("github provider was not detected"))?;
    assert!(github.enabled);
    assert!(github.auto_detected);
    assert_eq!(
        github
            .repository
            .as_ref()
            .map(|repository| repository.owner.as_str()),
        Some("openai"),
    );
    assert_eq!(
        github
            .repository
            .as_ref()
            .map(|repository| repository.name.as_str()),
        Some("openducktor"),
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn auto_detect_git_provider_preserves_explicit_github_disable() -> Result<()> {
    let root = unique_temp_path("approval-auto-detect-disabled");
    let repo = root.join("repo");
    let worktree_base = root.join("worktrees");
    init_git_repo(&repo)?;
    run_git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "git@github.com:openai/openducktor.git",
        ],
    )?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    let mut repo_config = github_repo_config(&worktree_base);
    repo_config.git.providers.insert(
        "github".to_string(),
        GitProviderConfig {
            enabled: false,
            auto_detected: false,
            repository: Some(GitProviderRepository {
                host: "github.com".to_string(),
                owner: "openai".to_string(),
                name: "openducktor".to_string(),
            }),
        },
    );
    service.workspace_update_repo_config(repo_path.as_str(), repo_config)?;

    service.auto_detect_git_provider_for_repo(repo_path.as_str())?;

    let repo_config = service.workspace_get_repo_config(repo_path.as_str())?;
    let github = repo_config
        .git
        .providers
        .get("github")
        .ok_or_else(|| anyhow!("github provider should remain configured"))?;
    assert!(!github.enabled);
    assert_eq!(
        github
            .repository
            .as_ref()
            .map(|repository| repository.owner.as_str()),
        Some("openai"),
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}
