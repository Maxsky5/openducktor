CREATE TABLE `__new_tasks_artifacts` (
	`artifact_id` text NOT NULL,
	`task_id` text NOT NULL,
	`classification` text NOT NULL,
	`workflow_kind` text,
	`code` text,
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
      ("classification" = 'workflow'
        and "code" is null
        and "workflow_kind" is not null
        and "workflow_kind" in ('implementation_plan', 'qa_report', 'spec')
        and "artifact_id" = 'workflow:' || "task_id" || ':' || "workflow_kind"
        and "markdown" is not null
        and "format" is not null
        and "format" in ('plain_text')
        and ("verdict" is null or "verdict" in ('approved', 'rejected'))
        and "content" is null and "file_name" is null
        and "media_type" is null and "byte_size" is null)
      or ("classification" = 'free'
        and "code" is not null and length("code") between 1 and 128
        and "code" glob '[a-z]*' and "code" not glob '*[^a-z0-9-]*'
        and instr("code", '--') = 0 and substr("code", -1) <> '-'
        and "code" not in ('spec', 'plan', 'qaReport')
        and "artifact_id" not like 'workflow:%'
        and "workflow_kind" is null and "markdown" is null
        and "format" is null and "verdict" is null
        and "source_tool" is null and "updated_by" is null
        and "updated_at_ms" is not null and "revision" >= 1
        and typeof("content") = 'blob'
        and "file_name" is not null and "media_type" is not null
        and "byte_size" is not null and "byte_size" between 0 and 10485760
        and length("content") = "byte_size")
    )
);
--> statement-breakpoint
WITH free_codes AS (
  SELECT artifact_id,
    'artifact-' || row_number() OVER (PARTITION BY task_id ORDER BY artifact_id) AS code
  FROM tasks_artifacts
  WHERE classification = 'free'
)
INSERT INTO `__new_tasks_artifacts` (
  artifact_id, task_id, classification, workflow_kind, code, revision, name, markdown,
  format, verdict, source_tool, updated_by, updated_at_ms, content, file_name, media_type, byte_size
)
SELECT source.artifact_id, source.task_id, source.classification, source.workflow_kind,
  free_codes.code, source.revision, source.name, source.markdown, source.format, source.verdict,
  source.source_tool, source.updated_by, source.updated_at_ms, source.content,
  source.file_name, source.media_type, source.byte_size
FROM tasks_artifacts AS source
LEFT JOIN free_codes ON free_codes.artifact_id = source.artifact_id
ORDER BY source.rowid;--> statement-breakpoint
DROP TABLE `tasks_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_tasks_artifacts` RENAME TO `tasks_artifacts`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_workflow_revision` ON `tasks_artifacts` (`task_id`,`workflow_kind`,`revision`) WHERE "tasks_artifacts"."classification" = 'workflow';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_free_identity` ON `tasks_artifacts` (`artifact_id`) WHERE "tasks_artifacts"."classification" = 'free';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_artifacts_free_code` ON `tasks_artifacts` (`task_id`,`code`) WHERE "tasks_artifacts"."classification" = 'free';--> statement-breakpoint
CREATE INDEX `idx_tasks_artifacts_task` ON `tasks_artifacts` (`task_id`);