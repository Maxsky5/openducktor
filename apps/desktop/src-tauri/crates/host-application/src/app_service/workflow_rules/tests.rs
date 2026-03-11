use super::{
    allows_transition, can_replace_epic_subtask_status, can_set_plan, can_set_spec_from_status,
    derive_agent_workflows, derive_available_actions, normalize_subtask_plan_inputs,
    normalize_title_key,
};
use crate::app_service::test_support::make_task;
use host_domain::{PlanSubtaskInput, QaWorkflowVerdict, TaskAction, TaskStatus};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowContractFixture {
    statuses: Vec<String>,
    transitions: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    set_spec_allowed_statuses: Vec<String>,
    set_plan_allowed_statuses: BTreeMap<String, Vec<String>>,
    epic_subtask_replacement_allowed_statuses: Vec<String>,
}

fn load_workflow_contract_fixture() -> WorkflowContractFixture {
    let raw = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../docs/contracts/workflow-contract-fixture.json"
    ));
    serde_json::from_str(raw).expect("workflow contract fixture must parse")
}

fn parse_status(value: &str) -> TaskStatus {
    TaskStatus::from_cli_value(value).unwrap_or_else(|| panic!("unknown fixture status: {value}"))
}

#[test]
fn module_normalize_title_key_is_case_insensitive_and_trimmed() {
    assert_eq!(normalize_title_key("  Build Runtime  "), "build runtime");
    assert_eq!(normalize_title_key("BUILD runtime"), "build runtime");
}

#[test]
fn module_derive_available_actions_exposes_resume_for_deferred_task() {
    let deferred = make_task("task-1", "task", TaskStatus::Deferred);

    let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));

    assert!(actions.contains(&TaskAction::ResumeDeferred));
}

#[test]
fn module_derive_available_actions_exposes_qa_start_for_review_states() {
    for status in [TaskStatus::AiReview, TaskStatus::HumanReview] {
        let task = make_task("task-1", "task", status);

        let actions = derive_available_actions(&task, std::slice::from_ref(&task));

        assert!(actions.contains(&TaskAction::QaStart));
        assert!(!actions.contains(&TaskAction::BuildStart));
    }
}

#[test]
fn module_derive_available_actions_exposes_rework_and_open_qa_for_qa_rejected_tasks() {
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;

    let actions = derive_available_actions(&task, std::slice::from_ref(&task));

    assert!(actions.contains(&TaskAction::BuildStart));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::OpenQa));
}

#[test]
fn module_derive_available_actions_exposes_review_actions_during_review_states() {
    for status in [TaskStatus::AiReview, TaskStatus::HumanReview] {
        let task = make_task("task-1", "task", status);

        let actions = derive_available_actions(&task, std::slice::from_ref(&task));

        assert!(actions.contains(&TaskAction::QaStart));
        assert!(actions.contains(&TaskAction::HumanRequestChanges));
        assert!(actions.contains(&TaskAction::HumanApprove));
    }
}

#[test]
fn module_derive_available_actions_hides_human_approve_for_closed_tasks() {
    let task = make_task("task-1", "task", TaskStatus::Closed);

    let actions = derive_available_actions(&task, std::slice::from_ref(&task));

    assert!(!actions.contains(&TaskAction::HumanRequestChanges));
    assert!(!actions.contains(&TaskAction::HumanApprove));
}

#[test]
fn module_normalize_subtask_plan_inputs_rejects_empty_title() {
    let inputs = vec![PlanSubtaskInput {
        title: "   ".to_string(),
        issue_type: None,
        priority: None,
        description: None,
    }];

    let error = normalize_subtask_plan_inputs(inputs).expect_err("empty title should be rejected");

    assert!(error.to_string().contains("title"));
}

#[test]
fn module_derive_agent_workflows_spec_availability_is_false_only_when_closed() {
    let mut task = make_task("task-1", "feature", TaskStatus::Open);
    for status in [
        TaskStatus::Open,
        TaskStatus::SpecReady,
        TaskStatus::ReadyForDev,
        TaskStatus::InProgress,
        TaskStatus::Blocked,
        TaskStatus::AiReview,
        TaskStatus::HumanReview,
        TaskStatus::Deferred,
    ] {
        task.status = status;
        let workflows = derive_agent_workflows(&task);
        assert!(workflows.spec.available);
    }

    task.status = TaskStatus::Closed;
    let workflows = derive_agent_workflows(&task);
    assert!(!workflows.spec.available);
}

#[test]
fn module_derive_agent_workflows_planner_and_builder_availability_matrix() {
    let mut task = make_task("task-1", "task", TaskStatus::Open);
    for status in [
        TaskStatus::Open,
        TaskStatus::SpecReady,
        TaskStatus::ReadyForDev,
        TaskStatus::InProgress,
        TaskStatus::Blocked,
        TaskStatus::AiReview,
        TaskStatus::HumanReview,
        TaskStatus::Deferred,
    ] {
        task.status = status;
        let workflows = derive_agent_workflows(&task);
        assert!(workflows.planner.available);
        assert!(workflows.builder.available);
    }
    task.status = TaskStatus::Closed;
    let workflows = derive_agent_workflows(&task);
    assert!(!workflows.planner.available);
    assert!(!workflows.builder.available);

    let mut feature = make_task("task-2", "feature", TaskStatus::Open);
    let feature_open = derive_agent_workflows(&feature);
    assert!(!feature_open.planner.available);
    assert!(!feature_open.builder.available);

    feature.status = TaskStatus::SpecReady;
    let feature_spec_ready = derive_agent_workflows(&feature);
    assert!(feature_spec_ready.planner.available);
    assert!(!feature_spec_ready.builder.available);

    feature.status = TaskStatus::ReadyForDev;
    let feature_ready_for_dev = derive_agent_workflows(&feature);
    assert!(feature_ready_for_dev.planner.available);
    assert!(feature_ready_for_dev.builder.available);

    feature.status = TaskStatus::HumanReview;
    let feature_human_review = derive_agent_workflows(&feature);
    assert!(feature_human_review.planner.available);
    assert!(feature_human_review.builder.available);

    feature.status = TaskStatus::Closed;
    let feature_closed = derive_agent_workflows(&feature);
    assert!(!feature_closed.planner.available);
    assert!(!feature_closed.builder.available);
}

#[test]
fn module_derive_agent_workflows_qa_flags_and_completion_follow_payload() {
    let mut task = make_task("task-1", "task", TaskStatus::AiReview);
    task.ai_review_enabled = true;
    let required = derive_agent_workflows(&task);
    assert!(required.qa.required);
    assert!(!required.qa.can_skip);
    assert!(required.qa.available);
    assert!(!required.qa.completed);

    task.ai_review_enabled = false;
    let optional = derive_agent_workflows(&task);
    assert!(!optional.qa.required);
    assert!(optional.qa.can_skip);
    assert!(optional.qa.available);

    task.status = TaskStatus::HumanReview;
    let human_review = derive_agent_workflows(&task);
    assert!(human_review.qa.available);

    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;
    let rejected = derive_agent_workflows(&task);
    assert!(!rejected.qa.completed);

    task.document_summary.qa_report.verdict = QaWorkflowVerdict::NotReviewed;
    let not_reviewed = derive_agent_workflows(&task);
    assert!(!not_reviewed.qa.completed);

    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Approved;
    let approved = derive_agent_workflows(&task);
    assert!(approved.qa.completed);
}

#[test]
fn module_derive_agent_workflows_closed_precedence_and_reopen_recompute() {
    let mut task = make_task("task-1", "feature", TaskStatus::InProgress);
    let open_state = derive_agent_workflows(&task);
    assert!(open_state.spec.available);
    assert!(open_state.planner.available);
    assert!(open_state.builder.available);
    assert!(!open_state.qa.available);

    task.status = TaskStatus::Closed;
    let closed_state = derive_agent_workflows(&task);
    assert!(!closed_state.spec.available);
    assert!(!closed_state.planner.available);
    assert!(!closed_state.builder.available);
    assert!(!closed_state.qa.available);

    task.status = TaskStatus::AiReview;
    let reopened = derive_agent_workflows(&task);
    assert!(reopened.spec.available);
    assert!(reopened.planner.available);
    assert!(reopened.builder.available);
    assert!(reopened.qa.available);
}

#[test]
fn workflow_contract_transitions_match_fixture() {
    let fixture = load_workflow_contract_fixture();
    for issue_type in ["epic", "feature", "task", "bug"] {
        let issue_transitions = fixture
            .transitions
            .get(issue_type)
            .unwrap_or_else(|| panic!("missing transitions for issue type: {issue_type}"));
        for from in &fixture.statuses {
            let from_status = parse_status(from);
            let task = make_task("fixture-task", issue_type, from_status.clone());
            let expected_targets = issue_transitions
                .get(from)
                .unwrap_or_else(|| panic!("missing transitions for status: {from}"));

            for to in &fixture.statuses {
                let to_status = parse_status(to);
                let expected_allowed = from == to || expected_targets.contains(to);
                let actual_allowed = allows_transition(&task, &from_status, &to_status);
                assert_eq!(
                    actual_allowed, expected_allowed,
                    "transition mismatch for issue_type={issue_type} {from}->{to}"
                );
            }
        }
    }
}

#[test]
fn workflow_contract_set_spec_statuses_match_fixture() {
    let fixture = load_workflow_contract_fixture();
    let expected = fixture
        .set_spec_allowed_statuses
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();

    for status in &fixture.statuses {
        let parsed = parse_status(status);
        let actual_allowed = can_set_spec_from_status(&parsed);
        let expected_allowed = expected.contains(&status.as_str());
        assert_eq!(
            actual_allowed, expected_allowed,
            "set_spec mismatch for status={status}"
        );
    }
}

#[test]
fn workflow_contract_set_plan_statuses_match_fixture() {
    let fixture = load_workflow_contract_fixture();
    for issue_type in ["epic", "feature", "task", "bug"] {
        let expected_statuses = fixture
            .set_plan_allowed_statuses
            .get(issue_type)
            .unwrap_or_else(|| panic!("missing set_plan statuses for issue_type={issue_type}"));

        for status in &fixture.statuses {
            let parsed_status = parse_status(status);
            let task = make_task("fixture-task", issue_type, parsed_status);
            let actual_allowed = can_set_plan(&task);
            let expected_allowed = expected_statuses.contains(status);
            assert_eq!(
                actual_allowed, expected_allowed,
                "set_plan mismatch for issue_type={issue_type} status={status}"
            );
        }
    }
}

#[test]
fn workflow_contract_epic_subtask_replacement_statuses_match_fixture() {
    let fixture = load_workflow_contract_fixture();
    let expected = fixture
        .epic_subtask_replacement_allowed_statuses
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();

    for status in &fixture.statuses {
        let parsed = parse_status(status);
        let actual_allowed = can_replace_epic_subtask_status(&parsed);
        let expected_allowed = expected.contains(&status.as_str());
        assert_eq!(
            actual_allowed, expected_allowed,
            "epic subtask replacement mismatch for status={status}"
        );
    }
}
