import { z } from "zod";
import { runtimeDescriptorSchema, runtimeKindSchema } from "./agent-runtime-schemas";
import { failureKindSchema } from "./failure-schemas";

export const runtimeHealthSchema = z.object({
  kind: runtimeKindSchema,
  ok: z.boolean(),
  version: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;

export const systemCheckSchema = z.object({
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  ghOk: z.boolean().default(false),
  ghVersion: z.string().nullable().default(null),
  ghAuthOk: z.boolean().default(false),
  ghAuthLogin: z.string().nullable().default(null),
  ghAuthError: z.string().nullable().default(null),
  runtimes: z.array(runtimeHealthSchema).default([]),
  beadsOk: z.boolean(),
  beadsPath: z.string().nullable(),
  beadsError: z.string().nullable(),
  errors: z.array(z.string()),
});
export type SystemCheck = z.infer<typeof systemCheckSchema>;

export const runtimeCheckSchema = z.object({
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  ghOk: z.boolean().default(false),
  ghVersion: z.string().nullable().default(null),
  ghAuthOk: z.boolean().default(false),
  ghAuthLogin: z.string().nullable().default(null),
  ghAuthError: z.string().nullable().default(null),
  runtimes: z.array(runtimeHealthSchema).default([]),
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

export const runtimeRouteSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local_http"),
    endpoint: z.string().trim().min(1),
  }),
]);
export type RuntimeRoute = z.infer<typeof runtimeRouteSchema>;

export const runSummarySchema = z.object({
  runId: z.string(),
  runtimeKind: runtimeKindSchema,
  runtimeRoute: runtimeRouteSchema,
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

export const runtimeInstanceSummaryRoleSchema = z.literal("workspace");
export type RuntimeInstanceSummaryRole = z.infer<typeof runtimeInstanceSummaryRoleSchema>;

export const buildContinuationTargetSourceSchema = z.enum(["active_build_run", "builder_session"]);
export type BuildContinuationTargetSource = z.infer<typeof buildContinuationTargetSourceSchema>;

export const buildContinuationTargetSchema = z.object({
  workingDirectory: z.string().trim().min(1),
  source: buildContinuationTargetSourceSchema,
});
export type BuildContinuationTarget = z.infer<typeof buildContinuationTargetSchema>;

export const runtimeInstanceSummarySchema = z.object({
  kind: runtimeKindSchema,
  runtimeId: z.string(),
  repoPath: z.string(),
  taskId: z.string().nullable(),
  role: runtimeInstanceSummaryRoleSchema,
  workingDirectory: z.string(),
  runtimeRoute: runtimeRouteSchema,
  startedAt: z.string(),
  descriptor: runtimeDescriptorSchema,
});
export type RuntimeInstanceSummary = z.infer<typeof runtimeInstanceSummarySchema>;

export const repoRuntimeStartupStageSchema = z.enum([
  "idle",
  "startup_requested",
  "waiting_for_runtime",
  "runtime_ready",
  "startup_failed",
]);
export type RepoRuntimeStartupStage = z.infer<typeof repoRuntimeStartupStageSchema>;

export const repoRuntimeStartupStatusSchema = z.object({
  runtimeKind: runtimeKindSchema,
  repoPath: z.string(),
  stage: repoRuntimeStartupStageSchema,
  runtime: runtimeInstanceSummarySchema.nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative().nullable(),
  failureKind: failureKindSchema.nullable(),
  failureReason: z.string().nullable(),
  detail: z.string().nullable(),
});
export type RepoRuntimeStartupStatus = z.infer<typeof repoRuntimeStartupStatusSchema>;

export const repoRuntimeHealthStageSchema = z.enum([
  "idle",
  "startup_requested",
  "waiting_for_runtime",
  "runtime_ready",
  "checking_mcp_status",
  "reconnecting_mcp",
  "restarting_runtime",
  "restart_skipped_active_run",
  "ready",
  "startup_failed",
  "frontend_observation_timeout",
]);
export type RepoRuntimeHealthStage = z.infer<typeof repoRuntimeHealthStageSchema>;

export const repoRuntimeHealthObservationSchema = z.enum([
  "observed_existing_runtime",
  "observing_existing_startup",
  "started_by_diagnostics",
  "restarted_for_mcp",
  "restart_skipped_active_run",
]);
export type RepoRuntimeHealthObservation = z.infer<typeof repoRuntimeHealthObservationSchema>;

export const repoRuntimeHealthFailureOriginSchema = z.enum([
  "runtime_startup",
  "mcp_status",
  "mcp_connect",
  "runtime_stop",
  "runtime_restart",
  "frontend_observation",
  "startup_status",
  "health_status",
]);
export type RepoRuntimeHealthFailureOrigin = z.infer<typeof repoRuntimeHealthFailureOriginSchema>;

export const repoRuntimeHealthProgressSchema = z.object({
  stage: repoRuntimeHealthStageSchema,
  observation: repoRuntimeHealthObservationSchema.nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative().nullable(),
  detail: z.string().nullable(),
  failureKind: failureKindSchema.nullable(),
  failureReason: z.string().nullable(),
  failureOrigin: repoRuntimeHealthFailureOriginSchema.nullable(),
  host: repoRuntimeStartupStatusSchema.nullable(),
});
export type RepoRuntimeHealthProgress = z.infer<typeof repoRuntimeHealthProgressSchema>;

export const repoRuntimeHealthCheckSchema = z.object({
  runtimeOk: z.boolean(),
  runtimeError: z.string().nullable(),
  runtimeFailureKind: failureKindSchema.nullable(),
  runtime: runtimeInstanceSummarySchema.nullable(),
  mcpOk: z.boolean(),
  mcpError: z.string().nullable(),
  mcpFailureKind: failureKindSchema.nullable(),
  mcpServerName: z.string(),
  mcpServerStatus: z.string().nullable(),
  mcpServerError: z.string().nullable(),
  availableToolIds: z.array(z.string()),
  checkedAt: z.string(),
  errors: z.array(z.string()),
  progress: repoRuntimeHealthProgressSchema.nullable().optional(),
});
export type RepoRuntimeHealthCheck = z.infer<typeof repoRuntimeHealthCheckSchema>;

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
