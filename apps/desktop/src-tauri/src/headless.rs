use crate::commands::documents::map_plan_subtasks;
use crate::commands::git::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload,
    hash_worktree_status_payload, invalidate_worktree_resolution_cache_for_repo,
    parse_diff_scope, require_target_branch, resolve_working_dir, WorktreeSnapshotMetadata,
    GIT_WORKTREE_HASH_VERSION,
};
use crate::commands::tasks::{map_task_create_payload, map_task_update_payload};
use crate::{
    run_service_blocking, startup_phase_service_bootstrap, startup_phase_shutdown_hooks,
    startup_phase_tracing, BuildCompletePayload, MarkdownPayload, PlanPayload,
    PullRequestContentPayload, RepoConfigPayload, RepoSettingsPayload, SettingsSnapshotPayload,
    SettingsSnapshotResponsePayload, TaskCreatePayload, TaskUpdatePayload,
};
use anyhow::{anyhow, Context};
use axum::extract::{Path, State};
use axum::http::header;
use axum::http::StatusCode;
use axum::http::Method;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use host_application::{
    AppService, BuildResponseAction, CleanupMode, HookTrustConfirmationPort,
    HookTrustConfirmationRequest, RepoConfigUpdate, RepoSettingsUpdate, RunEmitter,
};
use host_domain::{AgentRuntimeKind, GitMergeMethod};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::CorsLayer;

const DEFAULT_BROWSER_BACKEND_HOST: &str = "127.0.0.1";

#[derive(Clone)]
struct HeadlessState {
    service: Arc<AppService>,
    events: broadcast::Sender<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoPathArgs {
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalRepoPathArgs {
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoTaskArgs {
    repo_path: String,
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoTaskReasonArgs {
    repo_path: String,
    task_id: String,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCheckArgs {
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeListArgs {
    runtime_kind: String,
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEnsureArgs {
    runtime_kind: String,
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStopArgs {
    runtime_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoConfigArgs {
    repo_path: String,
    config: RepoConfigPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveRepoSettingsArgs {
    repo_path: String,
    settings: RepoSettingsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoHooksArgs {
    repo_path: String,
    hooks: host_infra_system::HookSet,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveSettingsSnapshotArgs {
    snapshot: SettingsSnapshotPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateGlobalGitConfigArgs {
    git: host_infra_system::GlobalGitConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSetTrustedHooksArgs {
    repo_path: String,
    trusted: bool,
    challenge_nonce: Option<String>,
    challenge_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCurrentBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitSwitchBranchArgs {
    repo_path: String,
    branch: String,
    create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoveWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPushBranchArgs {
    repo_path: String,
    branch: String,
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffArgs {
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitAheadBehindArgs {
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPullBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRebaseAbortArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitWorktreeStatusArgs {
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreateArgs {
    repo_path: String,
    input: TaskCreatePayload,
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
struct BuildStartArgs {
    repo_path: String,
    task_id: String,
    runtime_kind: AgentRuntimeKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildRespondArgs {
    run_id: String,
    action: BuildResponseAction,
    payload: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildStopArgs {
    run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildCleanupArgs {
    run_id: String,
    mode: CleanupMode,
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
    merge_method: GitMergeMethod,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionUpsertArgs {
    repo_path: String,
    task_id: String,
    session: host_domain::AgentSessionDocument,
}

struct HeadlessHookTrustConfirmationPort;

impl HookTrustConfirmationPort for HeadlessHookTrustConfirmationPort {
    fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> anyhow::Result<()> {
        Err(anyhow!(
            "Trusted hook confirmation for '{}' requires the desktop shell. Browser mode cannot open the native confirmation dialog.",
            request.repo_path
        ))
    }
}

pub async fn run_browser_backend(port: u16) -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    startup_phase_shutdown_hooks(service.clone());
    let (events, _) = broadcast::channel::<String>(256);
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler))
        .route("/invoke/{command}", post(invoke_handler))
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:1420".parse().expect("valid localhost origin"),
                    "http://127.0.0.1:1420"
                        .parse()
                        .expect("valid loopback origin"),
                ])
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE]),
        )
        .with_state(HeadlessState { service, events });

    let listener = TcpListener::bind((DEFAULT_BROWSER_BACKEND_HOST, port))
        .await
        .with_context(|| format!("failed to bind browser backend on {DEFAULT_BROWSER_BACKEND_HOST}:{port}"))?;

    tracing::info!(
        target: "openducktor.browser-backend",
        host = DEFAULT_BROWSER_BACKEND_HOST,
        port,
        "OpenDucktor browser backend listening"
    );

    axum::serve(listener, app)
        .await
        .context("browser backend server terminated unexpectedly")
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn events_handler(
    State(state): State<HeadlessState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.events.subscribe()).map(|message| match message {
        Ok(payload) => Ok(Event::default().data(payload)),
        Err(_) => Ok(Event::default().comment("lagged")),
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<HeadlessState>,
    Json(args): Json<Value>,
) -> impl IntoResponse {
    match dispatch_command(&state, &command, args).await {
        Ok(payload) => (StatusCode::OK, Json(payload)).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": error,
            })),
        )
            .into_response(),
    }
}

fn deserialize_args<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|error| format!("Invalid arguments: {error}"))
}

fn serialize_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("Failed to serialize response: {error}"))
}

fn make_emitter(sender: broadcast::Sender<String>) -> RunEmitter {
    Arc::new(move |event| {
        match serde_json::to_string(&event) {
            Ok(payload) => {
                let _ = sender.send(payload);
            }
            Err(error) => {
                tracing::warn!(
                    target: "openducktor.browser-backend",
                    error = %error,
                    "Failed to serialize run event for browser SSE"
                );
            }
        }
    })
}

async fn dispatch_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Result<Value, String> {
    match command {
        "system_check" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(state.service.system_check(&repo_path).map_err(|e| format!("{e:#}"))?)
        }
        "runtime_check" => {
            let RuntimeCheckArgs { force } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .runtime_check_with_refresh(force.unwrap_or(false))
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "beads_check" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(state.service.beads_check(&repo_path).map_err(|e| format!("{e:#}"))?)
        }
        "workspace_list" => serialize_value(state.service.workspace_list().map_err(|e| format!("{e:#}"))?),
        "workspace_add" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(state.service.workspace_add(&repo_path).map_err(|e| format!("{e:#}"))?)
        }
        "workspace_select" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            let selected = state
                .service
                .workspace_select(&repo_path)
                .map_err(|e| format!("{e:#}"))?;
            invalidate_worktree_resolution_cache_for_repo(&repo_path).map_err(|e| e.to_string())?;
            serialize_value(selected)
        }
        "workspace_update_repo_config" => {
            let WorkspaceUpdateRepoConfigArgs { repo_path, config } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .workspace_merge_repo_config(
                        &repo_path,
                        RepoConfigUpdate {
                            default_runtime_kind: config.default_runtime_kind,
                            worktree_base_path: config.worktree_base_path,
                            branch_prefix: config.branch_prefix,
                            default_target_branch: config.default_target_branch,
                            git: config.git,
                            worktree_file_copies: config.worktree_file_copies,
                            prompt_overrides: config.prompt_overrides,
                            agent_defaults: config.agent_defaults,
                        },
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_save_repo_settings" => {
            let WorkspaceSaveRepoSettingsArgs { repo_path, settings } = deserialize_args(args)?;
            let service = state.service.clone();
            let confirmation_port = HeadlessHookTrustConfirmationPort;
            let update = RepoSettingsUpdate {
                default_runtime_kind: settings.default_runtime_kind,
                worktree_base_path: settings.worktree_base_path,
                branch_prefix: settings.branch_prefix,
                default_target_branch: settings.default_target_branch,
                git: settings.git,
                trusted_hooks: settings.trusted_hooks,
                hooks: settings.hooks,
                worktree_file_copies: settings.worktree_file_copies,
                prompt_overrides: settings.prompt_overrides,
                agent_defaults: settings.agent_defaults,
            };
            serialize_value(
                run_service_blocking("workspace_save_repo_settings", move || {
                    service.workspace_save_repo_settings(&repo_path, update, &confirmation_port)
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_update_repo_hooks" => {
            let WorkspaceUpdateRepoHooksArgs { repo_path, hooks } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .workspace_update_repo_hooks(&repo_path, hooks)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_prepare_trusted_hooks_challenge" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .workspace_prepare_trusted_hooks_challenge(&repo_path)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_get_repo_config" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .workspace_get_repo_config(&repo_path)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_detect_github_repository" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .workspace_detect_github_repository(&repo_path)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_get_settings_snapshot" => {
            let (git, chat, repos, global_prompt_overrides) = state
                .service
                .workspace_get_settings_snapshot()
                .map_err(|e| format!("{e:#}"))?;
            serialize_value(SettingsSnapshotResponsePayload {
                git,
                chat,
                repos,
                global_prompt_overrides,
            })
        }
        "workspace_update_global_git_config" => {
            let WorkspaceUpdateGlobalGitConfigArgs { git } = deserialize_args(args)?;
            let service = state.service.clone();
            run_service_blocking("workspace_update_global_git_config", move || {
                service.workspace_update_global_git_config(git)
            })
            .await
            .map_err(|e| format!("{e:#}"))?;
            Ok(Value::Null)
        }
        "workspace_save_settings_snapshot" => {
            let WorkspaceSaveSettingsSnapshotArgs { snapshot } = deserialize_args(args)?;
            let service = state.service.clone();
            let confirmation_port = HeadlessHookTrustConfirmationPort;
            let SettingsSnapshotPayload {
                git,
                chat,
                repos,
                global_prompt_overrides,
            } = snapshot;
            serialize_value(
                run_service_blocking("workspace_save_settings_snapshot", move || {
                    service.workspace_save_settings_snapshot(
                        git,
                        chat,
                        repos,
                        global_prompt_overrides,
                        &confirmation_port,
                    )
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "workspace_set_trusted_hooks" => {
            let WorkspaceSetTrustedHooksArgs {
                repo_path,
                trusted,
                challenge_nonce,
                challenge_fingerprint,
            } = deserialize_args(args)?;
            let service = state.service.clone();
            let confirmation_port = HeadlessHookTrustConfirmationPort;
            serialize_value(
                run_service_blocking("workspace_set_trusted_hooks", move || {
                    service.workspace_set_trusted_hooks(
                        &repo_path,
                        trusted,
                        challenge_nonce.as_deref(),
                        challenge_fingerprint.as_deref(),
                        &confirmation_port,
                    )
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_get_branches" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_get_branches(&repo_path)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_get_current_branch" => {
            let GitCurrentBranchArgs {
                repo_path,
                working_dir,
            } = deserialize_args(args)?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            serialize_value(
                state
                    .service
                    .git_port()
                    .get_current_branch(std::path::Path::new(&effective))
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_switch_branch" => {
            let GitSwitchBranchArgs {
                repo_path,
                branch,
                create,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_switch_branch(&repo_path, &branch, create.unwrap_or(false))
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_create_worktree" => {
            let GitCreateWorktreeArgs {
                repo_path,
                worktree_path,
                branch,
                create_branch,
            } = deserialize_args(args)?;
            let summary = state
                .service
                .git_create_worktree(
                    &repo_path,
                    &worktree_path,
                    &branch,
                    create_branch.unwrap_or(false),
                )
                .map_err(|e| format!("{e:#}"))?;
            invalidate_worktree_resolution_cache_for_repo(&repo_path).map_err(|e| e.to_string())?;
            serialize_value(summary)
        }
        "git_remove_worktree" => {
            let GitRemoveWorktreeArgs {
                repo_path,
                worktree_path,
                force,
            } = deserialize_args(args)?;
            let removed = state
                .service
                .git_remove_worktree(&repo_path, &worktree_path, force.unwrap_or(false))
                .map_err(|e| format!("{e:#}"))?;
            invalidate_worktree_resolution_cache_for_repo(&repo_path).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": removed }))
        }
        "git_push_branch" => {
            let GitPushBranchArgs {
                repo_path,
                branch,
                working_dir,
                remote,
                set_upstream,
                force_with_lease,
            } = deserialize_args(args)?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            serialize_value(
                state
                    .service
                    .git_push_branch(
                        &repo_path,
                        Some(effective.as_str()),
                        remote.as_deref(),
                        &branch,
                        set_upstream.unwrap_or(false),
                        force_with_lease.unwrap_or(false),
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_get_status" => {
            let GitStatusArgs {
                repo_path,
                working_dir,
            } = deserialize_args(args)?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            serialize_value(
                state
                    .service
                    .git_port()
                    .get_status(std::path::Path::new(&effective))
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_get_diff" => {
            let GitDiffArgs {
                repo_path,
                target_branch,
                working_dir,
            } = deserialize_args(args)?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            serialize_value(
                state
                    .service
                    .git_port()
                    .get_diff(std::path::Path::new(&effective), target_branch.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_commits_ahead_behind" => {
            let GitAheadBehindArgs {
                repo_path,
                target_branch,
                working_dir,
            } = deserialize_args(args)?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            serialize_value(
                state
                    .service
                    .git_port()
                    .commits_ahead_behind(std::path::Path::new(&effective), &target_branch)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_get_worktree_status" => {
            let GitWorktreeStatusArgs {
                repo_path,
                target_branch,
                diff_scope,
                working_dir,
            } = deserialize_args(args)?;
            let trimmed_target = require_target_branch(&target_branch)?;
            let scope = parse_diff_scope(diff_scope.as_deref())?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            let repo = std::path::Path::new(&effective);
            let worktree_status = state
                .service
                .git_port()
                .get_worktree_status(repo, trimmed_target, scope.clone())
                .map_err(|e| format!("{e:#}"))?;
            let observed_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let status_hash = hash_worktree_status_payload(
                &worktree_status.current_branch,
                worktree_status.file_statuses.as_slice(),
                &worktree_status.target_ahead_behind,
                &worktree_status.upstream_ahead_behind,
            );
            let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());
            serialize_value(build_worktree_status_with_snapshot(
                worktree_status,
                WorktreeSnapshotMetadata {
                    effective_working_dir: effective,
                    target_branch: trimmed_target.to_string(),
                    diff_scope: scope,
                    observed_at_ms,
                    hash_version: GIT_WORKTREE_HASH_VERSION,
                    status_hash,
                    diff_hash,
                },
            ))
        }
        "git_get_worktree_status_summary" => {
            let GitWorktreeStatusArgs {
                repo_path,
                target_branch,
                diff_scope,
                working_dir,
            } = deserialize_args(args)?;
            let trimmed_target = require_target_branch(&target_branch)?;
            let scope = parse_diff_scope(diff_scope.as_deref())?;
            state
                .service
                .ensure_repo_authorized(&repo_path)
                .map_err(|e| e.to_string())?;
            let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
            let repo = std::path::Path::new(&effective);
            let summary = state
                .service
                .git_port()
                .get_worktree_status_summary(repo, trimmed_target, scope.clone())
                .map_err(|e| format!("{e:#}"))?;
            let observed_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let status_hash = hash_worktree_status_payload(
                &summary.current_branch,
                summary.file_statuses.as_slice(),
                &summary.target_ahead_behind,
                &summary.upstream_ahead_behind,
            );
            let diff_hash = hash_worktree_diff_summary_payload(
                &scope,
                &summary.target_ahead_behind,
                &summary.file_status_counts,
            );
            serialize_value(build_worktree_status_summary_with_snapshot(
                summary.current_branch,
                summary.file_status_counts,
                summary.target_ahead_behind,
                summary.upstream_ahead_behind,
                WorktreeSnapshotMetadata {
                    effective_working_dir: effective,
                    target_branch: trimmed_target.to_string(),
                    diff_scope: scope,
                    observed_at_ms,
                    hash_version: GIT_WORKTREE_HASH_VERSION,
                    status_hash,
                    diff_hash,
                },
            ))
        }
        "git_commit_all" => {
            #[derive(Debug, Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct GitCommitAllArgs {
                repo_path: String,
                working_dir: Option<String>,
                message: String,
            }
            let request: GitCommitAllArgs = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_commit_all(
                        &request.repo_path,
                        host_domain::GitCommitAllRequest {
                            working_dir: request.working_dir,
                            message: request.message,
                        },
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_pull_branch" => {
            let request: GitPullBranchArgs = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_pull_branch(
                        &request.repo_path,
                        host_domain::GitPullRequest {
                            working_dir: request.working_dir,
                        },
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_rebase_branch" => {
            #[derive(Debug, Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct GitRebaseBranchArgs {
                repo_path: String,
                target_branch: String,
                working_dir: Option<String>,
            }
            let request: GitRebaseBranchArgs = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_rebase_branch(
                        &request.repo_path,
                        host_domain::GitRebaseBranchRequest {
                            working_dir: request.working_dir,
                            target_branch: request.target_branch,
                        },
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "git_rebase_abort" => {
            let request: GitRebaseAbortArgs = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .git_rebase_abort(
                        &request.repo_path,
                        host_domain::GitRebaseAbortRequest {
                            working_dir: request.working_dir,
                        },
                    )
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "tasks_list" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(state.service.tasks_list(&repo_path).map_err(|e| format!("{e:#}"))?)
        }
        "task_create" => {
            let TaskCreateArgs { repo_path, input } = deserialize_args(args)?;
            let create = map_task_create_payload(input)?;
            serialize_value(state.service.task_create(&repo_path, create).map_err(|e| format!("{e:#}"))?)
        }
        "task_update" => {
            let TaskUpdateArgs {
                repo_path,
                task_id,
                patch,
            } = deserialize_args(args)?;
            let mapped = map_task_update_payload(patch)?;
            serialize_value(
                state
                    .service
                    .task_update(&repo_path, &task_id, mapped)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_delete" => {
            let TaskDeleteArgs {
                repo_path,
                task_id,
                delete_subtasks,
            } = deserialize_args(args)?;
            let ok = state
                .service
                .task_delete(&repo_path, &task_id, delete_subtasks.unwrap_or(false))
                .map(|()| true)
                .map_err(|e| format!("{e:#}"))?;
            Ok(json!({ "ok": ok }))
        }
        "task_transition" => {
            let TaskTransitionArgs {
                repo_path,
                task_id,
                status,
                reason,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_transition(&repo_path, &task_id, status, reason.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_defer" => {
            let RepoTaskReasonArgs {
                repo_path,
                task_id,
                reason,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_defer(&repo_path, &task_id, reason.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_resume_deferred" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_resume_deferred(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "spec_get" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(state.service.spec_get(&repo_path, &task_id).map_err(|e| format!("{e:#}"))?)
        }
        "task_metadata_get" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_metadata_get(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "set_spec" => {
            let SetSpecArgs {
                repo_path,
                task_id,
                markdown,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .set_spec(&repo_path, &task_id, &markdown)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "spec_save_document" => {
            let SetSpecArgs {
                repo_path,
                task_id,
                markdown,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .save_spec_document(&repo_path, &task_id, &markdown)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "plan_get" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(state.service.plan_get(&repo_path, &task_id).map_err(|e| format!("{e:#}"))?)
        }
        "set_plan" => {
            let SetPlanArgs {
                repo_path,
                task_id,
                input,
            } = deserialize_args(args)?;
            let mapped_subtasks = map_plan_subtasks(input.subtasks)?;
            serialize_value(
                state
                    .service
                    .set_plan(&repo_path, &task_id, &input.markdown, mapped_subtasks)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "plan_save_document" => {
            let SetSpecArgs {
                repo_path,
                task_id,
                markdown,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .save_plan_document(&repo_path, &task_id, &markdown)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "qa_get_report" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .qa_get_report(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "qa_approved" => {
            let MarkdownInputArgs {
                repo_path,
                task_id,
                input,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .qa_approved(&repo_path, &task_id, &input.markdown)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "qa_rejected" => {
            let MarkdownInputArgs {
                repo_path,
                task_id,
                input,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .qa_rejected(&repo_path, &task_id, &input.markdown)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "build_start" => {
            let BuildStartArgs {
                repo_path,
                task_id,
                runtime_kind,
            } = deserialize_args(args)?;
            let service = state.service.clone();
            let emitter = make_emitter(state.events.clone());
            serialize_value(
                run_service_blocking("build_start", move || {
                    service.build_start(&repo_path, &task_id, runtime_kind.as_str(), emitter)
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "build_respond" => {
            let BuildRespondArgs {
                run_id,
                action,
                payload,
            } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .build_respond(&run_id, action, payload.as_deref(), make_emitter(state.events.clone()))
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "build_stop" => {
            let BuildStopArgs { run_id } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .build_stop(&run_id, make_emitter(state.events.clone()))
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "build_cleanup" => {
            let BuildCleanupArgs { run_id, mode } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .build_cleanup(&run_id, mode, make_emitter(state.events.clone()))
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "build_blocked" => {
            let RepoTaskReasonArgs {
                repo_path,
                task_id,
                reason,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .build_blocked(&repo_path, &task_id, reason.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "build_resumed" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .build_resumed(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "build_completed" => {
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
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_approval_context_get" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_approval_context_get(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_direct_merge" => {
            let TaskDirectMergeArgs {
                repo_path,
                task_id,
                merge_method,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_direct_merge(&repo_path, &task_id, merge_method)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_pull_request_upsert" => {
            let TaskPullRequestUpsertArgs {
                repo_path,
                task_id,
                input,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_pull_request_upsert(&repo_path, &task_id, &input.title, &input.body)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "task_pull_request_unlink" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .task_pull_request_unlink(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "task_pull_request_detect" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .task_pull_request_detect(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "repo_pull_request_sync" => {
            let RepoPathArgs { repo_path } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .repo_pull_request_sync(&repo_path)
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "human_request_changes" => {
            let HumanRequestChangesArgs {
                repo_path,
                task_id,
                note,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .human_request_changes(&repo_path, &task_id, note.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "human_approve" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .human_approve(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "runs_list" => {
            let OptionalRepoPathArgs { repo_path } = deserialize_args(args)?;
            serialize_value(state.service.runs_list(repo_path.as_deref()).map_err(|e| format!("{e:#}"))?)
        }
        "runtime_definitions_list" => {
            serialize_value(state.service.runtime_definitions_list().map_err(|e| format!("{e:#}"))?)
        }
        "runtime_list" => {
            let RuntimeListArgs {
                runtime_kind,
                repo_path,
            } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .runtime_list(&runtime_kind, repo_path.as_deref())
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "qa_review_target_get" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            let service = state.service.clone();
            serialize_value(
                run_service_blocking("qa_review_target_get", move || {
                    service.qa_review_target_get(&repo_path, &task_id)
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "runtime_stop" => {
            let RuntimeStopArgs { runtime_id } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .runtime_stop(&runtime_id)
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "runtime_ensure" => {
            let RuntimeEnsureArgs {
                runtime_kind,
                repo_path,
            } = deserialize_args(args)?;
            let service = state.service.clone();
            serialize_value(
                run_service_blocking("runtime_ensure", move || {
                    service.runtime_ensure(&runtime_kind, &repo_path)
                })
                .await
                .map_err(|e| format!("{e:#}"))?,
            )
        }
        "agent_sessions_list" => {
            let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
            serialize_value(
                state
                    .service
                    .agent_sessions_list(&repo_path, &task_id)
                    .map_err(|e| format!("{e:#}"))?,
            )
        }
        "agent_session_upsert" => {
            let AgentSessionUpsertArgs {
                repo_path,
                task_id,
                session,
            } = deserialize_args(args)?;
            Ok(json!({
                "ok": state
                    .service
                    .agent_session_upsert(&repo_path, &task_id, session)
                    .map_err(|e| format!("{e:#}"))?
            }))
        }
        "get_theme" => serialize_value(state.service.get_theme().map_err(|e| format!("{e:#}"))?),
        "set_theme" => {
            #[derive(Debug, Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct ThemeArgs {
                theme: String,
            }
            let ThemeArgs { theme } = deserialize_args(args)?;
            state.service.set_theme(&theme).map_err(|e| format!("{e:#}"))?;
            Ok(Value::Null)
        }
        unknown => Err(format!("Unsupported browser backend command: {unknown}")),
    }
}
