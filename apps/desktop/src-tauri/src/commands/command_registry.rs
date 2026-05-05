pub(crate) fn register_desktop_commands<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        crate::commands::runtime::system_check,
        crate::commands::system::system_list_open_in_tools,
        crate::commands::system::system_open_directory_in_tool,
        crate::commands::system::open_external_url,
        crate::commands::runtime::runtime_check,
        crate::commands::runtime::beads_check,
        crate::commands::filesystem::filesystem_list_directory,
        crate::commands::workspace::workspace_list,
        crate::commands::workspace::workspace_add,
        crate::commands::workspace::workspace_select,
        crate::commands::workspace::workspace_reorder,
        crate::commands::workspace::workspace_update_repo_config,
        crate::commands::workspace::workspace_save_repo_settings,
        crate::commands::workspace::workspace_update_repo_hooks,
        crate::commands::workspace::workspace_stage_local_attachment,
        crate::commands::workspace::workspace_resolve_local_attachment_path,
        crate::commands::workspace::workspace_get_repo_config,
        crate::commands::workspace::workspace_detect_github_repository,
        crate::commands::workspace::workspace_get_settings_snapshot,
        crate::commands::workspace::workspace_update_global_git_config,
        crate::commands::workspace::workspace_save_settings_snapshot,
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
        crate::commands::tasks::tasks_list,
        crate::commands::tasks::task_create,
        crate::commands::tasks::task_update,
        crate::commands::tasks::task_delete,
        crate::commands::tasks::task_reset_implementation,
        crate::commands::tasks::task_reset,
        crate::commands::tasks::task_transition,
        crate::commands::tasks::task_defer,
        crate::commands::tasks::task_resume_deferred,
        crate::commands::documents::spec_get,
        crate::commands::documents::task_metadata_get,
        crate::commands::documents::set_spec,
        crate::commands::documents::spec_save_document,
        crate::commands::documents::plan_get,
        crate::commands::documents::set_plan,
        crate::commands::documents::plan_save_document,
        crate::commands::documents::qa_get_report,
        crate::commands::documents::qa_approved,
        crate::commands::documents::qa_rejected,
        crate::commands::build::build_start,
        crate::commands::build::dev_server_get_state,
        crate::commands::build::dev_server_start,
        crate::commands::build::dev_server_stop,
        crate::commands::build::dev_server_restart,
        crate::commands::build::agent_session_stop,
        crate::commands::build::build_blocked,
        crate::commands::build::build_resumed,
        crate::commands::build::build_completed,
        crate::commands::build::task_approval_context_get,
        crate::commands::build::task_direct_merge,
        crate::commands::build::task_direct_merge_complete,
        crate::commands::build::task_pull_request_upsert,
        crate::commands::build::task_pull_request_unlink,
        crate::commands::build::task_pull_request_detect,
        crate::commands::build::task_pull_request_link_merged,
        crate::commands::build::repo_pull_request_sync,
        crate::commands::build::human_request_changes,
        crate::commands::build::human_approve,
        crate::commands::runtime::runtime_definitions_list,
        crate::commands::runtime::runtime_list,
        crate::commands::runtime::task_worktree_get,
        crate::commands::runtime::runtime_stop,
        crate::commands::runtime::runtime_ensure,
        crate::commands::runtime::runtime_startup_status,
        crate::commands::runtime::repo_runtime_health,
        crate::commands::runtime::repo_runtime_health_status,
        crate::commands::agent_sessions::agent_sessions_list,
        crate::commands::agent_sessions::agent_sessions_list_bulk,
        crate::commands::agent_sessions::agent_session_upsert,
        crate::commands::workspace::set_theme
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
