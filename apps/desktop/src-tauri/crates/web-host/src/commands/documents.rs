use crate::command_payloads::PlanSubtaskPayload;
use crate::command_services::issue_type::parse_issue_type;
use host_domain::PlanSubtaskInput;

fn map_plan_subtask_payload(
    subtask: PlanSubtaskPayload,
    index: usize,
) -> Result<PlanSubtaskInput, String> {
    let issue_type = match subtask.issue_type {
        Some(issue_type) => Some(parse_issue_type(
            &issue_type,
            &format!("subtasks[{index}].issueType"),
        )?),
        None => None,
    };

    Ok(PlanSubtaskInput {
        title: subtask.title,
        issue_type,
        priority: subtask.priority,
        description: subtask.description,
    })
}

pub(crate) fn map_plan_subtasks(
    subtasks: Option<Vec<PlanSubtaskPayload>>,
) -> Result<Option<Vec<PlanSubtaskInput>>, String> {
    subtasks
        .map(|items| {
            items
                .into_iter()
                .enumerate()
                .map(|(index, item)| map_plan_subtask_payload(item, index))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
}
