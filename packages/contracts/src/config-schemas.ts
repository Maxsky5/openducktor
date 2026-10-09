import { claudePolicyFieldsSchema } from "./claude-policy-schemas";
import { z } from "zod";
import { openCodePermissionRulesSchema } from "./opencode-permission-schemas";
import { azureDevOpsRepositorySchema } from "./azure-devops-schemas";
import { systemOpenInToolIdSchema } from "./system-open-schemas";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { type AgentRole, agentRoleSchema } from "./agent-workflow-schemas";
import {
  gitProviderConfigSchema,
  gitTargetBranchSchema,
  githubGitProviderRepositorySchema,
  globalGitConfigSchema,
  repoGitConfigSchema,
} from "./git-schemas";
import {
  createDefaultNotificationSettings,
  notificationSettingsSchema,
} from "./notification-schemas";
import { agentPromptOverrideSchema, repoPromptOverridesSchema } from "./prompt-schemas";
import {
  workspaceAgentStudioActiveTaskSchema,
  workspaceAgentStudioStateSchema,
} from "./workspace-agent-studio-state-schemas";
import {
  workspaceAbbreviationSchema,
  workspaceTileColorSchema,
} from "./workspace-identity-schemas";
import { customAgentRoleSchema } from "./workspace-session-schemas";
import { workspaceRemovalRecordSchema } from "./workspace-lifecycle-schemas";

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
export const THEME_PREFERENCE_VALUES = ["system", "light", "dark"] as const;
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
  sidebarSessionGrouping: "task",
} as const;
export const SIDEBAR_SESSION_GROUPING_VALUES = ["task", "none"] as const;
export const DEFAULT_REUSABLE_PROMPTS = [] as const;
export const DEFAULT_KANBAN_SETTINGS = {
  doneVisibleDays: 1,
  emptyColumnDisplay: "show",
  taskCardView: "normal",
} as const;
export const KANBAN_EMPTY_COLUMN_DISPLAY_VALUES = ["show", "hidden", "collapsed"] as const;
export const KANBAN_TASK_CARD_VIEW_VALUES = ["normal", "compact"] as const;
const DEFAULT_THEME_PREFERENCE = "system" as const;

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
  approvalsReviewer: "auto_review",
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

const persistedAgentRuntimeEnabledConfigV2Schema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export const agentRuntimeEnabledConfigSchema = persistedAgentRuntimeEnabledConfigV2Schema
  .extend({
    executablePath: z.string(),
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
export type CodexRoleOverride = z.infer<typeof codexRoleOverrideSchema>;
const codexRoleOverridesSchema = z.partialRecord(agentRoleSchema, codexRoleOverrideSchema);

const persistedCodexRuntimeConfigV2Schema = persistedAgentRuntimeEnabledConfigV2Schema
  .extend({
    defaults: codexPolicyFieldsSchema.default(() => createDefaultCodexRuntimePolicy()),
    roleOverrides: codexRoleOverridesSchema.default({}),
  })
  .strict();

const withCodexRuntimeValidation = <
  T extends z.ZodType<{ roleOverrides: z.output<typeof codexRoleOverridesSchema> }>,
>(
  schema: T,
) =>
  schema.superRefine((config, context) => {
    if (config.roleOverrides.build?.sandboxMode === "read-only") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Codex build role sandboxMode cannot be read-only; use workspace-write or danger-full-access.",
        path: ["roleOverrides", "build", "sandboxMode"],
      });
    }
  });

export const codexRuntimeConfigSchema = withCodexRuntimeValidation(
  agentRuntimeEnabledConfigSchema
    .extend({
      defaults: codexPolicyFieldsSchema.default(() => createDefaultCodexRuntimePolicy()),
      roleOverrides: codexRoleOverridesSchema.default({}),
    })
    .strict(),
);
export type CodexRuntimeConfig = z.infer<typeof codexRuntimeConfigSchema>;

export const claudeRuntimeConfigSchema = agentRuntimeEnabledConfigSchema
  .extend({
    defaults: claudePolicyFieldsSchema.default({}),
    roleOverrides: z.partialRecord(agentRoleSchema, claudePolicyFieldsSchema).default({}),
  })
  .strict();
export type ClaudeRuntimeConfig = z.infer<typeof claudeRuntimeConfigSchema>;

export const openCodeRuntimeConfigSchema = agentRuntimeEnabledConfigSchema
  .extend({
    defaults: openCodePermissionRulesSchema.default(() => ({ rules: [] })),
    roleOverrides: z.partialRecord(agentRoleSchema, openCodePermissionRulesSchema).default({}),
  })
  .strict();
export type OpenCodeRuntimeConfig = z.infer<typeof openCodeRuntimeConfigSchema>;
export type AgentRuntimeConfig =
  | AgentRuntimeEnabledConfig
  | CodexRuntimeConfig
  | ClaudeRuntimeConfig
  | OpenCodeRuntimeConfig;
export type AgentRuntimes = Record<string, AgentRuntimeConfig> & {
  opencode: OpenCodeRuntimeConfig;
  codex: CodexRuntimeConfig;
  claude: ClaudeRuntimeConfig;
};

type DefaultAgentRuntimes = {
  opencode: OpenCodeRuntimeConfig;
  codex: CodexRuntimeConfig;
  claude: ClaudeRuntimeConfig;
};

const createDefaultAgentRuntimes = (): DefaultAgentRuntimes => ({
  opencode: { enabled: false, executablePath: "", defaults: { rules: [] }, roleOverrides: {} },
  codex: {
    enabled: false,
    executablePath: "",
    defaults: createDefaultCodexRuntimePolicy(),
    roleOverrides: {},
  },
  claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
});

export const DEFAULT_AGENT_RUNTIMES: AgentRuntimes = createDefaultAgentRuntimes();

export const agentRuntimesSchema = z
  .object({
    opencode: openCodeRuntimeConfigSchema.optional(),
    codex: codexRuntimeConfigSchema.optional(),
    claude: claudeRuntimeConfigSchema.optional(),
  })
  .catchall(agentRuntimeEnabledConfigSchema)
  .transform((value): AgentRuntimes => ({
    ...value,
    opencode: value.opencode ?? {
      enabled: false,
      executablePath: "",
      defaults: { rules: [] },
      roleOverrides: {},
    },
    codex: value.codex ?? {
      enabled: false,
      executablePath: "",
      defaults: createDefaultCodexRuntimePolicy(),
      roleOverrides: {},
    },
    claude: value.claude ?? { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
  }))
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

  const effectivePolicy: CodexEffectivePolicy = {
    ...policy,
    sandboxMode,
    approvalsReviewerApplies: policy.approvalPolicy !== "never",
    commandNetworkAccess:
      sandboxMode === "danger-full-access" ? false : policy.commandNetworkAccess,
  };

  if (adjustmentReason) {
    effectivePolicy.adjustmentReason = adjustmentReason;
  }

  return effectivePolicy;
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

const checkReusablePrompts = (
  prompts: ReusablePrompt[],
  context: z.core.$RefinementCtx<ReusablePrompt[]>,
): void => {
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

    const name = prompt.name.toLowerCase();
    const firstIndex = seenNames.get(name);
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
      seenNames.set(name, index);
    }
  }
};

export const reusablePromptsSchema = z
  .array(reusablePromptSchema)
  .superRefine(checkReusablePrompts)
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
  postComplete: z.array(z.string()).default([]),
});
export type RepoHooks = z.infer<typeof repoHooksSchema>;

export const REPO_ACTION_ICON_VALUES = [
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
] as const;
export const repoActionIconSchema = z.enum(REPO_ACTION_ICON_VALUES);
export type RepoActionIcon = z.infer<typeof repoActionIconSchema>;

/**
 * The lines that an action runs: each non-blank line that does not start with `#`. The lines share
 * one shell process, and a line runs only after the previous line succeeds. Comment lines are
 * skipped, because an interactive zsh runs `#` as a command.
 */
export const repoActionCommandLines = (command: string): string[] =>
  command
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

export const repoActionSchema = z.object({
  id: trimmedRequiredString("Action id"),
  icon: repoActionIconSchema,
  name: trimmedRequiredString("Action name"),
  command: trimmedRequiredString("Action command").refine(
    (command) => repoActionCommandLines(command).length > 0,
    "Add a command line. Lines that start with # are comments.",
  ),
  runOnWorktreeCreate: z.boolean(),
  waitBeforeAgentStart: z.boolean(),
});
export type RepoAction = z.infer<typeof repoActionSchema>;

// List order is the session menu order and the worktree-creation run order.
export const repoActionsSchema = z
  .object({
    items: z.array(repoActionSchema),
    defaultActionId: z.string().min(1).nullable(),
  })
  .superRefine((actions, context) => {
    const seenIds = new Set<string>();
    for (const [index, action] of actions.items.entries()) {
      if (seenIds.has(action.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate action id: ${action.id}`,
          path: ["items", index, "id"],
        });
      }
      seenIds.add(action.id);
      if (action.waitBeforeAgentStart && !action.runOnWorktreeCreate) {
        context.addIssue({
          code: "custom",
          message: `Action "${action.name}" can make the agent wait only when it runs on worktree creation.`,
          path: ["items", index, "waitBeforeAgentStart"],
        });
      }
    }
    if (actions.items.length === 0) {
      if (actions.defaultActionId !== null) {
        context.addIssue({
          code: "custom",
          message: "A repository with no actions cannot have a default action.",
          path: ["defaultActionId"],
        });
      }
    } else if (actions.defaultActionId === null || !seenIds.has(actions.defaultActionId)) {
      context.addIssue({
        code: "custom",
        message: "The default action must be one of the repository actions.",
        path: ["defaultActionId"],
      });
    }
  });
export type RepoActions = z.infer<typeof repoActionsSchema>;

const createEmptyRepoActions = (): RepoActions => ({ items: [], defaultActionId: null });

const persistedRepoActionsSchema = repoActionsSchema
  .safeExtend({ items: z.array(repoActionSchema.strict()) })
  .strict();

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

const persistedAgentModelDefaultSchema = agentModelDefaultSchema.strict();
const persistedRepoAgentDefaultsSchema = repoAgentDefaultsSchema
  .safeExtend({
    spec: nullableToOptional(persistedAgentModelDefaultSchema),
    planner: nullableToOptional(persistedAgentModelDefaultSchema),
    build: nullableToOptional(persistedAgentModelDefaultSchema),
    qa: nullableToOptional(persistedAgentModelDefaultSchema),
  })
  .strict();

const persistedPromptOverridesSchema = z
  .record(z.string(), agentPromptOverrideSchema.strict())
  .pipe(repoPromptOverridesSchema.removeDefault());

const persistedGitProviderSchema = gitProviderConfigSchema.safeExtend({
  repository: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.union([azureDevOpsRepositorySchema, githubGitProviderRepositorySchema.strict()]).optional(),
  ),
});
const persistedRepoGitConfigSchema = repoGitConfigSchema.safeExtend({
  provider: persistedGitProviderSchema.optional(),
});

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1, "Workspace ID cannot be blank.")
  .regex(
    WORKSPACE_ID_PATTERN,
    "Workspace ID must contain only lowercase letters, digits, and single dashes.",
  );

export const workspaceNameSchema = trimmedRequiredString("Workspace name");

const DEFAULT_REPO_TARGET_BRANCH = { remote: "origin", branch: "main" };

export const repoConfigSchema = z.object({
  workspaceId: workspaceIdSchema,
  workspaceName: workspaceNameSchema,
  abbreviation: nullableToOptional(workspaceAbbreviationSchema),
  tileColor: nullableToOptional(workspaceTileColorSchema),
  repoPath: trimmedRequiredString("Repository path"),
  defaultModel: nullableToOptional(agentModelDefaultSchema),
  worktreeBasePath: nullableToOptional(z.string().min(1)),
  branchPrefix: z.string().min(1).default(DEFAULT_BRANCH_PREFIX),
  defaultTargetBranch: gitTargetBranchSchema.default(DEFAULT_REPO_TARGET_BRANCH),
  git: repoGitConfigSchema.default({}),
  hooks: repoHooksSchema.default({ postComplete: [] }),
  actions: repoActionsSchema.default(createEmptyRepoActions),
  worktreeCopyPaths: z.array(z.string()).default([]),
  promptOverrides: repoPromptOverridesSchema.default({}),
  agentDefaults: repoAgentDefaultsSchema.default({
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  }),
  agentStudioState: workspaceAgentStudioStateSchema,
  closed: z.boolean().optional(),
  removal: workspaceRemovalRecordSchema.optional(),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

const persistedRepoConfigSchema = repoConfigSchema
  .safeExtend({
    defaultModel: nullableToOptional(persistedAgentModelDefaultSchema),
    defaultTargetBranch: gitTargetBranchSchema.strict().default(DEFAULT_REPO_TARGET_BRANCH),
    git: persistedRepoGitConfigSchema.default({}),
    hooks: repoHooksSchema.strict().default({ postComplete: [] }),
    actions: persistedRepoActionsSchema.default(createEmptyRepoActions),
    promptOverrides: persistedPromptOverridesSchema.default({}),
    agentDefaults: persistedRepoAgentDefaultsSchema.default({
      spec: undefined,
      planner: undefined,
      build: undefined,
      qa: undefined,
    }),
    agentStudioState: workspaceAgentStudioStateSchema
      .removeDefault()
      .safeExtend({ activeTask: workspaceAgentStudioActiveTaskSchema.strict().optional() })
      .strict()
      .default({ openTaskIds: [] }),
    removal: workspaceRemovalRecordSchema.strict().optional(),
  })
  .strict();

export const settingsRepoConfigSchema = repoConfigSchema.omit({
  agentStudioState: true,
  closed: true,
  removal: true,
});
export type SettingsRepoConfig = z.infer<typeof settingsRepoConfigSchema>;

export const workspaceRepoHooksInputSchema = repoHooksSchema.partial();
export type WorkspaceRepoHooksInput = z.output<typeof workspaceRepoHooksInputSchema>;

export const workspaceRepoConfigInputSchema = repoConfigSchema
  .pick({
    defaultModel: true,
    worktreeBasePath: true,
    branchPrefix: true,
    defaultTargetBranch: true,
    git: true,
    actions: true,
    worktreeCopyPaths: true,
    agentDefaults: true,
    promptOverrides: true,
  })
  .partial();
export type WorkspaceRepoConfigInput = z.output<typeof workspaceRepoConfigInputSchema>;

export const workspaceRepoSettingsInputSchema = workspaceRepoConfigInputSchema.extend({
  hooks: workspaceRepoHooksInputSchema.optional(),
});
export type WorkspaceRepoSettingsInput = z.output<typeof workspaceRepoSettingsInputSchema>;

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

export const sidebarSessionGroupingSchema = z.enum(SIDEBAR_SESSION_GROUPING_VALUES);
export type SidebarSessionGrouping = z.infer<typeof sidebarSessionGroupingSchema>;

export const appPlatformSchema = z.enum(APP_PLATFORM_VALUES);
export type AppPlatform = z.infer<typeof appPlatformSchema>;

export const appearanceSettingsSchema = z.object({
  horizontalScrollbarVisibility: horizontalScrollbarVisibilitySchema.default(
    DEFAULT_APPEARANCE_SETTINGS.horizontalScrollbarVisibility,
  ),
  sidebarSessionGrouping: sidebarSessionGroupingSchema.default(
    DEFAULT_APPEARANCE_SETTINGS.sidebarSessionGrouping,
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
  taskCardView: z.enum(KANBAN_TASK_CARD_VIEW_VALUES).default(DEFAULT_KANBAN_SETTINGS.taskCardView),
});
export const kanbanEmptyColumnDisplaySchema = z.enum(KANBAN_EMPTY_COLUMN_DISPLAY_VALUES);
export const kanbanTaskCardViewSchema = z.enum(KANBAN_TASK_CARD_VIEW_VALUES);
export type KanbanEmptyColumnDisplay = z.infer<typeof kanbanEmptyColumnDisplaySchema>;
export type KanbanTaskCardView = z.infer<typeof kanbanTaskCardViewSchema>;
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

const normalizeAutopilotSettings = (value: {
  alwaysStartQaReviewsFresh: boolean;
  rules: AutopilotRule[];
}) => {
  const rulesByEvent = new Map<AutopilotEventId, AutopilotRule>();
  for (const rule of value.rules) {
    const existing = rulesByEvent.get(rule.eventId);
    rulesByEvent.set(rule.eventId, {
      eventId: rule.eventId,
      actionIds: dedupeValues([...(existing?.actionIds ?? []), ...rule.actionIds]),
    });
  }

  return {
    alwaysStartQaReviewsFresh: value.alwaysStartQaReviewsFresh,
    rules: AUTOPILOT_EVENT_IDS.map(
      (eventId): AutopilotRule =>
        rulesByEvent.get(eventId) ?? {
          eventId,
          actionIds: [],
        },
    ),
  };
};

const autopilotSettingsInputSchema = z.object({
  alwaysStartQaReviewsFresh: z.boolean().default(false),
  rules: z.array(autopilotRuleSchema).default([]),
});

export const autopilotSettingsSchema = autopilotSettingsInputSchema.transform(
  normalizeAutopilotSettings,
);
export type AutopilotSettings = z.infer<typeof autopilotSettingsSchema>;

const persistedAutopilotSettingsSchema = autopilotSettingsInputSchema
  .safeExtend({ rules: z.array(autopilotRuleSchema.strict()).default([]) })
  .strict()
  .transform(normalizeAutopilotSettings);

export const createDefaultAutopilotSettings = (): AutopilotSettings =>
  normalizeAutopilotSettings({ alwaysStartQaReviewsFresh: false, rules: [] });

const themeValueSchema = z.enum(["light", "dark"]);
const themePreferenceValueSchema = z.enum(THEME_PREFERENCE_VALUES);

export const themePreferenceSchema = themePreferenceValueSchema.default(DEFAULT_THEME_PREFERENCE);
export type ThemePreference = z.infer<typeof themePreferenceValueSchema>;
export type Theme = z.infer<typeof themeValueSchema>;

const persistedAgentRuntimesV2Schema = z
  .object({
    opencode: persistedAgentRuntimeEnabledConfigV2Schema.optional(),
    codex: withCodexRuntimeValidation(persistedCodexRuntimeConfigV2Schema).optional(),
    claude: persistedAgentRuntimeEnabledConfigV2Schema.optional(),
  })
  .catchall(persistedAgentRuntimeEnabledConfigV2Schema)
  .transform((value) => ({
    ...value,
    opencode: value.opencode ?? { enabled: true },
    codex: value.codex ?? {
      enabled: false,
      defaults: createDefaultCodexRuntimePolicy(),
      roleOverrides: {},
    },
    claude: value.claude ?? { enabled: false },
  }))
  .default(() => ({
    opencode: { enabled: true },
    codex: {
      enabled: false,
      defaults: createDefaultCodexRuntimePolicy(),
      roleOverrides: {},
    },
    claude: { enabled: false },
  }));

export const agentModelFavoriteSchema = z
  .object({
    runtimeKind: runtimeKindSchema,
    providerId: trimmedRequiredString("Favorite provider id"),
    modelId: trimmedRequiredString("Favorite model id"),
  })
  .strict();
export type AgentModelFavorite = z.infer<typeof agentModelFavoriteSchema>;

export const agentModelFavoriteKey = (favorite: AgentModelFavorite): string =>
  `${favorite.runtimeKind}\u0000${favorite.providerId}\u0000${favorite.modelId}`;

export const isSameAgentModelFavorite = (
  left: AgentModelFavorite | null,
  right: AgentModelFavorite | null,
): boolean =>
  left?.runtimeKind === right?.runtimeKind &&
  left?.providerId === right?.providerId &&
  left?.modelId === right?.modelId;

export const agentModelFavoritesSchema = z
  .array(agentModelFavoriteSchema)
  .transform((favorites) => {
    const seen = new Set<string>();
    return favorites.filter((favorite) => {
      const key = agentModelFavoriteKey(favorite);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  })
  .default([]);

export const systemSettingsSchema = z.object({
  preferredOpenInToolId: systemOpenInToolIdSchema.optional(),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

const globalConfigSharedFields = {
  system: systemSettingsSchema.default({}),
  customAgentRoles: z
    .array(customAgentRoleSchema)
    .superRefine((roles, context) => {
      const ids = new Set<string>();
      const names = new Set<string>();
      for (const [index, role] of roles.entries()) {
        const name = role.name.toLowerCase();
        if (ids.has(role.id) || names.has(name)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Custom Agent Role IDs and names must be unique.",
          });
        }
        ids.add(role.id);
        names.add(name);
      }
    })
    .default([]),
  activeWorkspace: workspaceIdSchema.optional(),
  theme: themePreferenceSchema,
  git: globalGitConfigSchema.default({ defaultMergeMethod: "merge_commit" }),
  general: generalSettingsSchema.default(DEFAULT_GENERAL_SETTINGS),
  appearance: appearanceSettingsSchema.default(DEFAULT_APPEARANCE_SETTINGS),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  reusablePrompts: reusablePromptsSchema.default(() => [...DEFAULT_REUSABLE_PROMPTS]),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  notifications: notificationSettingsSchema.default(() => createDefaultNotificationSettings()),
  agentRuntimes: agentRuntimesSchema,
  agentModelFavorites: agentModelFavoritesSchema,
  workspaces: z.record(workspaceIdSchema, repoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
  workspaceOrder: z.array(workspaceIdSchema).default([]),
  recentWorkspaces: z.array(workspaceIdSchema).default([]),
};

const persistedGlobalConfigFields = {
  ...globalConfigSharedFields,
  system: systemSettingsSchema.strict().default({}),
  git: globalGitConfigSchema.strict().default({ defaultMergeMethod: "merge_commit" }),
  general: generalSettingsSchema.strict().default(DEFAULT_GENERAL_SETTINGS),
  appearance: appearanceSettingsSchema.strict().default(DEFAULT_APPEARANCE_SETTINGS),
  chat: chatSettingsSchema.strict().default(DEFAULT_CHAT_SETTINGS),
  reusablePrompts: z
    .array(reusablePromptSchema.strict())
    .superRefine(checkReusablePrompts)
    .default(() => [...DEFAULT_REUSABLE_PROMPTS]),
  kanban: kanbanSettingsSchema.strict().default(DEFAULT_KANBAN_SETTINGS),
  autopilot: persistedAutopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  globalPromptOverrides: persistedPromptOverridesSchema.default({}),
};

const persistedWorkspacesSchema = z
  .record(workspaceIdSchema, persistedRepoConfigSchema)
  .default({});

export const persistedGlobalConfigV2Schema = z.strictObject({
  version: z.literal(2),
  ...persistedGlobalConfigFields,
  workspaces: persistedWorkspacesSchema,
  agentRuntimes: persistedAgentRuntimesV2Schema,
});
export type PersistedGlobalConfigV2 = z.infer<typeof persistedGlobalConfigV2Schema>;

export const persistedGlobalConfigV3Schema = z.strictObject({
  version: z.literal(3),
  ...persistedGlobalConfigFields,
  workspaces: persistedWorkspacesSchema,
  agentRuntimes: agentRuntimesSchema,
});
export type PersistedGlobalConfigV3 = z.infer<typeof persistedGlobalConfigV3Schema>;

export const globalConfigSchema = z.object({
  version: z.literal(4),
  ...globalConfigSharedFields,
  agentRuntimes: agentRuntimesSchema,
});
export const persistedGlobalConfigV4Schema = globalConfigSchema
  .safeExtend({ ...persistedGlobalConfigFields, workspaces: persistedWorkspacesSchema })
  .strict();
type ParsedGlobalConfig = z.infer<typeof globalConfigSchema>;
export type GlobalConfig = ParsedGlobalConfig;

export const settingsSnapshotSchema = z.object({
  system: systemSettingsSchema.default({}),
  customAgentRoles: globalConfigSharedFields.customAgentRoles,
  theme: themePreferenceValueSchema,
  git: globalGitConfigSchema.default({ defaultMergeMethod: "merge_commit" }),
  general: generalSettingsSchema.default(DEFAULT_GENERAL_SETTINGS),
  appearance: appearanceSettingsSchema.default(DEFAULT_APPEARANCE_SETTINGS),
  chat: chatSettingsSchema.default(DEFAULT_CHAT_SETTINGS),
  reusablePrompts: reusablePromptsSchema.default(() => [...DEFAULT_REUSABLE_PROMPTS]),
  kanban: kanbanSettingsSchema.default(DEFAULT_KANBAN_SETTINGS),
  autopilot: autopilotSettingsSchema.default(() => createDefaultAutopilotSettings()),
  notifications: notificationSettingsSchema.default(() => createDefaultNotificationSettings()),
  agentRuntimes: agentRuntimesSchema,
  agentModelFavorites: agentModelFavoritesSchema,
  workspaces: z.record(workspaceIdSchema, settingsRepoConfigSchema).default({}),
  globalPromptOverrides: repoPromptOverridesSchema.default({}),
});
type ParsedSettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
export type SettingsSnapshot = ParsedSettingsSnapshot;

const settingsSnapshotSaveAgentModelFavoritesSchema = agentModelFavoritesSchema
  .removeDefault()
  .describe(
    "Echo the current canonical favorites. Change favorites through the narrow favorites command.",
  );

export const settingsSnapshotSaveInputSchema = z.object({
  system: systemSettingsSchema,
  customAgentRoles: globalConfigSharedFields.customAgentRoles
    .removeDefault()
    .optional()
    .describe(
      "Replace custom roles only when this section was edited. Omit to leave saved roles unchanged.",
    ),
  git: globalGitConfigSchema,
  general: generalSettingsSchema,
  appearance: appearanceSettingsSchema,
  chat: chatSettingsSchema,
  reusablePrompts: reusablePromptsSchema.removeDefault(),
  kanban: kanbanSettingsSchema,
  autopilot: autopilotSettingsSchema,
  notifications: notificationSettingsSchema.removeDefault(),
  agentRuntimes: agentRuntimesSchema.removeDefault(),
  agentModelFavorites: settingsSnapshotSaveAgentModelFavoritesSchema,
  workspaces: z.record(workspaceIdSchema, settingsRepoConfigSchema),
  globalPromptOverrides: repoPromptOverridesSchema,
});
export type SettingsSnapshotSaveInput = z.infer<typeof settingsSnapshotSaveInputSchema>;
