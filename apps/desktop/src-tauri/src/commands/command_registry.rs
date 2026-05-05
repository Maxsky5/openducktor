use crate::commands::agent_sessions::*;
use crate::commands::build::*;
use crate::commands::documents::*;
use crate::commands::filesystem::*;
use crate::commands::runtime::*;
use crate::commands::system::*;
use crate::commands::tasks::*;
use crate::commands::workspace::*;

pub(crate) fn register_desktop_commands<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        system_check,
        system_list_open_in_tools,
        system_open_directory_in_tool,
        open_external_url,
        runtime_check,
        beads_check,
        filesystem_list_directory,
        workspace_list,
        workspace_add,
        workspace_select,
        workspace_reorder,
        workspace_update_repo_config,
        workspace_save_repo_settings,
        workspace_update_repo_hooks,
        workspace_stage_local_attachment,
        workspace_resolve_local_attachment_path,
        workspace_get_repo_config,
        workspace_detect_github_repository,
        workspace_get_settings_snapshot,
        workspace_update_global_git_config,
        workspace_save_settings_snapshot,
        crate::commands::git::command_handlers::git_get_branches,
        crate::commands::git::command_handlers::git_get_current_branch,
        crate::commands::git::command_handlers::git_switch_branch,
        crate::commands::git::command_handlers::git_create_worktree,
        crate::commands::git::command_handlers::git_remove_worktree,
        crate::commands::git::command_handlers::git_push_branch,
        crate::commands::git::command_handlers::git_get_status,
        crate::commands::git::command_handlers::git_get_diff,
        crate::commands::git::command_handlers::git_commits_ahead_behind,
        crate::commands::git::command_handlers::git_get_worktree_status,
        crate::commands::git::command_handlers::git_get_worktree_status_summary,
        crate::commands::git::command_handlers::git_commit_all,
        crate::commands::git::command_handlers::git_reset_worktree_selection,
        crate::commands::git::command_handlers::git_fetch_remote,
        crate::commands::git::command_handlers::git_pull_branch,
        crate::commands::git::command_handlers::git_rebase_branch,
        crate::commands::git::command_handlers::git_rebase_abort,
        crate::commands::git::command_handlers::git_abort_conflict,
        tasks_list,
        task_create,
        task_update,
        task_delete,
        task_reset_implementation,
        task_reset,
        task_transition,
        task_defer,
        task_resume_deferred,
        spec_get,
        task_metadata_get,
        set_spec,
        spec_save_document,
        plan_get,
        set_plan,
        plan_save_document,
        qa_get_report,
        qa_approved,
        qa_rejected,
        build_start,
        dev_server_get_state,
        dev_server_start,
        dev_server_stop,
        dev_server_restart,
        agent_session_stop,
        build_blocked,
        build_resumed,
        build_completed,
        task_approval_context_get,
        task_direct_merge,
        task_direct_merge_complete,
        task_pull_request_upsert,
        task_pull_request_unlink,
        task_pull_request_detect,
        task_pull_request_link_merged,
        repo_pull_request_sync,
        human_request_changes,
        human_approve,
        runtime_definitions_list,
        runtime_list,
        task_worktree_get,
        runtime_stop,
        runtime_ensure,
        runtime_startup_status,
        repo_runtime_health,
        repo_runtime_health_status,
        agent_sessions_list,
        agent_sessions_list_bulk,
        agent_session_upsert,
        set_theme
    ])
}
#[cfg(test)]
mod tests {
    use serde_json::Value;

    #[test]
    fn default_capability_permissions_are_minimal_and_shell_free() {
        let capability: Value =
            serde_json::from_str(include_str!("../../capabilities/default.json"))
                .expect("default capability JSON should parse");
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("default capability should contain permissions array");
        let expected = vec![Value::String("core:default".to_string())];

        assert_eq!(
            permissions, &expected,
            "default capability should keep exact minimum approved permissions"
        );
        assert!(
            permissions.iter().all(|entry| {
                !matches!(
                    entry,
                    Value::String(value) if value.starts_with("shell:")
                )
            }),
            "default capability must not expose shell permissions"
        );
    }
}
