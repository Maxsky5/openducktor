use anyhow::Result;
use host_domain::{GitCurrentBranch, RunEvent, TaskStatus};
use std::fs;
use std::sync::{Arc, Mutex};

use crate::app_service::test_support::{
    build_service_with_git_state_enforced, make_emitter, make_task, unique_temp_path,
};

#[test]
fn tasks_reject_repo_path_not_in_workspace_allowlist() {
    let (service, task_state, _git_state) = build_service_with_git_state_enforced(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .tasks_list("/tmp/odt-repo-unauthorized-task")
        .expect_err("unconfigured repo path should be rejected");

    assert!(error.to_string().contains("workspace allowlist"));
    let state = task_state.lock().expect("task state lock poisoned");
    assert!(state.ensure_calls.is_empty());
}

#[test]
fn git_rejects_repo_path_not_in_workspace_allowlist() {
    let (service, task_state, git_state) = build_service_with_git_state_enforced(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
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
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
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
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let root = unique_temp_path("repo-auth-canonical");
    let repo = root.join("repo");
    fs::create_dir_all(&repo)?;

    let canonical_repo = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    service.workspace_update_repo_config(canonical_repo.as_str(), Default::default())?;

    let repo_variant = format!("{}/.", canonical_repo);
    let tasks = service.tasks_list(repo_variant.as_str())?;
    assert_eq!(tasks.len(), 1);

    let _ = fs::remove_dir_all(root);
    Ok(())
}
