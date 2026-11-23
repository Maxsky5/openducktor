CREATE TABLE `agent_session_turns` (
	`runtime_kind` text NOT NULL,
	`external_session_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_message_hash` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	`duration_ms` integer,
	`outcome` text,
	`final_message_id` text,
	`interruption_message_id` text,
	`interruption_message` text,
	`model_provider_id` text,
	`model_id` text,
	`model_variant` text,
	`model_profile_id` text,
	`model_speed` text,
	PRIMARY KEY(`runtime_kind`, `external_session_id`, `user_message_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_agent_session_turns_outcome" CHECK("outcome" is null or "outcome" in ('completed', 'interrupted', 'failed')),
	CONSTRAINT "chk_agent_session_turns_end" CHECK(("completed_at_ms" is null and "outcome" is null and "duration_ms" is null and "final_message_id" is null and "interruption_message_id" is null) or ("completed_at_ms" is not null and "outcome" is not null)),
	CONSTRAINT "chk_agent_session_turns_interruption" CHECK(("interruption_message_id" is null) = ("interruption_message" is null)),
	CONSTRAINT "chk_agent_session_turns_duration" CHECK("duration_ms" is null or "duration_ms" >= 0),
	CONSTRAINT "chk_agent_session_turns_model" CHECK(("model_provider_id" is null and "model_id" is null and "model_variant" is null and "model_profile_id" is null and "model_speed" is null) or ("model_provider_id" is not null and "model_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_agent_session_turns_workspace` ON `agent_session_turns` (`workspace_id`);