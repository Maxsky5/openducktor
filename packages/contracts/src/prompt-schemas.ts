import { z } from "zod";

/** A prompt template of the task workflow, or a host-global template. */
export const agentPromptTemplateIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Use a non-blank prompt template ID.");

export const agentPromptPlaceholderValues = [
  "role",
  "role.allowedTools",
  "task.id",
  "task.title",
  "task.issueType",
  "task.status",
  "task.description",
  "humanFeedback",
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

/** The template that declares the placeholders supplies the required ones. */
export const validatePromptTemplatePlaceholders = (
  template: string,
  requiredPlaceholders: readonly string[] = [],
) => {
  const placeholders = extractPromptTemplatePlaceholders(template);
  const unsupportedPlaceholders = placeholders.filter(
    (placeholder) => !AGENT_PROMPT_PLACEHOLDER_SET.has(placeholder),
  );
  const missingRequiredPlaceholders = requiredPlaceholders.filter(
    (placeholder) => !placeholders.includes(placeholder),
  );

  return {
    placeholders,
    unsupportedPlaceholders,
    missingRequiredPlaceholders,
  };
};

export const agentPromptOverrideSchema = z.object({
  template: z.string(),
  baseVersion: z.number().int().min(1),
  enabled: z.boolean().optional(),
});
export type AgentPromptOverride = z.infer<typeof agentPromptOverrideSchema>;

/** Keyed by prompt template ID. The host checks the IDs against the task workflow. */
export const repoPromptOverridesSchema = z
  .record(agentPromptTemplateIdSchema, agentPromptOverrideSchema)
  .default({});
export type RepoPromptOverrides = z.output<typeof repoPromptOverridesSchema>;
