CREATE TABLE `workflow_availability` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	CONSTRAINT "chk_workflow_availability_mode" CHECK("mode" in ('only', 'except'))
);
--> statement-breakpoint
CREATE TABLE `workflow_availability_workspaces` (
	`workflow_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `workspace_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow_availability`(`workflow_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_drafts` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`document_json` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`workflow_id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_roles` (
	`role_id` text PRIMARY KEY NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`definition_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_versions` (
	`workflow_id` text NOT NULL,
	`version` integer NOT NULL,
	`published_at_ms` integer NOT NULL,
	`document_json` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `version`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`workflow_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workflow_versions_version" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL,
	`deleted_at_ms` integer
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `workflow_id` text DEFAULT 'openducktor-spec-plan-build' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `workflow_version` integer;--> statement-breakpoint
CREATE INDEX `idx_tasks_workflow` ON `tasks` (`workflow_id`,`workflow_version`);--> statement-breakpoint
ALTER TABLE `host_settings` ADD `default_workflow_id` text DEFAULT 'openducktor-spec-plan-build' NOT NULL;