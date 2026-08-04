import { z } from "zod";
import {
  runtimeDescriptorSchema,
  runtimeKindSchema,
  stdioRuntimeIdentitySchema,
} from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { failureKindSchema } from "./failure-schemas";

export const runtimeHealthSchema = z.object({
  kind: runtimeKindSchema,
  enabled: z.boolean().default(true).optional(),
  ok: z.boolean(),
  version: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;

export const repoStoreHealthCategorySchema = z.enum([
  "healthy",
  "check_call_failed",
  "database_unavailable",
]);
export type RepoStoreHealthCategory = z.infer<typeof repoStoreHealthCategorySchema>;

export const repoStoreHealthStatusSchema = z.enum(["ready", "degraded", "blocking"]);
export type RepoStoreHealthStatus = z.infer<typeof repoStoreHealthStatusSchema>;

export const repoStoreHealthSchema = z.object({
  category: repoStoreHealthCategorySchema,
  status: repoStoreHealthStatusSchema,
  isReady: z.boolean(),
  detail: z.string().nullable(),
  databasePath: z.string().nullable(),
});
export type RepoStoreHealth = z.infer<typeof repoStoreHealthSchema>;

export const toolExecutableSourceCategorySchema = z.enum([
  "bundled_electron_resource",
  "environment_override",
  "provided_path",
  "system_path",
  "unavailable",
]);
export type ToolExecutableSourceCategory = z.infer<typeof toolExecutableSourceCategorySchema>;

export const toolExecutableProvenanceSchema = z.object({
  path: z.string().nullable(),
  sourceCategory: toolExecutableSourceCategorySchema,
  displayLabel: z.string(),
  error: z.string().nullable(),
});
export type ToolExecutableProvenance = z.infer<typeof toolExecutableProvenanceSchema>;

export const systemCheckSchema = z.object({
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  ghOk: z.boolean().default(false),
  ghVersion: z.string().nullable().default(null),
  ghAuthOk: z.boolean().default(false),
  ghAuthLogin: z.string().nullable().default(null),
  ghAuthError: z.string().nullable().default(null),
  runtimes: z.array(runtimeHealthSchema).default([]),
  repoStoreHealth: repoStoreHealthSchema,
  taskStoreOk: z.boolean(),
  taskStorePath: z.string().nullable(),
  taskStoreError: z.string().nullable(),
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

export const taskStoreCheckSchema = z.object({
  repoStoreHealth: repoStoreHealthSchema,
  taskStoreOk: z.boolean(),
  taskStorePath: z.string().nullable(),
  taskStoreError: z.string().nullable(),
});
export type TaskStoreCheck = z.infer<typeof taskStoreCheckSchema>;

export const runtimeRouteSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local_http"),
      endpoint: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("stdio"),
      identity: stdioRuntimeIdentitySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("host_service"),
      identity: stdioRuntimeIdentitySchema,
    })
    .strict(),
]);
export type RuntimeRoute = z.infer<typeof runtimeRouteSchema>;

export const buildSessionBootstrapSchema = z.object({
  runtimeKind: runtimeKindSchema,
  workingDirectory: z.string().trim().min(1),
});
export type BuildSessionBootstrap = z.infer<typeof buildSessionBootstrapSchema>;

export const taskSessionBootstrapSchema = z
  .object({
    bootstrapId: z.string().trim().min(1),
    role: agentRoleSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: z.string().trim().min(1),
  })
  .strict();
export type TaskSessionBootstrap = z.infer<typeof taskSessionBootstrapSchema>;

export const runtimeInstanceSummaryRoleSchema = z.literal("workspace");
export type RuntimeInstanceSummaryRole = z.infer<typeof runtimeInstanceSummaryRoleSchema>;

export const taskWorktreeSummarySchema = z.object({
  workingDirectory: z.string().trim().min(1),
});
export type TaskWorktreeSummary = z.infer<typeof taskWorktreeSummarySchema>;

export const runtimeInstanceSummarySchema = z
  .object({
    kind: runtimeKindSchema,
    runtimeId: z.string(),
    repoPath: z.string(),
    taskId: z.string().nullable(),
    role: runtimeInstanceSummaryRoleSchema,
    workingDirectory: z.string(),
    runtimeRoute: runtimeRouteSchema,
    startedAt: z.string(),
    descriptor: runtimeDescriptorSchema,
  })
  .strict();
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

export const repoRuntimeHealthStateSchema = z.enum([
  "disabled",
  "not_started",
  "checking",
  "ready",
  "error",
]);
export type RepoRuntimeHealthState = z.infer<typeof repoRuntimeHealthStateSchema>;

export const repoRuntimeHealthObservationSchema = z.enum([
  "observed_existing_runtime",
  "observing_existing_startup",
  "started_by_diagnostics",
  "restarted_for_mcp",
  "restart_skipped_active_session",
]);
export type RepoRuntimeHealthObservation = z.infer<typeof repoRuntimeHealthObservationSchema>;

export const repoRuntimeMcpStatusSchema = z.enum([
  "waiting_for_runtime",
  "checking",
  "reconnecting",
  "connected",
  "error",
  "unsupported",
]);
export type RepoRuntimeMcpStatus = z.infer<typeof repoRuntimeMcpStatusSchema>;

export const repoRuntimeHealthRuntimeSchema = z.object({
  status: repoRuntimeHealthStateSchema,
  stage: repoRuntimeStartupStageSchema,
  observation: repoRuntimeHealthObservationSchema.nullable(),
  instance: runtimeInstanceSummarySchema.nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative().nullable(),
  detail: z.string().nullable(),
  failureKind: failureKindSchema.nullable(),
  failureReason: z.string().nullable(),
});
export type RepoRuntimeHealthRuntime = z.infer<typeof repoRuntimeHealthRuntimeSchema>;

export const repoRuntimeHealthMcpSchema = z.object({
  supported: z.boolean(),
  status: repoRuntimeMcpStatusSchema,
  serverName: z.string(),
  serverStatus: z.string().nullable(),
  toolIds: z.array(z.string()),
  detail: z.string().nullable(),
  failureKind: failureKindSchema.nullable(),
});
export type RepoRuntimeHealthMcp = z.infer<typeof repoRuntimeHealthMcpSchema>;

export const repoRuntimeHealthCheckSchema = z.object({
  status: repoRuntimeHealthStateSchema,
  checkedAt: z.string(),
  runtime: repoRuntimeHealthRuntimeSchema,
  mcp: repoRuntimeHealthMcpSchema.nullable(),
});
export type RepoRuntimeHealthCheck = z.infer<typeof repoRuntimeHealthCheckSchema>;
