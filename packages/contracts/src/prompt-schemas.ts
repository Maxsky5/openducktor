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
  "system.scenario.qa_review",
  "kickoff.spec_initial",
  "kickoff.planner_initial",
  "kickoff.build_implementation_start",
  "kickoff.build_after_qa_rejected",
  "kickoff.build_after_human_request_changes",
  "kickoff.qa_review",
  "permission.read_only.reject",
] as const;

export const agentPromptTemplateIdSchema = z.enum(agentPromptTemplateIdValues);
export type AgentPromptTemplateId = z.infer<typeof agentPromptTemplateIdSchema>;
const AGENT_PROMPT_TEMPLATE_ID_SET = new Set<string>(agentPromptTemplateIdValues);

export const agentPromptOverrideSchema = z.object({
  template: z.string().min(1),
  baseVersion: z.number().int().min(1),
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
