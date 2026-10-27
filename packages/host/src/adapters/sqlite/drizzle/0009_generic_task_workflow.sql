PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`issue_type` text NOT NULL,
	`priority` integer NOT NULL,
	`labels_json` text NOT NULL,
	`agent_sessions_json` text NOT NULL,
	`target_branch_json` text,
	`pull_request_json` text,
	`source_provider_id` text,
	`source_scope` text,
	`source_id` text,
	`source_number` text,
	`source_url` text,
	`direct_merge_json` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "chk_tasks_status" CHECK(length(trim("status")) > 0),
	CONSTRAINT "chk_tasks_issue_type" CHECK(length(trim("issue_type")) > 0),
	CONSTRAINT "chk_tasks_priority" CHECK("priority" between 0 and 4)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "description", "status", "issue_type", "priority", "labels_json", "agent_sessions_json", "target_branch_json", "pull_request_json", "source_provider_id", "source_scope", "source_id", "source_number", "source_url", "direct_merge_json", "created_at_ms", "updated_at_ms") SELECT "id", "title", "description", "status", CASE "issue_type" WHEN 'epic' THEN 'feature' ELSE "issue_type" END, "priority", "labels_json", "agent_sessions_json", "target_branch_json", "pull_request_json", "source_provider_id", "source_scope", "source_id", "source_number", "source_url", "direct_merge_json", "created_at_ms", "updated_at_ms" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `idx_tasks_status_updated` ON `tasks` (`status`,`updated_at_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_source_identity` ON `tasks` (`source_provider_id`,`source_scope`,`source_id`);--> statement-breakpoint
CREATE TABLE `__new_tasks_artifacts` (
	`artifact_id` text NOT NULL,
	`task_id` text NOT NULL,
	`classification` text NOT NULL,
	`code` text NOT NULL,
	`revision` integer NOT NULL,
	`name` text NOT NULL,
	`markdown` text,
	`format` text,
	`verdict` text,
	`source_tool` text,
	`updated_by` text,
	`updated_at_ms` integer,
	`content` blob,
	`file_name` text,
	`media_type` text,
	`byte_size` integer,
	PRIMARY KEY(`artifact_id`, `revision`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_tasks_artifacts_variant" CHECK(
      ("classification" = 'workflow'
        and length(trim("code")) > 0
        and "artifact_id" = 'workflow:' || "task_id" || ':' || "code"
        and "markdown" is not null
        and "format" is not null
        and "format" in ('plain_text')
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
INSERT INTO `__new_tasks_artifacts`("artifact_id", "task_id", "classification", "code", "revision", "name", "markdown", "format", "verdict", "source_tool", "updated_by", "updated_at_ms", "content", "file_name", "media_type", "byte_size") SELECT CASE WHEN "classification" = 'workflow' THEN 'workflow:' || "task_id" || ':' || CASE "workflow_kind" WHEN 'implementation_plan' THEN 'plan' WHEN 'qa_report' THEN 'qaReport' ELSE "workflow_kind" END ELSE "artifact_id" END, "task_id", "classification", CASE WHEN "classification" = 'workflow' THEN CASE "workflow_kind" WHEN 'implementation_plan' THEN 'plan' WHEN 'qa_report' THEN 'qaReport' ELSE "workflow_kind" END ELSE "code" END, "revision", "name", "markdown", "format", "verdict", "source_tool", "updated_by", "updated_at_ms", "content", "file_name", "media_type", "byte_size" FROM `tasks_artifacts`;--> statement-breakpoint
DROP TABLE `tasks_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_tasks_artifacts` RENAME TO `tasks_artifacts`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_workflow_revision` ON `tasks_artifacts` (`task_id`,`code`,`revision`) WHERE "tasks_artifacts"."classification" = 'workflow';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_free_identity` ON `tasks_artifacts` (`artifact_id`) WHERE "tasks_artifacts"."classification" = 'free';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_free_code` ON `tasks_artifacts` (`task_id`,`code`) WHERE "tasks_artifacts"."classification" = 'free';--> statement-breakpoint
CREATE INDEX `idx_tasks_artifacts_task` ON `tasks_artifacts` (`task_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
