CREATE TABLE `tasks_artifacts` (
	`artifact_id` text NOT NULL,
	`task_id` text NOT NULL,
	`classification` text NOT NULL,
	`workflow_kind` text,
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
      ("tasks_artifacts"."classification" = 'workflow'
        and "tasks_artifacts"."workflow_kind" is not null
        and "tasks_artifacts"."workflow_kind" in ('implementation_plan', 'qa_report', 'spec')
        and "tasks_artifacts"."artifact_id" = 'workflow:' || "tasks_artifacts"."task_id" || ':' || "tasks_artifacts"."workflow_kind"
        and "tasks_artifacts"."markdown" is not null
        and "tasks_artifacts"."format" is not null
        and "tasks_artifacts"."format" in ('plain_text')
        and ("tasks_artifacts"."verdict" is null or "tasks_artifacts"."verdict" in ('approved', 'rejected'))
        and "tasks_artifacts"."content" is null and "tasks_artifacts"."file_name" is null
        and "tasks_artifacts"."media_type" is null and "tasks_artifacts"."byte_size" is null)
      or ("tasks_artifacts"."classification" = 'free'
        and "tasks_artifacts"."artifact_id" not like 'workflow:%'
        and "tasks_artifacts"."workflow_kind" is null and "tasks_artifacts"."markdown" is null
        and "tasks_artifacts"."format" is null and "tasks_artifacts"."verdict" is null
        and "tasks_artifacts"."source_tool" is null and "tasks_artifacts"."updated_by" is null
        and "tasks_artifacts"."updated_at_ms" is not null and "tasks_artifacts"."revision" >= 1
        and typeof("tasks_artifacts"."content") = 'blob'
        and "tasks_artifacts"."file_name" is not null and "tasks_artifacts"."media_type" is not null
        and "tasks_artifacts"."byte_size" is not null and "tasks_artifacts"."byte_size" between 0 and 10485760
        and length("tasks_artifacts"."content") = "tasks_artifacts"."byte_size")
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_workflow_revision` ON `tasks_artifacts` (`task_id`,`workflow_kind`,`revision`) WHERE "tasks_artifacts"."classification" = 'workflow';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_free_identity` ON `tasks_artifacts` (`artifact_id`) WHERE "tasks_artifacts"."classification" = 'free';--> statement-breakpoint
CREATE INDEX `idx_tasks_artifacts_task` ON `tasks_artifacts` (`task_id`);--> statement-breakpoint
INSERT INTO `tasks_artifacts` (
  `artifact_id`, `task_id`, `classification`, `workflow_kind`, `revision`, `name`,
  `markdown`, `format`, `verdict`, `source_tool`, `updated_by`, `updated_at_ms`
)
SELECT
  'workflow:' || `task_id` || ':' || `kind`, `task_id`, 'workflow', `kind`, `revision`,
  CASE `kind`
    WHEN 'spec' THEN 'Specification'
    WHEN 'implementation_plan' THEN 'Implementation Plan'
    WHEN 'qa_report' THEN 'QA Report'
  END,
  `markdown`, `format`, `verdict`, `source_tool`, `updated_by`, `updated_at_ms`
FROM `task_documents`;
--> statement-breakpoint
DROP TABLE `task_documents`;
