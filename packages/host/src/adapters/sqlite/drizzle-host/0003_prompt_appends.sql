CREATE TABLE `global_prompt_appends` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`text` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`owner_kind`, `owner_id`, `prompt_id`),
	CONSTRAINT "chk_global_prompt_appends_owner_kind" CHECK("owner_kind" in ('role', 'workflow')),
	CONSTRAINT "chk_global_prompt_appends_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `workspace_prompt_appends` (
	`workspace_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`text` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `owner_kind`, `owner_id`, `prompt_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_prompt_appends_owner_kind" CHECK("owner_kind" in ('role', 'workflow')),
	CONSTRAINT "chk_workspace_prompt_appends_enabled" CHECK("enabled" in (0, 1))
);
