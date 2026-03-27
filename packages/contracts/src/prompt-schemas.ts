import { z } from "zod";

export const agentPromptTemplateIdValues = [
  "system.shared.workflow_guards",
  "system.shared.tool_protocol",
  "system.shared.task_context",
  "system.role.spec.base",
  "system.role.planner.base",
  "system.role.build.base",
  "system.role.qa.base",
  "system.scenario.spec_initial",
  "system.scenario.planner_initial",
  "system.scenario.build_implementation_start",
  "system.scenario.build_after_qa_rejected",
  "system.scenario.build_after_human_request_changes",
  "system.scenario.build_pull_request_generation",
  "system.scenario.build_rebase_conflict_resolution",
  "system.scenario.qa_review",
  "kickoff.spec_initial",
  "kickoff.planner_initial",
  "kickoff.build_implementation_start",
  "kickoff.build_after_qa_rejected",
  "kickoff.build_after_human_request_changes",
  "kickoff.build_pull_request_generation",
  "kickoff.qa_review",
  "message.build_rebase_conflict_resolution",
  "permission.read_only.reject",
] as const;

export const agentPromptTemplateIdSchema = z.enum(agentPromptTemplateIdValues);
export type AgentPromptTemplateId = z.infer<typeof agentPromptTemplateIdSchema>;
const AGENT_PROMPT_TEMPLATE_ID_SET = new Set<string>(agentPromptTemplateIdValues);

export const agentPromptPlaceholderValues = [
  "role",
  "role.allowedTools",
  "task.id",
  "task.title",
  "task.issueType",
  "task.status",
  "task.qaRequired",
  "task.description",
  "git.operationLabel",
  "git.currentBranch",
  "git.targetBranch",
  "git.conflictedFiles",
  "git.conflictOutput",
] as const;
export const agentPromptPlaceholderSchema = z.enum(agentPromptPlaceholderValues);
export type AgentPromptPlaceholder = z.infer<typeof agentPromptPlaceholderSchema>;
const AGENT_PROMPT_PLACEHOLDER_SET = new Set<string>(agentPromptPlaceholderValues);

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

export const extractPromptTemplatePlaceholders = (template: string): string[] => {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const token = match[1];
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
};

export const validatePromptTemplatePlaceholders = (template: string) => {
  const placeholders = extractPromptTemplatePlaceholders(template);
  const unsupportedPlaceholders = placeholders.filter(
    (placeholder) => !AGENT_PROMPT_PLACEHOLDER_SET.has(placeholder),
  );

  return {
    placeholders,
    unsupportedPlaceholders,
  };
};

export const agentPromptOverrideSchema = z.object({
  template: z.string(),
  baseVersion: z.number().int().min(1),
  enabled: z.boolean().optional(),
});
export type AgentPromptOverride = z.infer<typeof agentPromptOverrideSchema>;

export const repoPromptOverridesSchema = z
  .record(z.string(), agentPromptOverrideSchema)
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (AGENT_PROMPT_TEMPLATE_ID_SET.has(key)) {
        continue;
      }
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `Unknown prompt template id: ${key}`,
      });
    }
  })
  .default({});
export type RepoPromptOverrides = Partial<Record<AgentPromptTemplateId, AgentPromptOverride>>;
