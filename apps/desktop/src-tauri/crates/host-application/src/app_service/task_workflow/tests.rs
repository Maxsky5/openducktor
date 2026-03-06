use crate::app_service::test_support::{build_service_with_state, make_task};
use host_domain::{TaskStatus, UpdateTaskPatch};

#[test]
fn module_task_update_rejects_direct_status_patch() {
    let (service, _task_state, _git_state) =
        build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

    let patch = UpdateTaskPatch {
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
    };

    let error = service
        .task_update("/tmp/odt-repo-module", "task-1", patch)
        .expect_err("status patch should be rejected");

    assert!(error
        .to_string()
        .contains("Status cannot be updated directly"));
}

#[test]
fn module_task_resume_deferred_requires_deferred_status() {
    let (service, _task_state, _git_state) =
        build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

    let error = service
        .task_resume_deferred("/tmp/odt-repo-module", "task-1")
        .expect_err("resume should fail outside deferred status");

    assert!(error.to_string().contains("Task is not deferred: task-1"));
}
