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

/** A prompt belongs to one role or one workflow. Its ID is unique only within its owner. */
export type PromptOwnerKind = "role" | "workflow";
export type PromptOverrideTarget = {
  ownerKind: PromptOwnerKind;
  ownerId: string;
  promptId: string;
};

/** The prompt ID of the instructions of a role. A role owns this one prompt. */
export const ROLE_INSTRUCTIONS_PROMPT_ID = "instructions";

/**
 * The prompts that every workflow provides. The system prompt of a session is the role
 * instructions, then the rules, the tool rules, and the task context of the workflow.
 */
export const WORKFLOW_PROMPT_IDS = {
  rules: "workflow.rules",
  toolRules: "workflow.tool_rules",
  taskContext: "workflow.task_context",
  readOnlyRejection: "workflow.read_only_rejection",
} as const;

/** A workflow prompt that a launch action sends as a session message has an ID in this group. */
export const WORKFLOW_MESSAGE_PROMPT_PREFIX = "messages.";

/** The settings key of a prompt override: its owner and its prompt ID. */
export const promptOverrideKey = ({ ownerKind, ownerId, promptId }: PromptOverrideTarget): string =>
  JSON.stringify([ownerKind, ownerId, promptId]);

const promptOverrideKeyTupleSchema = z
  .string()
  .transform((key, context) => {
    try {
      return JSON.parse(key);
    } catch {
      context.addIssue({ code: "custom", message: "A prompt override key is a JSON array." });
      return z.NEVER;
    }
  })
  .pipe(
    z.tuple([
      z.enum(["role", "workflow"]),
      agentPromptTemplateIdSchema,
      agentPromptTemplateIdSchema,
    ]),
  );

/** The owner and prompt ID of a settings key, or null when the key has another form. */
export const parsePromptOverrideKey = (key: string): PromptOverrideTarget | null => {
  const parsed = promptOverrideKeyTupleSchema.safeParse(key);
  if (!parsed.success) return null;
  const [ownerKind, ownerId, promptId] = parsed.data;
  const target = { ownerKind, ownerId, promptId };
  return promptOverrideKey(target) === key ? target : null;
};

const promptOverrideKeySchema = z
  .string()
  .refine(
    (key) => parsePromptOverrideKey(key) !== null,
    'Use a prompt override key of the form ["role" | "workflow", ownerId, promptId].',
  );

/** Keyed by prompt owner and prompt ID. The host checks the keys against its roles and workflows. */
export const repoPromptOverridesSchema = z
  .record(promptOverrideKeySchema, agentPromptOverrideSchema)
  .default({});
export type RepoPromptOverrides = z.output<typeof repoPromptOverridesSchema>;
