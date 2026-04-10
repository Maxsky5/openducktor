use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, request_error, serialize_value, CommandResult, HeadlessState,
};
use crate::external_task_sync::build_external_task_created_event;
use host_application::{OdtCreateTaskInput, OdtSearchTasksInput, OdtTaskSummary};
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
    registry.register("odt_create_task", |state, args| {
        Box::pin(handle_create_task(state, args))
    })?;
    registry.register("odt_search_tasks", |state, args| {
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
    let super::command_support::RepoScopedInputArgs { repo_path, input } =
        deserialize_args::<super::command_support::RepoScopedInputArgs<OdtCreateTaskInput>>(args)?;
    let repo_path_for_create = repo_path.clone();
    let service = state.service.clone();
    let created: OdtTaskSummary =
        super::command_support::run_headless_blocking("odt_create_task", move || {
            service.odt_create_task(&repo_path_for_create, input)
        })
        .await?;

    emit_task_created_event(state, &repo_path, &created);

    serialize_value(created)
}

async fn handle_search_tasks(state: &HeadlessState, args: Value) -> CommandResult {
    super::command_support::handle_repo_scoped_input_operation_blocking(
        state,
        args,
        "odt_search_tasks",
        |service, repo_path, input: OdtSearchTasksInput| service.odt_search_tasks(&repo_path, input),
    )
    .await
}

fn emit_task_created_event(state: &HeadlessState, repo_path: &str, created: &OdtTaskSummary) {
    let canonical_repo_path = match state.service.resolve_authorized_repo_path(repo_path) {
        Ok(repo_path) => repo_path,
        Err(error) => {
            tracing::error!(
                target: "openducktor.task-sync",
                repo_path,
                error = %format!("{error:#}"),
                "External task create succeeded but canonical repo-path resolution for task sync failed"
            );
            return;
        }
    };

    let task_id = created.task.task.id.clone();
    let event = build_external_task_created_event(canonical_repo_path, task_id);
    match serde_json::to_string(&event) {
        Ok(payload) => state.task_events.emit(payload),
        Err(error) => {
            tracing::error!(
                target: "openducktor.task-sync",
                error = %error,
                "External task create succeeded but task sync event serialization failed"
            );
        }
    }
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
    use crate::headless::command_support::RepoScopedInputArgs;
    use host_application::{OdtCreateTaskInput, OdtSearchTasksInput};

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
    fn read_task_documents_args_require_at_least_one_include_flag() {
        let parsed: ReadTaskDocumentsArgs = serde_json::from_value(serde_json::json!({
            "repoPath": "/repo",
            "taskId": "task-1",
        }))
        .expect("args should parse");

        let error = if !parsed.include_spec.unwrap_or(false)
            && !parsed.include_plan.unwrap_or(false)
            && !parsed.include_qa_report.unwrap_or(false)
        {
            request_error(
                "At least one document include flag must be true. Set includeSpec, includePlan, or includeQaReport.",
            )
        } else {
            panic!("missing include flags should fail validation");
        };

        assert_eq!(
            error.message,
            "At least one document include flag must be true. Set includeSpec, includePlan, or includeQaReport."
        );
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

    #[test]
    fn create_task_args_accept_flat_public_tool_shape() {
        let parsed: RepoScopedInputArgs<OdtCreateTaskInput> =
            serde_json::from_value(serde_json::json!({
                "repoPath": "/repo",
                "title": "Bridge task",
                "issueType": "task",
                "priority": 2,
                "description": "Create through host bridge",
                "labels": ["mcp"],
                "aiReviewEnabled": true,
            }))
            .expect("args should parse");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.input.title, "Bridge task");
        assert_eq!(parsed.input.priority, 2);
        assert_eq!(parsed.input.labels, Some(vec!["mcp".to_string()]));
    }

    #[test]
    fn search_tasks_args_accept_flat_public_tool_shape() {
        let parsed: RepoScopedInputArgs<OdtSearchTasksInput> =
            serde_json::from_value(serde_json::json!({
                "repoPath": "/repo",
                "status": "open",
                "title": "bridge",
                "tags": ["mcp"],
                "limit": 10,
            }))
            .expect("args should parse");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.input.limit, 10);
        assert_eq!(parsed.input.title.as_deref(), Some("bridge"));
        assert_eq!(parsed.input.tags, Some(vec!["mcp".to_string()]));
    }

    #[test]
    fn search_tasks_args_default_limit_when_omitted() {
        let parsed: RepoScopedInputArgs<OdtSearchTasksInput> =
            serde_json::from_value(serde_json::json!({
                "repoPath": "/repo",
                "status": "open",
            }))
            .expect("args should parse");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.input.limit, 50);
    }
}
