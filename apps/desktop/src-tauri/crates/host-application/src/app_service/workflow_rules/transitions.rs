use host_domain::{
    AgentWorkflowState, AgentWorkflows, IssueType, QaWorkflowVerdict, TaskCard, TaskStatus,
};

pub(crate) fn default_qa_required_for_issue_type(issue_type: &IssueType) -> bool {
    matches!(
        issue_type,
        IssueType::Epic | IssueType::Feature | IssueType::Task | IssueType::Bug
    )
}

pub(crate) fn is_open_state(status: &TaskStatus) -> bool {
    !matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

fn can_skip_spec_and_planning(task: &TaskCard) -> bool {
    matches!(task.issue_type, IssueType::Task | IssueType::Bug)
}

pub(crate) fn derive_agent_workflows(task: &TaskCard) -> AgentWorkflows {
    let is_feature_epic = matches!(task.issue_type, IssueType::Feature | IssueType::Epic);
    let is_task_bug = matches!(task.issue_type, IssueType::Task | IssueType::Bug);
    let qa_required = task.ai_review_enabled;
    let is_closed = task.status == TaskStatus::Closed;
    let is_ready_for_dev_or_later = matches!(
        task.status,
        TaskStatus::ReadyForDev
            | TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    );
    let is_planner_feature_epic_status =
        task.status == TaskStatus::SpecReady || is_ready_for_dev_or_later;

    let spec_required = is_feature_epic;
    let spec_can_skip = !spec_required;
    let spec_available = !is_closed;
    let spec_completed = task.document_summary.spec.has;

    let planner_required = is_feature_epic;
    let planner_can_skip = !planner_required;
    let planner_available = if is_closed {
        false
    } else if is_task_bug {
        true
    } else if is_feature_epic {
        is_planner_feature_epic_status
    } else {
        false
    };
    let planner_completed = task.document_summary.plan.has;

    let builder_available = if is_closed {
        false
    } else if is_task_bug {
        true
    } else if is_feature_epic {
        is_ready_for_dev_or_later
    } else {
        false
    };
    let builder_completed = matches!(
        task.status,
        TaskStatus::AiReview | TaskStatus::HumanReview | TaskStatus::Closed
    );

    let qa_available = if is_closed {
        false
    } else {
        matches!(task.status, TaskStatus::AiReview | TaskStatus::HumanReview)
    };
    let qa_completed = task.document_summary.qa_report.verdict == QaWorkflowVerdict::Approved;

    AgentWorkflows {
        spec: AgentWorkflowState {
            required: spec_required,
            can_skip: spec_can_skip,
            available: spec_available,
            completed: spec_completed,
        },
        planner: AgentWorkflowState {
            required: planner_required,
            can_skip: planner_can_skip,
            available: planner_available,
            completed: planner_completed,
        },
        builder: AgentWorkflowState {
            required: true,
            can_skip: false,
            available: builder_available,
            completed: builder_completed,
        },
        qa: AgentWorkflowState {
            required: qa_required,
            can_skip: !qa_required,
            available: qa_available,
            completed: qa_completed,
        },
    }
}

pub(crate) fn allows_transition(task: &TaskCard, from: &TaskStatus, to: &TaskStatus) -> bool {
    if from == to {
        return true;
    }

    match from {
        // Task/Bug can bypass spec/planning and move directly toward build states.
        TaskStatus::Open => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::SpecReady
                        | TaskStatus::ReadyForDev
                        | TaskStatus::InProgress
                        | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::SpecReady | TaskStatus::Deferred)
            }
        }
        TaskStatus::SpecReady => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::ReadyForDev | TaskStatus::InProgress | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::ReadyForDev | TaskStatus::Deferred)
            }
        }
        TaskStatus::ReadyForDev => matches!(to, TaskStatus::InProgress | TaskStatus::Deferred),
        TaskStatus::InProgress => {
            matches!(
                to,
                TaskStatus::Blocked
                    | TaskStatus::AiReview
                    | TaskStatus::HumanReview
                    | TaskStatus::Deferred
            )
        }
        TaskStatus::Blocked => matches!(
            to,
            TaskStatus::InProgress
                | TaskStatus::AiReview
                | TaskStatus::HumanReview
                | TaskStatus::Deferred
                | TaskStatus::Blocked
        ),
        TaskStatus::AiReview => matches!(
            to,
            TaskStatus::InProgress
                | TaskStatus::HumanReview
                | TaskStatus::Closed
                | TaskStatus::Deferred
        ),
        TaskStatus::HumanReview => matches!(
            to,
            TaskStatus::InProgress | TaskStatus::Closed | TaskStatus::Deferred
        ),
        TaskStatus::Deferred => matches!(to, TaskStatus::Open),
        // Closed is terminal unless reopened through explicit workflow operations elsewhere.
        TaskStatus::Closed => false,
    }
}

pub(crate) fn can_set_spec_from_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Open
            | TaskStatus::SpecReady
            | TaskStatus::ReadyForDev
            | TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    )
}

pub(crate) fn is_active_or_review_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    )
}

pub(crate) fn can_set_plan(task: &TaskCard) -> bool {
    match task.issue_type {
        IssueType::Epic | IssueType::Feature => {
            matches!(task.status, TaskStatus::SpecReady | TaskStatus::ReadyForDev)
                || is_active_or_review_status(&task.status)
        }
        IssueType::Task | IssueType::Bug => {
            matches!(
                task.status,
                TaskStatus::Open | TaskStatus::SpecReady | TaskStatus::ReadyForDev
            ) || is_active_or_review_status(&task.status)
        }
    }
}

pub(crate) fn can_replace_epic_subtask_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Open | TaskStatus::SpecReady | TaskStatus::ReadyForDev
    )
}
