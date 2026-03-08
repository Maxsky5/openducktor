use anyhow::Result;
use host_domain::{GitCurrentBranch, RunEvent, RunState, RunSummary, TaskStatus, UpdateTaskPatch};
use host_infra_system::{HookSet, RepoConfig};
use std::fs;
use std::sync::{Arc, Mutex};

use crate::app_service::test_support::{
    build_service_with_git_state_enforced, make_emitter, make_task, spawn_sleep_process,
    unique_temp_path,
};
use crate::app_service::RunProcess;

#[test]
fn tasks_reject_repo_path_not_in_workspace_allowlist() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let error = service
        .tasks_list("/tmp/odt-repo-unauthorized-task")
        .expect_err("unconfigured repo path should be rejected");

    assert!(error.to_string().contains("workspace allowlist"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
}

#[test]
fn task_update_rejects_unauthorized_repo_before_status_validation() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let error = service
        .task_update(
            "/tmp/odt-repo-unauthorized-task-update",
            "task-1",
            UpdateTaskPatch {
                title: None,
                description: None,
                acceptance_criteria: None,
                notes: None,
                status: Some(TaskStatus::Closed),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
            },
        )
        .expect_err("unconfigured repo path should be rejected before patch validation");

    assert!(error.to_string().contains("workspace allowlist"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
    assert!(state.updated_patches.is_empty());
}

#[test]
fn spec_mutators_reject_unauthorized_repo_before_markdown_validation() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let set_spec_error = service
        .set_spec("/tmp/odt-repo-unauthorized-spec", "task-1", "   ")
        .expect_err("unconfigured repo path should be rejected before markdown validation");
    assert!(set_spec_error.to_string().contains("workspace allowlist"));

    let save_spec_error = service
        .save_spec_document("/tmp/odt-repo-unauthorized-spec", "task-1", "   ")
        .expect_err("unconfigured repo path should be rejected before markdown validation");
    assert!(save_spec_error.to_string().contains("workspace allowlist"));

    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
    assert!(state.spec_set_calls.is_empty());
}

#[test]
fn plan_mutators_reject_unauthorized_repo_before_markdown_validation() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let set_plan_error = service
        .set_plan("/tmp/odt-repo-unauthorized-plan", "task-1", "   ", None)
        .expect_err("unconfigured repo path should be rejected before markdown validation");
    assert!(set_plan_error.to_string().contains("workspace allowlist"));

    let save_plan_error = service
        .save_plan_document("/tmp/odt-repo-unauthorized-plan", "task-1", "   ")
        .expect_err("unconfigured repo path should be rejected before markdown validation");
    assert!(save_plan_error.to_string().contains("workspace allowlist"));

    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
    assert!(state.plan_set_calls.is_empty());
}

#[test]
fn git_rejects_repo_path_not_in_workspace_allowlist() {
    let (service, task_state, git_state) = build_service_with_git_state_enforced(
        vec![],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let error = service
        .git_get_branches("/tmp/odt-repo-unauthorized-git")
        .expect_err("unconfigured repo path should be rejected");

    assert!(error.to_string().contains("workspace allowlist"));
    let task_state = task_state.lock().expect("task state lock poisoned");
    assert!(task_state.ensure_calls.is_empty());
    let git_state = git_state.lock().expect("git state lock poisoned");
    assert!(git_state.calls.is_empty());
}

#[test]
fn build_rejects_repo_path_not_in_workspace_allowlist() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let error = service
        .build_start(
            "/tmp/odt-repo-unauthorized-build",
            "task-1",
            make_emitter(events),
        )
        .expect_err("unconfigured repo path should be rejected");

    assert!(error.to_string().contains("workspace allowlist"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
}

#[test]
fn canonical_repo_path_variants_are_authorized() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let root = unique_temp_path("repo-auth-canonical");
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git"))?;

    let canonical_repo = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    service.workspace_add(canonical_repo.as_str())?;
    service.workspace_update_repo_config(canonical_repo.as_str(), Default::default())?;

    let repo_variant = format!("{}/.", canonical_repo);
    let tasks = service.tasks_list(repo_variant.as_str())?;
    assert_eq!(tasks.len(), 1);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn workspace_update_repo_config_cannot_register_new_allowlist_entries() {
    let (service, _task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let unknown_repo_path = "/tmp/odt-repo-unauthorized-config";
    let error = service
        .workspace_update_repo_config(
            unknown_repo_path,
            RepoConfig {
                worktree_base_path: Some("/tmp/wt".to_string()),
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                worktree_file_copies: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect_err("updating unknown workspace should fail");
    assert!(error.to_string().contains("Workspace not found in config"));

    let task_error = service
        .tasks_list(unknown_repo_path)
        .expect_err("unknown path must still be blocked");
    assert!(task_error.to_string().contains("workspace allowlist"));
}

#[test]
fn runs_list_without_filter_hides_non_allowlisted_runs() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch { name: Some("main".to_string()), detached: false, revision: None },
    );

    let run_id = "run-outside-allowlist".to_string();
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            run_id.clone(),
            RunProcess {
                summary: RunSummary {
                    run_id: run_id.clone(),
                    repo_path: "/tmp/outside-allowlist".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/outside-allowlist".to_string(),
                    port: 4010,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-28T16:00:00Z".to_string(),
                },
                child: spawn_sleep_process(30),
                _opencode_process_guard: None,
                repo_path: "/tmp/outside-allowlist".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/outside-allowlist".to_string(),
                repo_config: RepoConfig::default(),
            },
        );

    let listed = service.runs_list(None)?;
    assert!(
        listed.is_empty(),
        "non-allowlisted runs must be hidden when no filter is provided"
    );

    let _ = service.shutdown();
    Ok(())
}
