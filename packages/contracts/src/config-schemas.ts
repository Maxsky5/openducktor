import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { gitTargetBranchSchema, globalGitConfigSchema, repoGitConfigSchema } from "./git-schemas";
import { repoPromptOverridesSchema } from "./prompt-schemas";

export const DEFAULT_BRANCH_PREFIX = "odt";
export const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_SOFT_GUARDRAILS = {
  cpuHighWatermarkPercent: 85,
  minFreeMemoryMb: 2048,
  backoffSeconds: 30,
} as const;

const DEFAULT_CHAT_SETTINGS = {
  showThinkingMessages: false,
} as const;
export const DEFAULT_KANBAN_SETTINGS = {
  doneVisibleDays: 1,
} as const;
const DEFAULT_THEME = "light" as const;

export const AUTOPILOT_EVENT_IDS = [
  "taskProgressedToSpecReady",
  "taskProgressedToReadyForDev",
  "taskProgressedToAiReview",
  "taskRejectedByQa",
  "taskProgressedToHumanReview",
] as const;

export const AUTOPILOT_ACTION_IDS = [
  "startPlanner",
  "startBuilder",
  "startQa",
  "startReviewQaFeedbacks",
  "startGeneratePullRequest",
] as const;

const nullableToOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

const trimmedRequiredString = (field: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, `${field} cannot be blank.`);

const dedupeValues = <T>(values: readonly T[]) => [...new Set(values)];

export const softGuardrailsSchema = z.object({
  cpuHighWatermarkPercent: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_SOFT_GUARDRAILS.cpuHighWatermarkPercent),
  minFreeMemoryMb: z.number().int().min(128).default(DEFAULT_SOFT_GUARDRAILS.minFreeMemoryMb),
  backoffSeconds: z.number().int().min(1).default(DEFAULT_SOFT_GUARDRAILS.backoffSeconds),
});
export type SoftGuardrails = z.infer<typeof softGuardrailsSchema>;

export const repoHooksSchema = z.object({
  preStart: z.array(z.string()).default([]),
  postComplete: z.array(z.string()).default([]),
});
export type RepoHooks = z.infer<typeof repoHooksSchema>;

export const repoDevServerScriptSchema = z.object({
  id: trimmedRequiredString("Dev server id"),
  name: trimmedRequiredString("Dev server name"),
  command: trimmedRequiredString("Dev server command"),
});
export type RepoDevServerScript = z.infer<typeof repoDevServerScriptSchema>;

export const agentModelDefaultSchema = z.object({
  runtimeKind: runtimeKindSchema,
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  variant: nullableToOptional(z.string().min(1)),
  profileId: nullableToOptional(z.string().min(1)),
});
export type AgentModelDefault = z.infer<typeof agentModelDefaultSchema>;

export const repoAgentDefaultsSchema = z.object({
  spec: nullableToOptional(agentModelDefaultSchema),
  planner: nullableToOptional(agentModelDefaultSchema),
  build: nullableToOptional(agentModelDefaultSchema),
  qa: nullableToOptional(agentModelDefaultSchema),
});
export type RepoAgentDefaults = z.infer<typeof repoAgentDefaultsSchema>;

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1, "Workspace ID cannot be blank.")
  .regex(
    WORKSPACE_ID_PATTERN,
    "Workspace ID must contain only lowercase letters, digits, and single dashes.",
  );

export const workspaceNameSchema = trimmedRequiredString("Workspace name");

export const repoConfigSchema = z.object({
  workspaceId: workspaceIdSchema,
  workspaceName: workspaceNameSchema,
  repoPath: trimmedRequiredString("Repository path"),
  defaultRuntimeKind: runtimeKindSchema,
  worktreeBasePath: nullableToOptional(z.string().min(1)),
  branchPrefix: z.string().min(1).default(DEFAULT_BRANCH_PREFIX),
  defaultTargetBranch: gitTargetBranchSchema.default({ remote: "origin", branch: "main" }),
  git: repoGitConfigSchema.default({ providers: {} }),
  hooks: repoHooksSchema.default({ preStart: [], postComplete: [] }),
  devServers: z
    .array(repoDevServerScriptSchema)
    .superRefine((devServers, context) => {
      const seenIds = new Set<string>();
      for (const [index, devServer] of devServers.entries()) {
        if (seenIds.has(devServer.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate dev server id: ${devServer.id}`,
            path: [index, "id"],
          });
        }
        seenIds.add(devServer.id);
      }
    })
    .default([]),
  worktreeFileCopies: z.array(z.string()).default([]),
  promptOverrides: repoPromptOverridesSchema.default({}),
  agentDefaults: repoAgentDefaultsSchema.default({
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  }),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const chatSettingsSchema = z.object({
  showThinkingMessages: z.boolean().default(DEFAULT_CHAT_SETTINGS.showThinkingMessages),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;

export const kanbanSettingsSchema = z.object({
  doneVisibleDays: z.number().int().min(0).default(DEFAULT_KANBAN_SETTINGS.doneVisibleDays),
});
export type KanbanSettings = z.infer<typeof kanbanSettingsSchema>;

export const autopilotEventIdSchema = z.enum(AUTOPILOT_EVENT_IDS);
export type AutopilotEventId = z.infer<typeof autopilotEventIdSchema>;

export const autopilotActionIdSchema = z.enum(AUTOPILOT_ACTION_IDS);
export type AutopilotActionId = z.infer<typeof autopilotActionIdSchema>;

export const autopilotRuleSchema = z.object({
  eventId: autopilotEventIdSchema,
  actionIds: z.array(autopilotActionIdSchema).default([]).transform(dedupeValues),
});
export type AutopilotRule = z.infer<typeof autopilotRuleSchema>;

const normalizeAutopilotSettings = (value: { rules: AutopilotRule[] }) => {
  const rulesByEvent = new Map<AutopilotEventId, AutopilotRule>();
  for (const rule of value.rules) {
    const existing = rulesByEvent.get(rule.eventId);
    rulesByEvent.set(rule.eventId, {
      eventId: rule.eventId,
      actionIds: dedupeValues([...(existing?.actionIds ?? []), ...rule.actionIds]),
    });
  }

  return {
    rules: AUTOPILOT_EVENT_IDS.map(
      (eventId): AutopilotRule =>
        rulesByEvent.get(eventId) ?? {
          eventId,
          actionIds: [],
        },
    ),
  };
};

export const autopilotSettingsSchema = z
  .object({
    rules: z.array(autopilotRuleSchema).default([]),
  })
  .transform(normalizeAutopilotSettings);
export type AutopilotSettings = z.infer<typeof autopilotSettingsSchema>;

export const createDefaultAutopilotSettings = (): AutopilotSettings =>
  normalizeAutopilotSettings({ rules: [] });

const themeValueSchema = z.enum(["light", "dark"]);

export const themeSchema = themeValueSchema.default(DEFAULT_THEME);
export type Theme = z.infer<typeof themeValueSchema>;

export const globalConfigSchema = z.object({
  version: z.literal(2),
  activeWorkspace: workspaceIdSchema.optional(),
  theme: themeSchema,
  git: globalGitConfigSchema.default({ defaultMergeMethod: "merge_commit" }),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  workspaces: z.record(workspaceIdSchema, repoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
  workspaceOrder: z.array(workspaceIdSchema).default([]),
  recentWorkspaces: z.array(workspaceIdSchema).default([]),
});
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const settingsSnapshotSchema = z.object({
  theme: themeValueSchema,
  git: globalGitConfigSchema.default({ defaultMergeMethod: "merge_commit" }),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  workspaces: z.record(workspaceIdSchema, repoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
