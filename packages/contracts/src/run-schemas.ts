import { z } from "zod";
import {
  runtimeDescriptorSchema,
  runtimeKindSchema,
  stdioRuntimeIdentitySchema,
} from "./agent-runtime-schemas";
import { failureKindSchema } from "./failure-schemas";

export const runtimeHealthSchema = z.object({
  kind: runtimeKindSchema,
  ok: z.boolean(),
  version: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;

export const repoStoreHealthCategorySchema = z.enum([
  "initializing",
  "healthy",
  "check_call_failed",
  "missing_attachment",
  "missing_shared_database",
  "attachment_contract_invalid",
  "attachment_verification_failed",
  "shared_server_unavailable",
]);
export type RepoStoreHealthCategory = z.infer<typeof repoStoreHealthCategorySchema>;

export const repoStoreHealthStatusSchema = z.enum([
  "initializing",
  "ready",
  "degraded",
  "blocking",
  "restore_needed",
]);
export type RepoStoreHealthStatus = z.infer<typeof repoStoreHealthStatusSchema>;

export const repoStoreSharedServerOwnershipStateSchema = z.enum([
  "owned_by_current_process",
  "reused_existing_server",
  "adopted_orphaned_server",
  "unavailable",
]);
export type RepoStoreSharedServerOwnershipState = z.infer<
  typeof repoStoreSharedServerOwnershipStateSchema
>;

export const repoStoreAttachmentHealthSchema = z.object({
  path: z.string().nullable(),
  databaseName: z.string().nullable(),
});
export type RepoStoreAttachmentHealth = z.infer<typeof repoStoreAttachmentHealthSchema>;

export const repoStoreSharedServerHealthSchema = z.object({
  host: z.string().nullable(),
  port: z.number().int().positive().nullable(),
  ownershipState: repoStoreSharedServerOwnershipStateSchema,
});
export type RepoStoreSharedServerHealth = z.infer<typeof repoStoreSharedServerHealthSchema>;

export const repoStoreHealthSchema = z.object({
  category: repoStoreHealthCategorySchema,
  status: repoStoreHealthStatusSchema,
  isReady: z.boolean(),
  detail: z.string().nullable(),
  attachment: repoStoreAttachmentHealthSchema,
  sharedServer: repoStoreSharedServerHealthSchema,
});
export type RepoStoreHealth = z.infer<typeof repoStoreHealthSchema>;

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
  repoStoreHealth: repoStoreHealthSchema,
  beadsOk: z.boolean(),
  beadsPath: z.string().nullable(),
  beadsError: z.string().nullable(),
});
export type BeadsCheck = z.infer<typeof beadsCheckSchema>;

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
]);
export type RuntimeRoute = z.infer<typeof runtimeRouteSchema>;

export const buildSessionBootstrapSchema = z.object({
  runtimeKind: runtimeKindSchema,
  runtimeRoute: runtimeRouteSchema,
  workingDirectory: z.string().trim().min(1),
});
export type BuildSessionBootstrap = z.infer<typeof buildSessionBootstrapSchema>;

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

export const repoRuntimeHealthStateSchema = z.enum(["idle", "checking", "ready", "error"]);
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
