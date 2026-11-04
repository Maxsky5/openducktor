CREATE TABLE `gitlab_accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`instance_url` text NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`auth_kind` text NOT NULL,
	`token_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "chk_gitlab_accounts_auth_kind" CHECK("auth_kind" in ('oauth', 'token'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gitlab_accounts_instance_user` ON `gitlab_accounts` (`instance_url`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspace_gitlab_config` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`instance_url` text,
	`project_path` text,
	`account_id` text,
	`remote_name` text,
	`http_consent_instance_url` text,
	FOREIGN KEY (`account_id`) REFERENCES `gitlab_accounts`(`account_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`provider_id`) REFERENCES `workspace_git_config`(`workspace_id`,`provider_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_workspace_gitlab_config_provider" CHECK("provider_id" = 'gitlab'),
	CONSTRAINT "chk_workspace_gitlab_config_identity" CHECK(("instance_url" is null) = ("project_path" is null))
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_gitlab_config_account` ON `workspace_gitlab_config` (`account_id`);