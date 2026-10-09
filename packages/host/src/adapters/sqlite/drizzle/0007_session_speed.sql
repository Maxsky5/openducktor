CREATE TABLE `__new_workspace_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `runtime_kind` text NOT NULL,
  `external_session_id` text,
  `execution_target_json` text NOT NULL,
  `role_snapshot_json` text,
  `selected_model_json` text,
  `generated_title` text,
  `manual_title` text,
  `created_at_ms` integer NOT NULL,
  `last_activity_at_ms` integer,
  `updated_at_ms` integer NOT NULL,
  `archived_at_ms` integer,
  `speed` text DEFAULT 'standard',
  CONSTRAINT `workspace_sessions_speed` CHECK (`speed` IS NULL OR length(trim(`speed`)) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_workspace_sessions` (`id`, `runtime_kind`, `external_session_id`, `execution_target_json`, `role_snapshot_json`, `selected_model_json`, `generated_title`, `manual_title`, `created_at_ms`, `last_activity_at_ms`, `updated_at_ms`, `archived_at_ms`, `speed`) SELECT `id`, `runtime_kind`, `external_session_id`, `execution_target_json`, `role_snapshot_json`, `selected_model_json`, `generated_title`, `manual_title`, `created_at_ms`, `last_activity_at_ms`, `updated_at_ms`, `archived_at_ms`, CASE WHEN `fast_mode` IS NULL THEN NULL WHEN `fast_mode` = 0 THEN 'standard' WHEN `runtime_kind` = 'codex' THEN 'priority' ELSE 'fast' END FROM `workspace_sessions`;
--> statement-breakpoint
DROP TABLE `workspace_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_workspace_sessions` RENAME TO `workspace_sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_sessions_runtime_identity` ON `workspace_sessions` (`runtime_kind`, `external_session_id`);
--> statement-breakpoint
CREATE INDEX `idx_workspace_sessions_active_updated` ON `workspace_sessions` (`archived_at_ms`, `updated_at_ms`);
--> statement-breakpoint
UPDATE `tasks` SET `agent_sessions_json` = (
  SELECT json_group_array(json(
    CASE WHEN json_type(session.value, '$.fastMode') IS NULL THEN session.value
    ELSE json_set(json_remove(session.value, '$.fastMode'), '$.speed',
      CASE WHEN json_type(session.value, '$.fastMode') = 'null' THEN NULL
        WHEN json_extract(session.value, '$.fastMode') = 0 THEN 'standard'
        WHEN json_extract(session.value, '$.runtimeKind') = 'codex' THEN 'priority'
        ELSE 'fast' END)
    END
  )) FROM json_each(`tasks`.`agent_sessions_json`) AS session
) WHERE EXISTS (
  SELECT 1 FROM json_each(`tasks`.`agent_sessions_json`) AS session
  WHERE json_type(session.value, '$.fastMode') IS NOT NULL
);
