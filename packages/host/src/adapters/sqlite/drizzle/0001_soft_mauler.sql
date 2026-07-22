CREATE TABLE `task_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`scope` text NOT NULL,
	`original_name` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_assets_scope" CHECK("task_assets"."scope" in ('description')),
	CONSTRAINT "chk_task_assets_byte_size" CHECK("task_assets"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_task_assets_task_scope` ON `task_assets` (`task_id`,`scope`);