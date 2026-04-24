use anyhow::Result;
use host_domain::{GitCurrentBranch, IssueType, PlanSubtaskInput, TaskStatus};

use crate::app_service::test_support::{build_service_with_git_state, make_task};

fn main_branch() -> GitCurrentBranch {
    GitCurrentBranch {
        name: Some("main".to_string()),
        detached: false,
        revision: None,
    }
}

#[test]
fn set_spec_allows_active_and_review_statuses_without_status_transition() -> Result<()> {
    for status in [
        TaskStatus::Blocked,
        TaskStatus::InProgress,
        TaskStatus::AiReview,
        TaskStatus::HumanReview,
    ] {
        let repo_path = format!("/tmp/odt-repo-spec-active-{}", status.as_cli_value());
        let (service, task_state, _git_state) = build_service_with_git_state(
            vec![make_task("task-1", "task", status.clone())],
            vec![],
            main_branch(),
        );

        let spec = service.set_spec(repo_path.as_str(), "task-1", "  # Revised Spec  ")?;
        assert_eq!(spec.markdown, "# Revised Spec");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.spec_set_calls,
            vec![("task-1".to_string(), "# Revised Spec".to_string())]
        );
        assert!(
            !task_state
                .updated_patches
                .iter()
                .any(|(_, patch)| patch.status.is_some()),
            "status update should be skipped for {}",
            status.as_cli_value()
        );
    }

    Ok(())
}

#[test]
fn set_spec_rejects_deferred_and_closed_statuses() {
    for status in [TaskStatus::Deferred, TaskStatus::Closed] {
        let repo_path = format!("/tmp/odt-repo-spec-invalid-{}", status.as_cli_value());
        let (service, task_state, _git_state) = build_service_with_git_state(
            vec![make_task("task-1", "task", status)],
            vec![],
            main_branch(),
        );

        let error = service
            .set_spec(repo_path.as_str(), "task-1", "# Spec")
            .expect_err("set_spec should be blocked in deferred/closed");
        assert!(error.to_string().contains("set_spec is only allowed"));
        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.spec_set_calls.is_empty());
    }
}

#[test]
fn set_plan_allows_active_and_review_statuses_without_status_transition() -> Result<()> {
    for issue_type in ["task", "bug", "feature", "epic"] {
        for status in [
            TaskStatus::Blocked,
            TaskStatus::InProgress,
            TaskStatus::AiReview,
            TaskStatus::HumanReview,
        ] {
            let repo_path = format!(
                "/tmp/odt-repo-plan-active-{issue_type}-{}",
                status.as_cli_value()
            );
            let (service, task_state, _git_state) = build_service_with_git_state(
                vec![make_task("task-1", issue_type, status.clone())],
                vec![],
                main_branch(),
            );

            let plan =
                service.set_plan(repo_path.as_str(), "task-1", "  # Revised Plan  ", None)?;
            assert_eq!(plan.markdown, "# Revised Plan");

            let task_state = task_state.lock().expect("task lock poisoned");
            assert_eq!(
                task_state.plan_set_calls,
                vec![("task-1".to_string(), "# Revised Plan".to_string())]
            );
            assert!(task_state.created_inputs.is_empty());
            assert!(task_state.delete_calls.is_empty());
            assert!(
                !task_state
                    .updated_patches
                    .iter()
                    .any(|(_, patch)| patch.status.is_some()),
                "status update should be skipped for {issue_type} {}",
                status.as_cli_value()
            );
        }
    }

    Ok(())
}

#[test]
fn set_plan_rejects_deferred_and_closed_statuses() {
    for issue_type in ["task", "bug", "feature", "epic"] {
        for status in [TaskStatus::Deferred, TaskStatus::Closed] {
            let repo_path = format!(
                "/tmp/odt-repo-plan-invalid-{issue_type}-{}",
                status.as_cli_value()
            );
            let (service, task_state, _git_state) = build_service_with_git_state(
                vec![make_task("task-1", issue_type, status)],
                vec![],
                main_branch(),
            );

            let error = service
                .set_plan(repo_path.as_str(), "task-1", "# Plan", None)
                .expect_err("set_plan should be blocked in deferred/closed");
            assert!(error.to_string().contains("set_plan is not allowed"));
            let task_state = task_state.lock().expect("task lock poisoned");
            assert!(task_state.plan_set_calls.is_empty());
        }
    }
}

#[test]
fn set_plan_rejects_feature_and_epic_open_statuses() {
    for issue_type in ["feature", "epic"] {
        let repo_path = format!("/tmp/odt-repo-plan-invalid-{issue_type}-open");
        let (service, task_state, _git_state) = build_service_with_git_state(
            vec![make_task("task-1", issue_type, TaskStatus::Open)],
            vec![],
            main_branch(),
        );

        let error = service
            .set_plan(repo_path.as_str(), "task-1", "# Plan", None)
            .expect_err("feature/epic open should not allow plan");
        assert!(error.to_string().contains("set_plan is not allowed"));
        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.plan_set_calls.is_empty());
    }
}

#[test]
fn set_plan_for_active_epic_without_subtasks_preserves_existing_direct_subtasks() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-active-epic-preserve";
    let epic = make_task("epic-1", "epic", TaskStatus::InProgress);
    let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
    existing_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) =
        build_service_with_git_state(vec![epic, existing_child], vec![], main_branch());

    let plan = service.set_plan(repo_path, "epic-1", "# Revised Epic Plan", None)?;
    assert_eq!(plan.markdown, "# Revised Epic Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.plan_set_calls,
        vec![("epic-1".to_string(), "# Revised Epic Plan".to_string())]
    );
    assert!(task_state.delete_calls.is_empty());
    assert!(task_state.created_inputs.is_empty());
    assert!(
        !task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status.is_some()),
        "status update should be skipped for active epic revisions"
    );
    Ok(())
}

#[test]
fn set_plan_for_active_epic_rejects_explicit_subtask_replacement_before_persisting_plan() {
    let repo_path = "/tmp/odt-repo-plan-active-epic-active-subtask";
    let epic = make_task("epic-1", "epic", TaskStatus::InProgress);
    let mut active_child = make_task("child-1", "task", TaskStatus::InProgress);
    active_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) =
        build_service_with_git_state(vec![epic, active_child], vec![], main_branch());

    let error = service
        .set_plan(
            repo_path,
            "epic-1",
            "# Epic Plan",
            Some(vec![PlanSubtaskInput {
                title: "Build API".to_string(),
                issue_type: Some(IssueType::Task),
                priority: Some(2),
                description: None,
            }]),
        )
        .expect_err("active direct subtasks must block explicit replacement");
    assert!(
        error
            .to_string()
            .contains("Cannot replace epic subtasks while active work exists"),
        "unexpected error: {error}"
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.plan_set_calls.is_empty());
    assert!(task_state.delete_calls.is_empty());
    assert!(task_state.created_inputs.is_empty());
}
