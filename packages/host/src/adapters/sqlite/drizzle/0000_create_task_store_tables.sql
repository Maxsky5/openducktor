CREATE TABLE `task_documents` (
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`markdown` text NOT NULL,
	`format` text NOT NULL,
	`verdict` text,
	`source_tool` text,
	`updated_by` text,
	`updated_at_ms` integer,
	PRIMARY KEY(`task_id`, `kind`, `revision`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_documents_kind" CHECK("task_documents"."kind" in ('implementation_plan', 'qa_report', 'spec')),
	CONSTRAINT "chk_task_documents_format" CHECK("task_documents"."format" in ('plain_text')),
	CONSTRAINT "chk_task_documents_verdict" CHECK("task_documents"."verdict" is null or "task_documents"."verdict" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_task_documents_latest` ON `task_documents` (`task_id`,`kind`,`revision`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`issue_type` text NOT NULL,
	`priority` integer NOT NULL,
	`parent_id` text,
	`qa_required` integer NOT NULL,
	`labels_json` text NOT NULL,
	`agent_sessions_json` text NOT NULL,
	`target_branch_json` text,
	`pull_request_json` text,
	`direct_merge_json` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "chk_tasks_status" CHECK("tasks"."status" in ('open', 'spec_ready', 'ready_for_dev', 'in_progress', 'blocked', 'ai_review', 'human_review', 'closed')),
	CONSTRAINT "chk_tasks_issue_type" CHECK("tasks"."issue_type" in ('task', 'feature', 'bug', 'epic')),
	CONSTRAINT "chk_tasks_priority" CHECK("tasks"."priority" between 0 and 4),
	CONSTRAINT "chk_tasks_qa_required" CHECK("tasks"."qa_required" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status_updated` ON `tasks` (`status`,`updated_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent_id` ON `tasks` (`parent_id`);
