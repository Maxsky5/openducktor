use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, request_error, serialize_value, CommandResult, HeadlessState,
};
use host_application::{OdtCreateTaskInput, OdtSearchTasksInput};
use host_domain::PlanSubtaskInput;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyArgs {
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoTaskArgs {
    repo_path: String,
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTaskDocumentsArgs {
    repo_path: String,
    task_id: String,
    include_spec: Option<bool>,
    include_plan: Option<bool>,
    include_qa_report: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskArgs {
    repo_path: String,
    input: OdtCreateTaskInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTasksArgs {
    repo_path: String,
    input: OdtSearchTasksInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSpecArgs {
    repo_path: String,
    task_id: String,
    markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPlanArgs {
    repo_path: String,
    task_id: String,
    markdown: String,
    subtasks: Option<Vec<PlanSubtaskInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildBlockedArgs {
    repo_path: String,
    task_id: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildCompletedArgs {
    repo_path: String,
    task_id: String,
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPullRequestArgs {
    repo_path: String,
    task_id: String,
    provider_id: String,
    number: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QaOutcomeArgs {
    repo_path: String,
    task_id: String,
    report_markdown: String,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("odt_mcp_ready", |state, args| {
        Box::pin(handle_odt_mcp_ready(state, args))
    })?;
    registry.register("odt_read_task", |state, args| {
        Box::pin(handle_odt_read_task(state, args))
    })?;
    registry.register("odt_read_task_documents", |state, args| {
        Box::pin(handle_odt_read_task_documents(state, args))
    })?;
    registry.register("create_task", |state, args| {
        Box::pin(handle_create_task(state, args))
    })?;
    registry.register("search_tasks", |state, args| {
        Box::pin(handle_search_tasks(state, args))
    })?;
    registry.register("odt_set_spec", |state, args| {
        Box::pin(handle_odt_set_spec(state, args))
    })?;
    registry.register("odt_set_plan", |state, args| {
        Box::pin(handle_odt_set_plan(state, args))
    })?;
    registry.register("odt_build_blocked", |state, args| {
        Box::pin(handle_odt_build_blocked(state, args))
    })?;
    registry.register("odt_build_resumed", |state, args| {
        Box::pin(handle_odt_build_resumed(state, args))
    })?;
    registry.register("odt_build_completed", |state, args| {
        Box::pin(handle_odt_build_completed(state, args))
    })?;
    registry.register("odt_set_pull_request", |state, args| {
        Box::pin(handle_odt_set_pull_request(state, args))
    })?;
    registry.register("odt_qa_approved", |state, args| {
        Box::pin(handle_odt_qa_approved(state, args))
    })?;
    registry.register("odt_qa_rejected", |state, args| {
        Box::pin(handle_odt_qa_rejected(state, args))
    })?;
    Ok(())
}

async fn handle_odt_mcp_ready(state: &HeadlessState, args: Value) -> CommandResult {
    let ReadyArgs { repo_path } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_mcp_ready", move || {
            service.odt_mcp_ready(&repo_path)
        })
        .await?,
    )
}

async fn handle_odt_read_task(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_read_task", move || {
            service.odt_read_task(&repo_path, &task_id)
        })
        .await?,
    )
}

async fn handle_odt_read_task_documents(state: &HeadlessState, args: Value) -> CommandResult {
    let ReadTaskDocumentsArgs {
        repo_path,
        task_id,
        include_spec,
        include_plan,
        include_qa_report,
    } = deserialize_args(args)?;
    if !include_spec.unwrap_or(false)
        && !include_plan.unwrap_or(false)
        && !include_qa_report.unwrap_or(false)
    {
        return Err(request_error(
            "At least one document include flag must be true. Set includeSpec, includePlan, or includeQaReport.",
        ));
    }
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_read_task_documents", move || {
            service.odt_read_task_documents(
                &repo_path,
                &task_id,
                include_spec.unwrap_or(false),
                include_plan.unwrap_or(false),
                include_qa_report.unwrap_or(false),
            )
        })
        .await?,
    )
}

async fn handle_create_task(state: &HeadlessState, args: Value) -> CommandResult {
    let CreateTaskArgs { repo_path, input } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("create_task", move || {
            service.odt_create_task(&repo_path, input)
        })
        .await?,
    )
}

async fn handle_search_tasks(state: &HeadlessState, args: Value) -> CommandResult {
    let SearchTasksArgs { repo_path, input } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("search_tasks", move || {
            service.odt_search_tasks(&repo_path, input)
        })
        .await?,
    )
}

async fn handle_odt_set_spec(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_set_spec", move || {
            service.odt_set_spec(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

async fn handle_odt_set_plan(state: &HeadlessState, args: Value) -> CommandResult {
    let SetPlanArgs {
        repo_path,
        task_id,
        markdown,
        subtasks,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_set_plan", move || {
            service.odt_set_plan(&repo_path, &task_id, &markdown, subtasks)
        })
        .await?,
    )
}

async fn handle_odt_build_blocked(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildBlockedArgs {
        repo_path,
        task_id,
        reason,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_build_blocked", move || {
            service.odt_build_blocked(&repo_path, &task_id, &reason)
        })
        .await?,
    )
}

async fn handle_odt_build_resumed(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_build_resumed", move || {
            service.odt_build_resumed(&repo_path, &task_id)
        })
        .await?,
    )
}

async fn handle_odt_build_completed(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildCompletedArgs {
        repo_path,
        task_id,
        summary,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_build_completed", move || {
            service.odt_build_completed(&repo_path, &task_id, summary)
        })
        .await?,
    )
}

async fn handle_odt_set_pull_request(state: &HeadlessState, args: Value) -> CommandResult {
    let SetPullRequestArgs {
        repo_path,
        task_id,
        provider_id,
        number,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("odt_set_pull_request", move || {
            service.odt_set_pull_request(&repo_path, &task_id, &provider_id, number)
        })
        .await?,
    )
}

async fn handle_odt_qa_approved(state: &HeadlessState, args: Value) -> CommandResult {
    handle_qa_outcome(state, args, "odt_qa_approved", true).await
}

async fn handle_odt_qa_rejected(state: &HeadlessState, args: Value) -> CommandResult {
    handle_qa_outcome(state, args, "odt_qa_rejected", false).await
}

async fn handle_qa_outcome(
    state: &HeadlessState,
    args: Value,
    operation_name: &'static str,
    approved: bool,
) -> CommandResult {
    let QaOutcomeArgs {
        repo_path,
        task_id,
        report_markdown,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking(operation_name, move || {
            if approved {
                service.odt_qa_approved(&repo_path, &task_id, &report_markdown)
            } else {
                service.odt_qa_rejected(&repo_path, &task_id, &report_markdown)
            }
        })
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_args_deserialize_repo_path() {
        let parsed: ReadyArgs = serde_json::from_value(serde_json::json!({ "repoPath": "/repo" }))
            .expect("args should parse");
        assert_eq!(parsed.repo_path, "/repo");
    }

    #[test]
    fn read_task_documents_args_support_optional_flags() {
        let parsed: ReadTaskDocumentsArgs = serde_json::from_value(serde_json::json!({
            "repoPath": "/repo",
            "taskId": "task-1",
            "includeSpec": true,
        }))
        .expect("args should parse");
        assert_eq!(parsed.task_id, "task-1");
        assert_eq!(parsed.include_spec, Some(true));
    }

    #[test]
    fn set_pull_request_args_keep_provider_and_number() {
        let parsed: SetPullRequestArgs = serde_json::from_value(serde_json::json!({
            "repoPath": "/repo",
            "taskId": "task-1",
            "providerId": "github",
            "number": 42,
        }))
        .expect("args should parse");
        assert_eq!(parsed.provider_id, "github");
        assert_eq!(parsed.number, 42);
    }
}
