import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { type AgentRole, agentRoleValues } from "./agent-workflow-schemas";
import { gitTargetBranchSchema, globalGitConfigSchema, repoGitConfigSchema } from "./git-schemas";
import { repoPromptOverridesSchema } from "./prompt-schemas";

export const DEFAULT_BRANCH_PREFIX = "odt";
export const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CHAT_DIFF_STYLE_VALUES = ["split", "unified"] as const;
export const CHAT_DIFF_INDICATOR_VALUES = ["bars", "classic", "none"] as const;
export const CHAT_DIFF_HEIGHT_VALUES = ["full", "scroll"] as const;
export const CHAT_LINE_OVERFLOW_VALUES = ["wrap", "scroll"] as const;
export const CHAT_HUNK_SEPARATOR_VALUES = [
  "line-info",
  "line-info-basic",
  "metadata",
  "simple",
] as const;
export const HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES = ["system", "show", "hide"] as const;
export const APP_PLATFORM_VALUES = ["win32", "linux", "darwin"] as const;

const DEFAULT_SOFT_GUARDRAILS = {
  cpuHighWatermarkPercent: 85,
  minFreeMemoryMb: 2048,
  backoffSeconds: 30,
} as const;

export const DEFAULT_CHAT_SETTINGS = {
  showThinkingMessages: false,
  expandFileDiffsByDefault: true,
  diffStyle: "split",
  diffIndicators: "bars",
  diffHeight: "full",
  lineOverflow: "wrap",
  hunkSeparators: "line-info",
} as const;
export const DEFAULT_GENERAL_SETTINGS = {
  openAgentStudioTabOnBackgroundSessionStart: true,
} as const;
export const DEFAULT_APPEARANCE_SETTINGS = {
  horizontalScrollbarVisibility: "system",
} as const;
export const DEFAULT_REUSABLE_PROMPTS = [] as const;
export const DEFAULT_KANBAN_SETTINGS = {
  doneVisibleDays: 1,
  emptyColumnDisplay: "show",
} as const;
export const KANBAN_EMPTY_COLUMN_DISPLAY_VALUES = ["show", "hidden", "collapsed"] as const;
const DEFAULT_THEME = "light" as const;

export const CODEX_SANDBOX_MODE_VALUES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;
export const CODEX_APPROVAL_POLICY_VALUES = ["untrusted", "on-request", "never"] as const;
export const CODEX_APPROVALS_REVIEWER_VALUES = ["user", "auto_review"] as const;

export const DEFAULT_CODEX_RUNTIME_POLICY = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commandNetworkAccess: false,
} as const;

const createDefaultCodexRuntimePolicy = (): CodexPolicyFields => ({
  ...DEFAULT_CODEX_RUNTIME_POLICY,
});

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

export const agentRuntimeEnabledConfigSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export const agentRuntimeConfigSchema = agentRuntimeEnabledConfigSchema;
export type AgentRuntimeEnabledConfig = z.infer<typeof agentRuntimeEnabledConfigSchema>;

export const codexSandboxModeSchema = z.enum(CODEX_SANDBOX_MODE_VALUES);
export const codexApprovalPolicySchema = z.enum(CODEX_APPROVAL_POLICY_VALUES);
export const codexApprovalsReviewerSchema = z.enum(CODEX_APPROVALS_REVIEWER_VALUES);

export const codexPolicyFieldsSchema = z
  .object({
    sandboxMode: codexSandboxModeSchema.default(DEFAULT_CODEX_RUNTIME_POLICY.sandboxMode),
    approvalPolicy: codexApprovalPolicySchema.default(DEFAULT_CODEX_RUNTIME_POLICY.approvalPolicy),
    approvalsReviewer: codexApprovalsReviewerSchema.default(
      DEFAULT_CODEX_RUNTIME_POLICY.approvalsReviewer,
    ),
    commandNetworkAccess: z.boolean().default(DEFAULT_CODEX_RUNTIME_POLICY.commandNetworkAccess),
  })
  .strict();
export type CodexPolicyFields = z.infer<typeof codexPolicyFieldsSchema>;

const codexRoleOverrideSchema = z
  .object({
    sandboxMode: codexSandboxModeSchema.optional(),
    approvalPolicy: codexApprovalPolicySchema.optional(),
    approvalsReviewer: codexApprovalsReviewerSchema.optional(),
    commandNetworkAccess: z.boolean().optional(),
  })
  .strict();
const codexRoleOverridesSchema = z
  .record(z.string(), codexRoleOverrideSchema)
  .superRefine((overrides, context) => {
    const supportedRoles = new Set<string>(agentRoleValues);
    for (const role of Object.keys(overrides)) {
      if (!supportedRoles.has(role)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported Codex role override: ${role}`,
          path: [role],
        });
      }
    }
  })
  .transform(
    (overrides) => overrides as Partial<Record<AgentRole, z.infer<typeof codexRoleOverrideSchema>>>,
  );

export const codexRuntimeConfigSchema = agentRuntimeEnabledConfigSchema
  .extend({
    defaults: codexPolicyFieldsSchema.default(() => createDefaultCodexRuntimePolicy()),
    roleOverrides: codexRoleOverridesSchema.default({}),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.roleOverrides.build?.sandboxMode === "read-only") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Codex build role sandboxMode cannot be read-only; use workspace-write or danger-full-access.",
        path: ["roleOverrides", "build", "sandboxMode"],
      });
    }
  });
export type CodexRuntimeConfig = z.infer<typeof codexRuntimeConfigSchema>;

export type AgentRuntimeConfig = AgentRuntimeEnabledConfig | CodexRuntimeConfig;
export type AgentRuntimes = Record<string, AgentRuntimeConfig> & {
  opencode: AgentRuntimeEnabledConfig;
  codex: CodexRuntimeConfig;
  claude: AgentRuntimeEnabledConfig;
};

type DefaultAgentRuntimes = {
  opencode: AgentRuntimeEnabledConfig;
  codex: CodexRuntimeConfig;
  claude: AgentRuntimeEnabledConfig;
};

const createDefaultAgentRuntimes = (): DefaultAgentRuntimes => ({
  opencode: { enabled: true },
  codex: { enabled: false, defaults: createDefaultCodexRuntimePolicy(), roleOverrides: {} },
  claude: { enabled: false },
});

export const DEFAULT_AGENT_RUNTIMES: AgentRuntimes = createDefaultAgentRuntimes();

export const agentRuntimesSchema = z
  .object({
    opencode: agentRuntimeEnabledConfigSchema.optional(),
    codex: codexRuntimeConfigSchema.optional(),
    claude: agentRuntimeEnabledConfigSchema.optional(),
  })
  .catchall(agentRuntimeEnabledConfigSchema)
  .transform(
    (value): AgentRuntimes => ({
      ...value,
      opencode: value.opencode ?? { enabled: true },
      codex: value.codex ?? {
        enabled: false,
        defaults: createDefaultCodexRuntimePolicy(),
        roleOverrides: {},
      },
      claude: value.claude ?? { enabled: false },
    }),
  )
  .default(() => createDefaultAgentRuntimes());

export type CodexEffectivePolicy = CodexPolicyFields & {
  approvalsReviewerApplies: boolean;
  adjustmentReason?: string;
};

export const codexEffectivePolicySchema = z
  .object({
    sandboxMode: codexSandboxModeSchema,
    approvalPolicy: codexApprovalPolicySchema,
    approvalsReviewer: codexApprovalsReviewerSchema,
    commandNetworkAccess: z.boolean(),
    approvalsReviewerApplies: z.boolean(),
    adjustmentReason: z.string().trim().min(1).optional(),
  })
  .strict();

export const resolveCodexEffectivePolicy = (
  config: CodexRuntimeConfig,
  role?: AgentRole | null,
): CodexEffectivePolicy => {
  const override = role ? (config.roleOverrides[role] ?? {}) : {};
  const inheritedSandboxMode = override.sandboxMode === undefined;
  const policy: CodexPolicyFields = {
    sandboxMode: override.sandboxMode ?? config.defaults.sandboxMode,
    approvalPolicy: override.approvalPolicy ?? config.defaults.approvalPolicy,
    approvalsReviewer: override.approvalsReviewer ?? config.defaults.approvalsReviewer,
    commandNetworkAccess: override.commandNetworkAccess ?? config.defaults.commandNetworkAccess,
  };

  const adjustmentReason =
    role === "build" && inheritedSandboxMode && policy.sandboxMode === "read-only"
      ? "Build role requires workspace-write when sandboxMode is inherited from read-only."
      : undefined;
  const sandboxMode = adjustmentReason ? "workspace-write" : policy.sandboxMode;

  return {
    ...policy,
    sandboxMode,
    approvalsReviewerApplies: policy.approvalPolicy !== "never",
    commandNetworkAccess:
      sandboxMode === "danger-full-access" ? false : policy.commandNetworkAccess,
    ...(adjustmentReason ? { adjustmentReason } : {}),
  };
};

export const REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";
export const REUSABLE_PROMPT_TRIGGER_PATTERN = /^[a-zA-Z0-9._:-]+$/;

const reusablePromptNameSchema = trimmedRequiredString("Reusable prompt name").refine(
  (value) => REUSABLE_PROMPT_TRIGGER_PATTERN.test(value),
  "Reusable prompt name must contain only letters, digits, dots, underscores, colons, or dashes.",
);

export const reusablePromptSchema = z.object({
  id: trimmedRequiredString("Reusable prompt id"),
  name: reusablePromptNameSchema,
  description: z
    .string()
    .default("")
    .transform((value) => value.trim()),
  content: trimmedRequiredString("Reusable prompt content"),
});
export type ReusablePrompt = z.infer<typeof reusablePromptSchema>;

export const reusablePromptsSchema = z
  .array(reusablePromptSchema)
  .superRefine((prompts, context) => {
    const seenIds = new Map<string, number>();
    const seenNames = new Map<string, number>();
    for (const [index, prompt] of prompts.entries()) {
      const firstIdIndex = seenIds.get(prompt.id);
      if (firstIdIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate reusable prompt id: ${prompt.id}`,
          path: [index, "id"],
        });
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate reusable prompt id: ${prompt.id}`,
          path: [firstIdIndex, "id"],
        });
      } else {
        seenIds.set(prompt.id, index);
      }

      const normalizedName = prompt.name.toLowerCase();
      const firstIndex = seenNames.get(normalizedName);
      if (firstIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate reusable prompt name: ${prompt.name}`,
          path: [index, "name"],
        });
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate reusable prompt name: ${prompt.name}`,
          path: [firstIndex, "name"],
        });
      } else {
        seenNames.set(normalizedName, index);
      }
    }
  })
  .default([]);

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
  defaultTargetBranch: gitTargetBranchSchema.default({
    remote: "origin",
    branch: "main",
  }),
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
  worktreeCopyPaths: z.array(z.string()).default([]),
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
  expandFileDiffsByDefault: z.boolean().default(DEFAULT_CHAT_SETTINGS.expandFileDiffsByDefault),
  diffStyle: z.enum(CHAT_DIFF_STYLE_VALUES).default(DEFAULT_CHAT_SETTINGS.diffStyle),
  diffIndicators: z.enum(CHAT_DIFF_INDICATOR_VALUES).default(DEFAULT_CHAT_SETTINGS.diffIndicators),
  diffHeight: z.enum(CHAT_DIFF_HEIGHT_VALUES).default(DEFAULT_CHAT_SETTINGS.diffHeight),
  lineOverflow: z.enum(CHAT_LINE_OVERFLOW_VALUES).default(DEFAULT_CHAT_SETTINGS.lineOverflow),
  hunkSeparators: z.enum(CHAT_HUNK_SEPARATOR_VALUES).default(DEFAULT_CHAT_SETTINGS.hunkSeparators),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
export type ChatDiffStyle = z.infer<typeof chatSettingsSchema>["diffStyle"];
export type ChatDiffIndicators = z.infer<typeof chatSettingsSchema>["diffIndicators"];
export type ChatDiffHeight = z.infer<typeof chatSettingsSchema>["diffHeight"];
export type ChatLineOverflow = z.infer<typeof chatSettingsSchema>["lineOverflow"];
export type ChatHunkSeparators = z.infer<typeof chatSettingsSchema>["hunkSeparators"];

export const generalSettingsSchema = z.object({
  openAgentStudioTabOnBackgroundSessionStart: z
    .boolean()
    .default(DEFAULT_GENERAL_SETTINGS.openAgentStudioTabOnBackgroundSessionStart),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export const horizontalScrollbarVisibilitySchema = z.enum(HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES);
export type HorizontalScrollbarVisibility = z.infer<typeof horizontalScrollbarVisibilitySchema>;

export const appPlatformSchema = z.enum(APP_PLATFORM_VALUES);
export type AppPlatform = z.infer<typeof appPlatformSchema>;

export const appearanceSettingsSchema = z.object({
  horizontalScrollbarVisibility: horizontalScrollbarVisibilitySchema.default(
    DEFAULT_APPEARANCE_SETTINGS.horizontalScrollbarVisibility,
  ),
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

export const resolveHorizontalScrollbarVisibility = (
  visibility: HorizontalScrollbarVisibility,
  platform?: AppPlatform | null,
): Exclude<HorizontalScrollbarVisibility, "system"> => {
  if (visibility === "show" || visibility === "hide") {
    return visibility;
  }

  if (platform === null || platform === undefined) {
    throw new Error(
      "A supported app platform is required to resolve System default horizontal scrollbar visibility.",
    );
  }

  // Keep runtime validation for JavaScript callers and unsafe casts crossing the package boundary.
  const parsedPlatform = appPlatformSchema.safeParse(platform);
  if (!parsedPlatform.success) {
    throw new Error(`Unsupported app platform for horizontal scrollbar visibility: ${platform}`);
  }

  return parsedPlatform.data === "darwin" ? "hide" : "show";
};

export const kanbanSettingsSchema = z.object({
  doneVisibleDays: z.number().int().min(0).default(DEFAULT_KANBAN_SETTINGS.doneVisibleDays),
  emptyColumnDisplay: z
    .enum(KANBAN_EMPTY_COLUMN_DISPLAY_VALUES)
    .default(DEFAULT_KANBAN_SETTINGS.emptyColumnDisplay),
});
export const kanbanEmptyColumnDisplaySchema = z.enum(KANBAN_EMPTY_COLUMN_DISPLAY_VALUES);
export type KanbanEmptyColumnDisplay = z.infer<typeof kanbanEmptyColumnDisplaySchema>;
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
  general: generalSettingsSchema.default(DEFAULT_GENERAL_SETTINGS),
  appearance: appearanceSettingsSchema.default(DEFAULT_APPEARANCE_SETTINGS),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  reusablePrompts: reusablePromptsSchema.default(() => [...DEFAULT_REUSABLE_PROMPTS]),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  agentRuntimes: agentRuntimesSchema,
  workspaces: z.record(workspaceIdSchema, repoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
  workspaceOrder: z.array(workspaceIdSchema).default([]),
  recentWorkspaces: z.array(workspaceIdSchema).default([]),
});
type ParsedGlobalConfig = z.infer<typeof globalConfigSchema>;
export type GlobalConfig = ParsedGlobalConfig;

export const settingsSnapshotSchema = z.object({
  theme: themeValueSchema,
  git: globalGitConfigSchema.default({ defaultMergeMethod: "merge_commit" }),
  general: generalSettingsSchema.default(DEFAULT_GENERAL_SETTINGS),
  appearance: appearanceSettingsSchema.default(DEFAULT_APPEARANCE_SETTINGS),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  reusablePrompts: reusablePromptsSchema.default(() => [...DEFAULT_REUSABLE_PROMPTS]),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  agentRuntimes: agentRuntimesSchema,
  workspaces: z.record(workspaceIdSchema, repoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
});
type ParsedSettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
export type SettingsSnapshot = ParsedSettingsSnapshot;

export const settingsSnapshotSaveInputSchema = z.object({
  git: globalGitConfigSchema,
  general: generalSettingsSchema,
  appearance: appearanceSettingsSchema,
  chat: chatSettingsSchema,
  reusablePrompts: reusablePromptsSchema.removeDefault(),
  kanban: kanbanSettingsSchema,
  autopilot: autopilotSettingsSchema,
  agentRuntimes: agentRuntimesSchema.removeDefault(),
  workspaces: z.record(workspaceIdSchema, repoConfigSchema),
  globalPromptOverrides: repoPromptOverridesSchema,
});
export type SettingsSnapshotSaveInput = z.infer<typeof settingsSnapshotSaveInputSchema>;
