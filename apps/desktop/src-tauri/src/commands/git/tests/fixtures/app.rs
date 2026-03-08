use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::AppState;
use host_application::AppService;
use host_domain::TaskStore;
use host_infra_system::AppConfigStore;
use serde_json::Value;
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
    webview::InvokeRequest,
    App, Webview, WebviewWindow, WebviewWindowBuilder,
};

use super::{
    git_port::{
        CommandGitPort, CommandGitPortState, WorktreeStatusResult, WorktreeStatusSummaryResult,
    },
    repo::{init_repo, sample_worktree_status_summary_data, unique_test_dir},
    task_store::CommandTaskStore,
};

pub(crate) struct CommandGitFixture {
    pub(crate) app: App<MockRuntime>,
    pub(crate) webview: WebviewWindow<MockRuntime>,
    pub(crate) repo_path: String,
    pub(crate) git_state: Arc<Mutex<CommandGitPortState>>,
    pub(crate) root: PathBuf,
}

impl Drop for CommandGitFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub(crate) fn setup_command_git_fixture(
    prefix: &str,
    result: WorktreeStatusResult,
    authorize_repo: bool,
) -> CommandGitFixture {
    setup_command_git_fixture_with_summary(
        prefix,
        result,
        WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
            host_domain::GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        authorize_repo,
        false,
    )
}

pub(crate) fn setup_command_git_fixture_with_mutations(
    prefix: &str,
    result: WorktreeStatusResult,
    authorize_repo: bool,
) -> CommandGitFixture {
    setup_command_git_fixture_with_summary(
        prefix,
        result,
        WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
            host_domain::GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        authorize_repo,
        true,
    )
}

pub(crate) fn setup_command_git_fixture_with_summary(
    prefix: &str,
    result: WorktreeStatusResult,
    summary_result: WorktreeStatusSummaryResult,
    authorize_repo: bool,
    worktree_mutation_allowed: bool,
) -> CommandGitFixture {
    let root = unique_test_dir(prefix);
    let repo = root.join("repo");
    init_repo(&repo);

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    if authorize_repo {
        config_store
            .add_workspace(repo.to_string_lossy().as_ref())
            .expect("workspace should be allowlisted");
    }

    let git_port =
        CommandGitPort::new_with_summary_result(result, summary_result, worktree_mutation_allowed);
    let git_state = git_port.state.clone();
    let task_store: Arc<dyn TaskStore> = Arc::new(CommandTaskStore);
    let service = Arc::new(AppService::with_git_port(
        task_store,
        config_store,
        Arc::new(git_port),
    ));
    let app = mock_builder()
        .manage(AppState {
            service,
            hook_trust_challenges: Mutex::new(HashMap::new()),
            hook_trust_dialog_test_response: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            super::super::super::command_handlers::git_get_worktree_status,
            super::super::super::command_handlers::git_get_worktree_status_summary,
            super::super::super::command_handlers::git_create_worktree,
            super::super::super::command_handlers::git_remove_worktree
        ])
        .build(mock_context(noop_assets()))
        .expect("test app should build");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("test webview should build");

    CommandGitFixture {
        app,
        webview,
        repo_path: repo.to_string_lossy().to_string(),
        git_state,
        root,
    }
}

pub(crate) fn invoke_json<W: AsRef<Webview<MockRuntime>>>(
    webview: &W,
    cmd: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.to_string(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("invoke URL should parse"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|payload| {
        payload
            .deserialize::<Value>()
            .expect("command response should deserialize")
    })
}
