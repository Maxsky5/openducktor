CREATE TABLE `runtime_handoffs` (
	`workspace_id` text NOT NULL,
	`workspace_session_id` text,
	`task_id` text,
	`task_role` text,
	`first_runtime` text,
	`first_session_id` text,
	`working_directory` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_runtime` text NOT NULL,
	`source_session_id` text NOT NULL,
	`target_runtime` text NOT NULL,
	`target_session_id` text NOT NULL,
	`first_message_id` text NOT NULL,
	`partial_history` integer NOT NULL,
	`context_prefix` text,
	PRIMARY KEY(`workspace_id`, `target_runtime`, `target_session_id`),
	FOREIGN KEY (`workspace_id`,`workspace_session_id`) REFERENCES `workspace_sessions`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`task_id`) REFERENCES `tasks`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_runtime_handoffs_owner" CHECK(("workspace_session_id" is not null and "task_id" is null and "task_role" is null and "first_runtime" is null and "first_session_id" is null) or ("workspace_session_id" is null and "task_id" is not null and "task_role" is not null and "first_runtime" is not null and "first_session_id" is not null)),
	CONSTRAINT "chk_runtime_handoffs_ordinal" CHECK("ordinal" >= 0),
	CONSTRAINT "chk_runtime_handoffs_runtime" CHECK("source_runtime" <> "target_runtime"),
	CONSTRAINT "chk_runtime_handoffs_partial" CHECK("partial_history" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_runtime_handoffs_workspace_chat` ON `runtime_handoffs` (`workspace_id`,`workspace_session_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_runtime_handoffs_task_chat` ON `runtime_handoffs` (`workspace_id`,`task_id`,`task_role`,`first_runtime`,`first_session_id`,`working_directory`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_runtime_handoffs_source` ON `runtime_handoffs` (`workspace_id`,`source_runtime`,`source_session_id`);