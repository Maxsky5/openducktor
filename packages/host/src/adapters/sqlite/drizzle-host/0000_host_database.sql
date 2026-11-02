CREATE TABLE `host_metadata` (
	`singleton_id` integer PRIMARY KEY NOT NULL,
	`import_complete` integer NOT NULL,
	`catalog_revision` integer NOT NULL,
	CONSTRAINT "chk_host_metadata_singleton" CHECK("singleton_id" = 1),
	CONSTRAINT "chk_host_metadata_import_complete" CHECK("import_complete" in (0, 1)),
	CONSTRAINT "chk_host_metadata_catalog_revision" CHECK("catalog_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `task_artifacts` (
	`workspace_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`task_id` text NOT NULL,
	`classification` text NOT NULL,
	`code` text NOT NULL,
	`revision` integer NOT NULL,
	`name` text NOT NULL,
	`format` text,
	`verdict` text,
	`source_tool` text,
	`updated_by` text,
	`updated_at_ms` integer,
	`file_name` text,
	`media_type` text,
	`byte_size` integer,
	`markdown` text,
	`content` blob,
	PRIMARY KEY(`workspace_id`, `artifact_id`, `revision`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_artifacts_variant" CHECK(
      ("classification" = 'workflow'
        and length(trim("code")) > 0
        and "artifact_id" = 'workflow:' || "task_id" || ':' || "code"
        and "markdown" is not null
        and "format" is not null
        and ("verdict" is null or length(trim("verdict")) > 0)
        and "content" is null and "file_name" is null
        and "media_type" is null and "byte_size" is null)
      or ("classification" = 'free'
        and length("code") between 1 and 128
        and "code" glob '[a-z]*' and "code" not glob '*[^a-z0-9-]*'
        and instr("code", '--') = 0 and substr("code", -1) <> '-'
        and "artifact_id" not like 'workflow:%'
        and "markdown" is null
        and "format" is null and "verdict" is null
        and "source_tool" is null and "updated_by" is null
        and "updated_at_ms" is not null and "revision" >= 1
        and typeof("content") = 'blob'
        and "file_name" is not null and "media_type" is not null
        and "byte_size" is not null and "byte_size" between 0 and 10485760
        and length("content") = "byte_size")
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_artifacts_workflow_revision` ON `task_artifacts` (`workspace_id`,`task_id`,`code`,`revision`) WHERE "classification" = 'workflow';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_artifacts_free_identity` ON `task_artifacts` (`workspace_id`,`artifact_id`) WHERE "classification" = 'free';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_artifacts_free_code` ON `task_artifacts` (`workspace_id`,`task_id`,`code`) WHERE "classification" = 'free';--> statement-breakpoint
CREATE INDEX `idx_task_artifacts_task` ON `task_artifacts` (`workspace_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `task_assets` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`task_id` text NOT NULL,
	`scope` text NOT NULL,
	`original_name` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_assets_byte_size" CHECK("byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_task_assets_task_scope` ON `task_assets` (`workspace_id`,`task_id`,`scope`);--> statement-breakpoint
CREATE TABLE `task_direct_merges` (
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`method` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`target_remote` text,
	`merged_at_ms` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `task_id`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_issue_links` (
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_scope` text NOT NULL,
	`external_id` text NOT NULL,
	`display_number` text NOT NULL,
	`url` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `task_id`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_issue_links_source` ON `task_issue_links` (`workspace_id`,`provider_id`,`provider_scope`,`external_id`);--> statement-breakpoint
CREATE TABLE `task_labels` (
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `task_id`, `position`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_labels_position" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE `task_pull_requests` (
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`repository_identity` text,
	`number` integer NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`last_synced_at_ms` integer,
	`merged_at_ms` integer,
	`closed_at_ms` integer,
	PRIMARY KEY(`workspace_id`, `task_id`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_sessions` (
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`external_session_id` text NOT NULL,
	`role` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`last_activity_at_ms` integer,
	`runtime_kind` text NOT NULL,
	`working_directory` text NOT NULL,
	`model_runtime_kind` text,
	`model_provider_id` text,
	`model_id` text,
	`model_variant` text,
	`model_profile_id` text,
	`model_speed` text,
	PRIMARY KEY(`workspace_id`, `task_id`, `position`),
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_sessions_position" CHECK("position" >= 0),
	CONSTRAINT "chk_task_sessions_started_at" CHECK("started_at_ms" between -8640000000000000 and 8640000000000000),
	CONSTRAINT "chk_task_sessions_activity" CHECK("last_activity_at_ms" is null or "last_activity_at_ms" between 0 and 9007199254740991),
	CONSTRAINT "chk_task_sessions_model" CHECK(("model_runtime_kind" is null and "model_provider_id" is null and "model_id" is null and "model_variant" is null and "model_profile_id" is null and "model_speed" is null) or ("model_runtime_kind" is not null and "model_provider_id" is not null and "model_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_task_sessions_runtime_identity` ON `task_sessions` (`workspace_id`,`runtime_kind`,`external_session_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`issue_type` text NOT NULL,
	`priority` integer NOT NULL,
	`target_branch` text,
	`target_remote` text,
	`remove_worktree_on_close` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_tasks_status" CHECK(length(trim("status")) > 0),
	CONSTRAINT "chk_tasks_issue_type" CHECK(length(trim("issue_type")) > 0),
	CONSTRAINT "chk_tasks_priority" CHECK("priority" between 0 and 4),
	CONSTRAINT "chk_tasks_remove_worktree" CHECK("remove_worktree_on_close" is null or "remove_worktree_on_close" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status_updated` ON `tasks` (`workspace_id`,`status`,`updated_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_tasks_id` ON `tasks` (`id`);--> statement-breakpoint
CREATE TABLE `workspace_sessions` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`runtime_kind` text NOT NULL,
	`external_session_id` text,
	`execution_kind` text NOT NULL,
	`working_directory` text NOT NULL,
	`branch_name` text,
	`worktree_state` text,
	`role_snapshot_id` text,
	`role_snapshot_name` text,
	`role_snapshot_system_prompt` text,
	`model_runtime_kind` text,
	`model_provider_id` text,
	`model_id` text,
	`model_variant` text,
	`model_profile_id` text,
	`model_speed` text,
	`generated_title` text,
	`manual_title` text,
	`target_branch` text,
	`target_remote` text,
	`created_at_ms` integer NOT NULL,
	`last_activity_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	`archived_at_ms` integer,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_sessions_execution" CHECK(("execution_kind" = 'local_repo_root' and "branch_name" is null and "worktree_state" is null) or ("execution_kind" = 'local_worktree' and "worktree_state" in ('present', 'removed'))),
	CONSTRAINT "chk_workspace_sessions_role" CHECK(("role_snapshot_id" is null and "role_snapshot_name" is null and "role_snapshot_system_prompt" is null) or ("role_snapshot_id" is not null and "role_snapshot_name" is not null and "role_snapshot_system_prompt" is not null)),
	CONSTRAINT "chk_workspace_sessions_model" CHECK(("model_runtime_kind" is null and "model_provider_id" is null and "model_id" is null and "model_variant" is null and "model_profile_id" is null and "model_speed" is null) or ("model_runtime_kind" = "runtime_kind" and "model_provider_id" is not null and "model_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_sessions_runtime_identity` ON `workspace_sessions` (`workspace_id`,`runtime_kind`,`external_session_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_sessions_active_updated` ON `workspace_sessions` (`workspace_id`,`archived_at_ms`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`workspace_name` text NOT NULL,
	`abbreviation` text,
	`tile_color` text,
	`repo_path` text NOT NULL,
	`worktree_base_path` text,
	`branch_prefix` text NOT NULL,
	`default_target_remote` text,
	`default_target_branch` text NOT NULL,
	`default_action_id` text,
	`closed` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`default_action_id`) REFERENCES `workspace_actions`(`workspace_id`,`action_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_workspaces_closed" CHECK("closed" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_workspaces_repo_path` ON `workspaces` (`repo_path`);--> statement-breakpoint
CREATE TABLE `autopilot_rule_actions` (
	`workflow_id` text NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`action_id` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `event_id`, `position`),
	FOREIGN KEY (`workflow_id`,`event_id`) REFERENCES `autopilot_rules`(`workflow_id`,`event_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_autopilot_rule_actions_position" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_autopilot_rule_actions_identity` ON `autopilot_rule_actions` (`workflow_id`,`event_id`,`action_id`);--> statement-breakpoint
CREATE TABLE `autopilot_rules` (
	`workflow_id` text NOT NULL,
	`event_id` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `custom_agent_roles` (
	`role_id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`system_prompt` text NOT NULL,
	CONSTRAINT "chk_custom_agent_roles_position_nonnegative" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_agent_roles_position` ON `custom_agent_roles` (`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_agent_roles_name_key` ON `custom_agent_roles` (`name_key`);--> statement-breakpoint
CREATE TABLE `global_prompt_overrides` (
	`template_id` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`base_version` integer NOT NULL,
	`enabled` integer,
	CONSTRAINT "chk_global_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_global_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `host_settings` (
	`singleton_id` integer PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`default_merge_method` text NOT NULL,
	`remove_worktree_on_close` integer NOT NULL,
	`always_start_qa_reviews_fresh` integer NOT NULL,
	`remote_access_enabled` integer NOT NULL,
	CONSTRAINT "chk_host_settings_singleton" CHECK("singleton_id" = 1),
	CONSTRAINT "chk_host_settings_remove_worktree_on_close" CHECK("remove_worktree_on_close" in (0, 1)),
	CONSTRAINT "chk_host_settings_always_start_qa_reviews_fresh" CHECK("always_start_qa_reviews_fresh" in (0, 1)),
	CONSTRAINT "chk_host_settings_remote_access_enabled" CHECK("remote_access_enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `remote_access_listener` (
	`singleton_id` integer PRIMARY KEY NOT NULL,
	`listen_host` text NOT NULL,
	`listen_port` integer NOT NULL,
	`public_endpoint` text,
	`web_origins_present` integer NOT NULL,
	FOREIGN KEY (`singleton_id`) REFERENCES `host_settings`(`singleton_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_remote_access_listener_port" CHECK("listen_port" between 1 and 65535),
	CONSTRAINT "chk_remote_access_listener_web_origins_present" CHECK("web_origins_present" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `remote_access_web_origins` (
	`singleton_id` integer NOT NULL,
	`position` integer NOT NULL,
	`origin` text NOT NULL,
	PRIMARY KEY(`singleton_id`, `position`),
	FOREIGN KEY (`singleton_id`) REFERENCES `remote_access_listener`(`singleton_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_remote_access_web_origins_position" CHECK("position" between 0 and 31)
);
--> statement-breakpoint
CREATE TABLE `workspace_actions` (
	`workspace_id` text NOT NULL,
	`action_id` text NOT NULL,
	`position` integer NOT NULL,
	`icon` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`run_on_worktree_create` integer NOT NULL,
	`wait_before_agent_start` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `action_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_actions_position_nonnegative" CHECK("position" >= 0),
	CONSTRAINT "chk_workspace_actions_run_on_worktree_create" CHECK("run_on_worktree_create" in (0, 1)),
	CONSTRAINT "chk_workspace_actions_wait_before_agent_start" CHECK("wait_before_agent_start" in (0, 1)),
	CONSTRAINT "chk_workspace_actions_wait_requires_run" CHECK("wait_before_agent_start" = 0 or "run_on_worktree_create" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_actions_position` ON `workspace_actions` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `workspace_azure_config` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`deployment` text,
	`service_url` text,
	`organization` text,
	`project` text,
	`repository_name` text,
	`http_consent_collection_url` text,
	`area_path` text,
	`remote_mappings_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`workspace_id`,`provider_id`) REFERENCES `workspace_git_config`(`workspace_id`,`provider_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_azure_config_provider" CHECK("provider_id" = 'azure_devops'),
	CONSTRAINT "chk_workspace_azure_config_deployment" CHECK("deployment" in ('services', 'server')),
	CONSTRAINT "chk_workspace_azure_config_remote_mappings" CHECK(json_valid("remote_mappings_json") and json_type("remote_mappings_json") = 'array'),
	CONSTRAINT "chk_workspace_azure_config_identity" CHECK(("deployment" is null and "service_url" is null and "organization" is null
        and "project" is null and "repository_name" is null)
        or ("deployment" is not null and "service_url" is not null
          and "organization" is not null and "project" is not null
          and "repository_name" is not null)),
	CONSTRAINT "chk_workspace_azure_config_nonempty" CHECK("repository_name" is not null or "http_consent_collection_url" is not null
        or "area_path" is not null),
	CONSTRAINT "chk_workspace_azure_config_mappings_require_identity" CHECK("repository_name" is not null or json_array_length("remote_mappings_json") = 0)
);
--> statement-breakpoint
CREATE TABLE `workspace_build_completion_commands` (
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`command` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `position`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_build_completion_commands_position" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE `workspace_copy_paths` (
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `position`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_copy_paths_position" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE `workspace_default_models` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`runtime_kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`variant` text,
	`profile_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_git_config` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`auto_detected` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_git_config_provider_id" CHECK(length(trim("provider_id")) > 0),
	CONSTRAINT "chk_workspace_git_config_enabled" CHECK("enabled" in (0, 1)),
	CONSTRAINT "chk_workspace_git_config_auto_detected" CHECK("auto_detected" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_git_config_provider` ON `workspace_git_config` (`workspace_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `workspace_prompt_overrides` (
	`workspace_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template` text NOT NULL,
	`base_version` integer NOT NULL,
	`enabled` integer,
	PRIMARY KEY(`workspace_id`, `template_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_workspace_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `workspace_removals` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`remove_task_worktrees` integer NOT NULL,
	`phase` text NOT NULL,
	`pending_worktree_path` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_removals_remove_task_worktrees" CHECK("remove_task_worktrees" in (0, 1)),
	CONSTRAINT "chk_workspace_removals_phase" CHECK("phase" in ('worktrees', 'attachments', 'task_store'))
);
--> statement-breakpoint
CREATE TABLE `workspace_repository_identity` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`host` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`provider_id`) REFERENCES `workspace_git_config`(`workspace_id`,`provider_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_repository_identity_provider" CHECK("provider_id" <> 'azure_devops')
);
--> statement-breakpoint
CREATE TABLE `workspace_role_defaults` (
	`workspace_id` text NOT NULL,
	`role_id` text NOT NULL,
	`runtime_kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`variant` text,
	`profile_id` text,
	PRIMARY KEY(`workspace_id`, `role_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_runtime_settings` (
	`runtime_kind` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`executable_path` text NOT NULL,
	`policy_json` text,
	CONSTRAINT "chk_agent_runtime_settings_enabled" CHECK("enabled" in (0, 1)),
	CONSTRAINT "chk_agent_runtime_settings_policy" CHECK("policy_json" is null or (json_valid("policy_json")
        and json_type("policy_json") is 'object'
        and json_type("policy_json", '$.defaults') is 'object'
        and json_type("policy_json", '$.roleOverrides') is 'object'))
);
