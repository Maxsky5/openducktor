import { z } from "zod";

export const taskStatusSchema = z.enum([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "deferred",
  "closed",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const issueTypeSchema = z.enum(["task", "feature", "bug", "epic"]);
export type IssueType = z.infer<typeof issueTypeSchema>;

export const taskActionSchema = z.enum([
  "view_details",
  "set_spec",
  "set_plan",
  "build_start",
  "open_builder",
  "defer_issue",
  "resume_deferred",
  "human_request_changes",
  "human_approve",
]);
export type TaskAction = z.infer<typeof taskActionSchema>;

const issueTypeFallbackSchema = z.preprocess(
  (value) =>
    value === "task" || value === "feature" || value === "bug" || value === "epic" ? value : "task",
  issueTypeSchema,
);

export const taskPrioritySchema = z.number().int().min(0).max(4);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(""),
  acceptanceCriteria: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  status: taskStatusSchema,
  priority: taskPrioritySchema.default(2),
  issueType: issueTypeFallbackSchema.default("task"),
  aiReviewEnabled: z.boolean().optional().default(true),
  availableActions: z.array(taskActionSchema).default([]),
  labels: z.array(z.string()).default([]),
  assignee: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  parentId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  subtaskIds: z.array(z.string()).default([]),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type TaskCard = z.infer<typeof taskCardSchema>;

export const taskCreateInputSchema = z.object({
  title: z.string().min(1),
  issueType: issueTypeSchema.default("task"),
  aiReviewEnabled: z.boolean().optional().default(true),
  priority: taskPrioritySchema.default(2),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  labels: z.array(z.string()).optional(),
  parentId: z.string().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

export const taskUpdatePatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  notes: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  issueType: issueTypeSchema.optional(),
  aiReviewEnabled: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  parentId: z.string().optional(),
});
export type TaskUpdatePatch = z.infer<typeof taskUpdatePatchSchema>;

export const softGuardrailsSchema = z.object({
  cpuHighWatermarkPercent: z.number().int().min(1).max(100).default(85),
  minFreeMemoryMb: z.number().int().min(128).default(2048),
  backoffSeconds: z.number().int().min(1).default(30),
});
export type SoftGuardrails = z.infer<typeof softGuardrailsSchema>;

export const repoHooksSchema = z.object({
  preStart: z.array(z.string()).default([]),
  postComplete: z.array(z.string()).default([]),
});
export type RepoHooks = z.infer<typeof repoHooksSchema>;

export const agentModelDefaultSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  variant: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  opencodeAgent: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
});
export type AgentModelDefault = z.infer<typeof agentModelDefaultSchema>;

export const repoAgentDefaultsSchema = z.object({
  spec: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  planner: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  build: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  qa: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
});
export type RepoAgentDefaults = z.infer<typeof repoAgentDefaultsSchema>;

export const repoConfigSchema = z.object({
  worktreeBasePath: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  branchPrefix: z.string().min(1).default("obp"),
  trustedHooks: z.boolean().default(false),
  hooks: repoHooksSchema.default({ preStart: [], postComplete: [] }),
  agentDefaults: repoAgentDefaultsSchema.default({
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  }),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const globalConfigSchema = z.object({
  version: z.literal(1),
  activeRepo: z.string().optional(),
  taskMetadataNamespace: z.string().min(1).default("openducktor"),
  repos: z.record(repoConfigSchema).default({}),
  recentRepos: z.array(z.string()).default([]),
  scheduler: z
    .object({
      softGuardrails: softGuardrailsSchema.default({
        cpuHighWatermarkPercent: 85,
        minFreeMemoryMb: 2048,
        backoffSeconds: 30,
      }),
    })
    .default({
      softGuardrails: {
        cpuHighWatermarkPercent: 85,
        minFreeMemoryMb: 2048,
        backoffSeconds: 30,
      },
    }),
});
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const specTemplateSections = [
  {
    heading: "Purpose",
    purpose: "Why this feature exists and the expected user/developer outcome.",
  },
  {
    heading: "Problem",
    purpose: "The current pain, risk, or failure that the feature resolves.",
  },
  {
    heading: "Goals",
    purpose: "The measurable outcomes the feature must achieve.",
  },
  {
    heading: "Non-goals",
    purpose: "What is intentionally out of scope for this iteration.",
  },
  {
    heading: "Scope",
    purpose: "The functional boundaries and affected systems/components.",
  },
  {
    heading: "API / Interfaces",
    purpose: "Contracts, data shapes, and integration boundaries.",
  },
  {
    heading: "Risks",
    purpose: "Technical/product risks plus mitigation strategy.",
  },
  {
    heading: "Test Plan",
    purpose: "Verification scenarios, checks, and pass criteria.",
  },
] as const;

export const defaultSpecTemplateMarkdown = specTemplateSections
  .map((section) => `# ${section.heading}\n\n> Purpose: ${section.purpose}\n\n`)
  .join("\n");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

export const missingSpecSections = (markdown: string): string[] => {
  return specTemplateSections
    .map((section) => section.heading)
    .filter((heading) => {
      const pattern = new RegExp(`(^|\\n)#{1,6}\\s+${escapeRegExp(heading)}\\s*(\\n|$)`, "i");
      return !pattern.test(markdown);
    });
};

export const validateSpecMarkdown = (markdown: string): { valid: boolean; missing: string[] } => {
  const missing = missingSpecSections(markdown);
  return { valid: missing.length === 0, missing };
};

export const workspaceRecordSchema = z.object({
  path: z.string(),
  isActive: z.boolean(),
  hasConfig: z.boolean(),
  configuredWorktreeBasePath: z.string().nullable(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export const systemCheckSchema = z.object({
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  opencodeOk: z.boolean(),
  opencodeVersion: z.string().nullable(),
  beadsOk: z.boolean(),
  beadsPath: z.string().nullable(),
  beadsError: z.string().nullable(),
  errors: z.array(z.string()),
});
export type SystemCheck = z.infer<typeof systemCheckSchema>;

export const runtimeCheckSchema = z.object({
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  opencodeOk: z.boolean(),
  opencodeVersion: z.string().nullable(),
  errors: z.array(z.string()),
});
export type RuntimeCheck = z.infer<typeof runtimeCheckSchema>;

export const beadsCheckSchema = z.object({
  beadsOk: z.boolean(),
  beadsPath: z.string().nullable(),
  beadsError: z.string().nullable(),
});
export type BeadsCheck = z.infer<typeof beadsCheckSchema>;

export const runStateSchema = z.enum([
  "starting",
  "running",
  "blocked",
  "awaiting_done_confirmation",
  "completed",
  "failed",
  "stopped",
]);
export type RunState = z.infer<typeof runStateSchema>;

export const runSummarySchema = z.object({
  runId: z.string(),
  repoPath: z.string(),
  taskId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  port: z.number().int().positive(),
  state: runStateSchema,
  lastMessage: z.string().nullable(),
  startedAt: z.string(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const agentRuntimeSummarySchema = z.object({
  runtimeId: z.string(),
  repoPath: z.string(),
  taskId: z.string(),
  role: z.string(),
  workingDirectory: z.string(),
  port: z.number().int().positive(),
  startedAt: z.string(),
});
export type AgentRuntimeSummary = z.infer<typeof agentRuntimeSummarySchema>;

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = z.enum(["spec", "planner", "build", "qa"]);
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

export const agentSessionScenarioSchema = z.enum([
  "spec_initial",
  "spec_revision",
  "planner_initial",
  "planner_revision",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "qa_review",
]);
export type AgentSessionScenario = z.infer<typeof agentSessionScenarioSchema>;

export const agentSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "thinking", "tool"]),
  content: z.string(),
  timestamp: z.string(),
});
export type AgentSessionMessage = z.infer<typeof agentSessionMessageSchema>;

export const agentSessionModelSelectionSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  variant: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  opencodeAgent: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
});
export type AgentSessionModelSelection = z.infer<typeof agentSessionModelSelectionSchema>;

export const agentSessionRecordSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  role: agentSessionRoleSchema,
  scenario: agentSessionScenarioSchema,
  status: agentSessionStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  runtimeId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  runId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  baseUrl: z.string(),
  workingDirectory: z.string(),
  selectedModel: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentSessionModelSelectionSchema.optional(),
  ),
  messages: z.array(agentSessionMessageSchema).default([]),
});
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;

export const runEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("agent_thought"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool_execution"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("permission_required"),
    runId: z.string(),
    message: z.string(),
    command: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("post_hook_started"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("post_hook_failed"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("ready_for_manual_done_confirmation"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("run_finished"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
    success: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    runId: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;
