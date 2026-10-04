import { z } from "zod";
import {
  runtimeDescriptorSchema,
  runtimeKindSchema,
  stdioRuntimeIdentitySchema,
} from "./agent-runtime-schemas";

export const runtimeHealthSchema = z.object({
  kind: runtimeKindSchema,
  enabled: z.boolean().default(true).optional(),
  ok: z.boolean(),
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;

export const runtimeExecutableCheckInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("discover") }).strict(),
  z
    .object({
      mode: z.literal("validate"),
      paths: z
        .partialRecord(runtimeKindSchema, z.string())
        .refine((paths) => Object.keys(paths).length > 0, "Provide at least one runtime path."),
    })
    .strict(),
]);
export type RuntimeExecutableCheckInput = z.infer<typeof runtimeExecutableCheckInputSchema>;

export const runtimeExecutableCheckResultSchema = z
  .object({
    kind: runtimeKindSchema,
    path: z.string(),
    ok: z.boolean(),
    version: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type RuntimeExecutableCheckResult = z.infer<typeof runtimeExecutableCheckResultSchema>;

export const runtimeExecutableCheckSchema = z
  .object({
    runtimes: z.array(runtimeExecutableCheckResultSchema),
  })
  .strict();
export type RuntimeExecutableCheck = z.infer<typeof runtimeExecutableCheckSchema>;

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
  pathOk: z.boolean(),
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
  runtimes: z.array(runtimeHealthSchema).default([]),
  repoStoreHealth: repoStoreHealthSchema,
  taskStoreOk: z.boolean(),
  taskStorePath: z.string().nullable(),
  taskStoreError: z.string().nullable(),
  errors: z.array(z.string()),
});
export type SystemCheck = z.infer<typeof systemCheckSchema>;

export const runtimeCheckSchema = z.object({
  pathOk: z.boolean(),
  gitOk: z.boolean(),
  gitVersion: z.string().nullable(),
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

export const taskWorktreeSummarySchema = z.object({
  workingDirectory: z.string().trim().min(1),
});
export type TaskWorktreeSummary = z.infer<typeof taskWorktreeSummarySchema>;

/** One running shared runtime instance. A replacement receives a new runtime ID. */
export const runtimeInstanceSummarySchema = z
  .object({
    kind: runtimeKindSchema,
    runtimeId: z.string(),
    runtimeRoute: runtimeRouteSchema,
    startedAt: z.string(),
    descriptor: runtimeDescriptorSchema,
  })
  .strict();
export type RuntimeInstanceSummary = z.infer<typeof runtimeInstanceSummarySchema>;
