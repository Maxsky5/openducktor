ALTER TABLE `tasks` ADD `source_provider_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_scope` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_number` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_source_identity` ON `tasks` (`source_provider_id`,`source_scope`,`source_id`);