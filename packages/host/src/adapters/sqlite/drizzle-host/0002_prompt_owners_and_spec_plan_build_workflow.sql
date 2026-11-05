PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "chk_workspace_prompt_overrides_owner_kind" CHECK("owner_kind" in ('role', 'workflow')),
	CONSTRAINT "chk_workspace_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_workspace_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_prompt_overrides`("workspace_id", "owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled") SELECT "workspace_id", CASE WHEN "template_id" LIKE 'system.role.%.base' THEN 'role' ELSE 'workflow' END, CASE WHEN "template_id" LIKE 'system.role.%.base' THEN substr("template_id", 13, length("template_id") - 17) ELSE 'openducktor-spec-plan-build' END, CASE WHEN "template_id" LIKE 'system.role.%.base' THEN 'instructions' ELSE CASE "template_id" WHEN 'system.shared.workflow_guards' THEN 'workflow.rules' WHEN 'system.shared.tool_protocol' THEN 'workflow.tool_rules' WHEN 'system.shared.task_context' THEN 'workflow.task_context' WHEN 'permission.read_only.reject' THEN 'workflow.read_only_rejection' WHEN 'kickoff.spec_initial' THEN 'messages.spec_start' WHEN 'kickoff.planner_initial' THEN 'messages.plan_start' WHEN 'kickoff.build_implementation_start' THEN 'messages.build_start' WHEN 'kickoff.build_after_qa_rejected' THEN 'messages.build_after_qa_rejection' WHEN 'kickoff.build_after_human_request_changes' THEN 'messages.build_requested_changes' WHEN 'kickoff.build_pull_request_generation' THEN 'messages.build_pull_request' WHEN 'message.build_rebase_conflict_resolution' THEN 'messages.build_git_conflict' WHEN 'kickoff.qa_review' THEN 'messages.qa_review' ELSE "template_id" END END, "template", "base_version", "enabled" FROM `workspace_prompt_overrides`;--> statement-breakpoint
DROP TABLE `workspace_prompt_overrides`;--> statement-breakpoint
ALTER TABLE `__new_workspace_prompt_overrides` RENAME TO `workspace_prompt_overrides`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_global_prompt_overrides` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`template` text NOT NULL,
	`base_version` integer NOT NULL,
	`enabled` integer,
	PRIMARY KEY(`owner_kind`, `owner_id`, `prompt_id`),
	CONSTRAINT "chk_global_prompt_overrides_owner_kind" CHECK("owner_kind" in ('role', 'workflow')),
	CONSTRAINT "chk_global_prompt_overrides_base_version" CHECK("base_version" >= 1),
	CONSTRAINT "chk_global_prompt_overrides_enabled" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_global_prompt_overrides`("owner_kind", "owner_id", "prompt_id", "template", "base_version", "enabled") SELECT CASE WHEN "template_id" LIKE 'system.role.%.base' THEN 'role' ELSE 'workflow' END, CASE WHEN "template_id" LIKE 'system.role.%.base' THEN substr("template_id", 13, length("template_id") - 17) ELSE 'openducktor-spec-plan-build' END, CASE WHEN "template_id" LIKE 'system.role.%.base' THEN 'instructions' ELSE CASE "template_id" WHEN 'system.shared.workflow_guards' THEN 'workflow.rules' WHEN 'system.shared.tool_protocol' THEN 'workflow.tool_rules' WHEN 'system.shared.task_context' THEN 'workflow.task_context' WHEN 'permission.read_only.reject' THEN 'workflow.read_only_rejection' WHEN 'kickoff.spec_initial' THEN 'messages.spec_start' WHEN 'kickoff.planner_initial' THEN 'messages.plan_start' WHEN 'kickoff.build_implementation_start' THEN 'messages.build_start' WHEN 'kickoff.build_after_qa_rejected' THEN 'messages.build_after_qa_rejection' WHEN 'kickoff.build_after_human_request_changes' THEN 'messages.build_requested_changes' WHEN 'kickoff.build_pull_request_generation' THEN 'messages.build_pull_request' WHEN 'message.build_rebase_conflict_resolution' THEN 'messages.build_git_conflict' WHEN 'kickoff.qa_review' THEN 'messages.qa_review' ELSE "template_id" END END, "template", "base_version", "enabled" FROM `global_prompt_overrides`;--> statement-breakpoint
DROP TABLE `global_prompt_overrides`;--> statement-breakpoint
ALTER TABLE `__new_global_prompt_overrides` RENAME TO `global_prompt_overrides`;--> statement-breakpoint
INSERT INTO `autopilot_rules`("workflow_id", "event_id") SELECT 'openducktor-spec-plan-build', "event_id" FROM `autopilot_rules` WHERE "workflow_id" = 'openducktor';--> statement-breakpoint
UPDATE `autopilot_rule_actions` SET "workflow_id" = 'openducktor-spec-plan-build' WHERE "workflow_id" = 'openducktor';--> statement-breakpoint
DELETE FROM `autopilot_rules` WHERE "workflow_id" = 'openducktor';
