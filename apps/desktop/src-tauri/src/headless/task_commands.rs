use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, handle_repo_task_operation, handle_repo_task_operation_blocking,
    handle_repo_task_reason_operation, handle_repo_task_reason_operation_blocking, request_error,
    serialize_value, service_error, CommandResult, HeadlessState, RepoPathArgs, RepoTaskArgs,
};
use crate::commands::documents::map_plan_subtasks;
use crate::commands::tasks::{map_task_create_payload, map_task_update_payload};
use crate::{
    BuildCompletePayload, MarkdownPayload, PlanPayload, PullRequestContentPayload,
    TaskCreatePayload, TaskDirectMergePayload, TaskUpdatePayload,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreateArgs {
    repo_path: String,
    input: TaskCreatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskListArgs {
    repo_path: String,
    done_visible_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdateArgs {
    repo_path: String,
    task_id: String,
    patch: TaskUpdatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDeleteArgs {
    repo_path: String,
    task_id: String,
    delete_subtasks: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskResetImplementationArgs {
    repo_path: String,
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskTransitionArgs {
    repo_path: String,
    task_id: String,
    status: host_domain::TaskStatus,
    reason: Option<String>,
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
    input: PlanPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownInputArgs {
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildCompletedArgs {
    repo_path: String,
    task_id: String,
    input: Option<BuildCompletePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDirectMergeArgs {
    repo_path: String,
    task_id: String,
    input: TaskDirectMergePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskPullRequestUpsertArgs {
    repo_path: String,
    task_id: String,
    input: PullRequestContentPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HumanRequestChangesArgs {
    repo_path: String,
    task_id: String,
    note: Option<String>,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("tasks_list", |state, args| {
        Box::pin(handle_tasks_list(state, args))
    })?;
    registry.register("task_create", |state, args| {
        Box::pin(handle_task_create(state, args))
    })?;
    registry.register("task_update", |state, args| {
        Box::pin(handle_task_update(state, args))
    })?;
    registry.register("task_delete", |state, args| {
        Box::pin(handle_task_delete(state, args))
    })?;
    registry.register("task_reset_implementation", |state, args| {
        Box::pin(handle_task_reset_implementation(state, args))
    })?;
    registry.register("task_transition", |state, args| {
        Box::pin(handle_task_transition(state, args))
    })?;
    registry.register("task_defer", |state, args| {
        Box::pin(handle_task_defer(state, args))
    })?;
    registry.register("task_resume_deferred", |state, args| {
        Box::pin(handle_task_resume_deferred(state, args))
    })?;
    registry.register("spec_get", |state, args| {
        Box::pin(handle_spec_get(state, args))
    })?;
    registry.register("task_metadata_get", |state, args| {
        Box::pin(handle_task_metadata_get(state, args))
    })?;
    registry.register("set_spec", |state, args| {
        Box::pin(handle_set_spec(state, args))
    })?;
    registry.register("spec_save_document", |state, args| {
        Box::pin(handle_spec_save_document(state, args))
    })?;
    registry.register("plan_get", |state, args| {
        Box::pin(handle_plan_get(state, args))
    })?;
    registry.register("set_plan", |state, args| {
        Box::pin(handle_set_plan(state, args))
    })?;
    registry.register("plan_save_document", |state, args| {
        Box::pin(handle_plan_save_document(state, args))
    })?;
    registry.register("qa_get_report", |state, args| {
        Box::pin(handle_qa_get_report(state, args))
    })?;
    registry.register("qa_approved", |state, args| {
        Box::pin(handle_qa_approved(state, args))
    })?;
    registry.register("qa_rejected", |state, args| {
        Box::pin(handle_qa_rejected(state, args))
    })?;
    registry.register("build_blocked", |state, args| {
        Box::pin(async move { handle_build_blocked(state, args) })
    })?;
    registry.register("build_resumed", |state, args| {
        Box::pin(async move { handle_build_resumed(state, args) })
    })?;
    registry.register("build_completed", |state, args| {
        Box::pin(async move { handle_build_completed(state, args) })
    })?;
    registry.register("task_approval_context_get", |state, args| {
        Box::pin(async move { handle_task_approval_context_get(state, args) })
    })?;
    registry.register("task_direct_merge", |state, args| {
        Box::pin(async move { handle_task_direct_merge(state, args) })
    })?;
    registry.register("task_direct_merge_complete", |state, args| {
        Box::pin(handle_task_direct_merge_complete(state, args))
    })?;
    registry.register("task_pull_request_upsert", |state, args| {
        Box::pin(async move { handle_task_pull_request_upsert(state, args) })
    })?;
    registry.register("task_pull_request_unlink", |state, args| {
        Box::pin(async move { handle_task_pull_request_unlink(state, args) })
    })?;
    registry.register("task_pull_request_detect", |state, args| {
        Box::pin(async move { handle_task_pull_request_detect(state, args) })
    })?;
    registry.register("task_pull_request_link_merged", |state, args| {
        Box::pin(handle_task_pull_request_link_merged(state, args))
    })?;
    registry.register("repo_pull_request_sync", |state, args| {
        Box::pin(async move { handle_repo_pull_request_sync(state, args) })
    })?;
    registry.register("human_request_changes", |state, args| {
        Box::pin(async move { handle_human_request_changes(state, args) })
    })?;
    registry.register("human_approve", |state, args| {
        Box::pin(async move { handle_human_approve(state, args) })
    })?;
    Ok(())
}

async fn handle_tasks_list(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskListArgs {
        repo_path,
        done_visible_days,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let tasks = crate::run_service_blocking_tokio("tasks_list", move || match done_visible_days {
        Some(days) => service.tasks_list_for_kanban(&repo_path, days),
        None => service.tasks_list(&repo_path),
    })
    .await
    .map_err(service_error)?;
    serialize_value(tasks)
}

async fn handle_task_create(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskCreateArgs { repo_path, input } = deserialize_args(args)?;
    let create = map_task_create_payload(input).map_err(request_error)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("task_create", move || {
            service.task_create(&repo_path, create)
        })
        .await?,
    )
}

async fn handle_task_update(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskUpdateArgs {
        repo_path,
        task_id,
        patch,
    } = deserialize_args(args)?;
    let mapped = map_task_update_payload(patch).map_err(request_error)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("task_update", move || {
            service.task_update(&repo_path, &task_id, mapped)
        })
        .await?,
    )
}

async fn handle_task_delete(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskDeleteArgs {
        repo_path,
        task_id,
        delete_subtasks,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let delete_subtasks = delete_subtasks.unwrap_or(false);
    let ok = super::command_support::run_headless_blocking("task_delete", move || {
        service
            .task_delete(&repo_path, &task_id, delete_subtasks)
            .map(|()| true)
    })
    .await?;
    Ok(json!({ "ok": ok }))
}

async fn handle_task_reset_implementation(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskResetImplementationArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("task_reset_implementation", move || {
            service.task_reset_implementation(&repo_path, &task_id)
        })
        .await?,
    )
}

async fn handle_task_transition(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskTransitionArgs {
        repo_path,
        task_id,
        status,
        reason,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("task_transition", move || {
            service.task_transition(&repo_path, &task_id, status, reason.as_deref())
        })
        .await?,
    )
}

async fn handle_task_defer(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_reason_operation_blocking(
        state,
        args,
        "task_defer",
        |service, repo_path, task_id, reason| {
            service.task_defer(&repo_path, &task_id, reason.as_deref())
        },
    )
    .await
}

async fn handle_task_resume_deferred(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(
        state,
        args,
        "task_resume_deferred",
        |service, repo_path, task_id| service.task_resume_deferred(&repo_path, &task_id),
    )
    .await
}

async fn handle_spec_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(state, args, "spec_get", |service, repo_path, task_id| {
        service.spec_get(&repo_path, &task_id)
    })
    .await
}

async fn handle_task_metadata_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(
        state,
        args,
        "task_metadata_get",
        |service, repo_path, task_id| service.task_metadata_get(&repo_path, &task_id),
    )
    .await
}

async fn handle_set_spec(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("set_spec", move || {
            service.set_spec(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

async fn handle_spec_save_document(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("spec_save_document", move || {
            service.save_spec_document(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

async fn handle_plan_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(state, args, "plan_get", |service, repo_path, task_id| {
        service.plan_get(&repo_path, &task_id)
    })
    .await
}

async fn handle_set_plan(state: &HeadlessState, args: Value) -> CommandResult {
    let SetPlanArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    let mapped_subtasks = map_plan_subtasks(input.subtasks).map_err(request_error)?;
    let markdown = input.markdown;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("set_plan", move || {
            service.set_plan(&repo_path, &task_id, &markdown, mapped_subtasks)
        })
        .await?,
    )
}

async fn handle_plan_save_document(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("plan_save_document", move || {
            service.save_plan_document(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

async fn handle_qa_get_report(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(
        state,
        args,
        "qa_get_report",
        |service, repo_path, task_id| service.qa_get_report(&repo_path, &task_id),
    )
    .await
}

async fn handle_qa_approved(state: &HeadlessState, args: Value) -> CommandResult {
    let MarkdownInputArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    let markdown = input.markdown;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("qa_approved", move || {
            service.qa_approved(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

async fn handle_qa_rejected(state: &HeadlessState, args: Value) -> CommandResult {
    let MarkdownInputArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    let markdown = input.markdown;
    let service = state.service.clone();
    serialize_value(
        super::command_support::run_headless_blocking("qa_rejected", move || {
            service.qa_rejected(&repo_path, &task_id, &markdown)
        })
        .await?,
    )
}

fn handle_build_blocked(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_reason_operation(args, |repo_path, task_id, reason| {
        state
            .service
            .build_blocked(&repo_path, &task_id, reason.as_deref())
    })
}

fn handle_build_resumed(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.build_resumed(&repo_path, &task_id)
    })
}

fn handle_build_completed(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildCompletedArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .build_completed(
                &repo_path,
                &task_id,
                input.as_ref().and_then(|entry| entry.summary.as_deref()),
            )
            .map_err(service_error)?,
    )
}

fn handle_task_approval_context_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state
            .service
            .task_approval_context_get(&repo_path, &task_id)
    })
}

fn handle_task_direct_merge(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskDirectMergeArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .task_direct_merge(
                &repo_path,
                &task_id,
                input.merge_method,
                input.squash_commit_message,
            )
            .map_err(service_error)?,
    )
}

async fn handle_task_direct_merge_complete(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    let repo_path_for_worker = repo_path.clone();
    let task_id_for_worker = task_id.clone();
    let result =
        super::command_support::run_headless_blocking("task_direct_merge_complete", move || {
            service.task_direct_merge_complete(&repo_path_for_worker, &task_id_for_worker)
        })
        .await?;
    super::command_support::invalidate_repo_worktree_cache(&repo_path)?;
    serialize_value(result)
}

fn handle_task_pull_request_upsert(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskPullRequestUpsertArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .task_pull_request_upsert(&repo_path, &task_id, &input.title, &input.body)
            .map_err(service_error)?,
    )
}

fn handle_task_pull_request_unlink(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .task_pull_request_unlink(&repo_path, &task_id)
            .map_err(service_error)?
    }))
}

fn handle_task_pull_request_detect(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.task_pull_request_detect(&repo_path, &task_id)
    })
}

async fn handle_task_pull_request_link_merged(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TaskPullRequestLinkMergedArgs {
        repo_path: String,
        task_id: String,
        pull_request: host_domain::PullRequestRecord,
    }

    let TaskPullRequestLinkMergedArgs {
        repo_path,
        task_id,
        pull_request,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let repo_path_for_worker = repo_path.clone();
    let task_id_for_worker = task_id.clone();
    let result =
        super::command_support::run_headless_blocking("task_pull_request_link_merged", move || {
            service.task_pull_request_link_merged(
                &repo_path_for_worker,
                &task_id_for_worker,
                pull_request,
            )
        })
        .await?;
    super::command_support::invalidate_repo_worktree_cache(&repo_path)?;
    serialize_value(result)
}

fn handle_repo_pull_request_sync(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .repo_pull_request_sync(&repo_path)
            .map_err(service_error)?
    }))
}

fn handle_human_request_changes(state: &HeadlessState, args: Value) -> CommandResult {
    let HumanRequestChangesArgs {
        repo_path,
        task_id,
        note,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .human_request_changes(&repo_path, &task_id, note.as_deref())
            .map_err(service_error)?,
    )
}

fn handle_human_approve(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.human_approve(&repo_path, &task_id)
    })
}
