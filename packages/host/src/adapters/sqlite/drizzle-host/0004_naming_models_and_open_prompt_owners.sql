CREATE TABLE `workspace_naming_models` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`runtime_kind` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`variant` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_global_prompt_appends` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`text` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`owner_kind`, `owner_id`, `prompt_id`),
	CONSTRAINT "chk_global_prompt_appends_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_global_prompt_appends`("owner_kind", "owner_id", "prompt_id", "text", "enabled") SELECT "owner_kind", "owner_id", "prompt_id", "text", "enabled" FROM `global_prompt_appends`;--> statement-breakpoint
DROP TABLE `global_prompt_appends`;--> statement-breakpoint
ALTER TABLE `__new_global_prompt_appends` RENAME TO `global_prompt_appends`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_global_prompt_overrides` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`template` text NOT NULL,
	`base_version` integer NOT NULL,
	`enabled` integer,
	PRIMARY KEY(`owner_kind`, `owner_id`, `prompt_id`),
	CONSTRAINT "chk_global_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_global_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_global_prompt_overrides`("owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled") SELECT "owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled" FROM `global_prompt_overrides`;--> statement-breakpoint
DROP TABLE `global_prompt_overrides`;--> statement-breakpoint
ALTER TABLE `__new_global_prompt_overrides` RENAME TO `global_prompt_overrides`;--> statement-breakpoint
CREATE TABLE `__new_workspace_prompt_appends` (
	`workspace_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`text` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `owner_kind`, `owner_id`, `prompt_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_prompt_appends_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_prompt_appends`("workspace_id", "owner_kind", "owner_id", "prompt_id", "text", "enabled") SELECT "workspace_id", "owner_kind", "owner_id", "prompt_id", "text", "enabled" FROM `workspace_prompt_appends`;--> statement-breakpoint
DROP TABLE `workspace_prompt_appends`;--> statement-breakpoint
ALTER TABLE `__new_workspace_prompt_appends` RENAME TO `workspace_prompt_appends`;--> statement-breakpoint
CREATE TABLE `__new_workspace_prompt_overrides` (
	`workspace_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`template` text NOT NULL,
	`base_version` integer NOT NULL,
	`enabled` integer,
	PRIMARY KEY(`workspace_id`, `owner_kind`, `owner_id`, `prompt_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_workspace_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_prompt_overrides`("workspace_id", "owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled") SELECT "workspace_id", "owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled" FROM `workspace_prompt_overrides`;--> statement-breakpoint
DROP TABLE `workspace_prompt_overrides`;--> statement-breakpoint
ALTER TABLE `__new_workspace_prompt_overrides` RENAME TO `workspace_prompt_overrides`;