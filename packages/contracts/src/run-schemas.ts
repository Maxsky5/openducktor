import { z } from "zod";
import { runtimeDescriptorSchema, runtimeKindSchema } from "./agent-runtime-schemas";

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

export const qaReviewTargetSourceSchema = z.enum(["active_build_run", "builder_session"]);
export type QaReviewTargetSource = z.infer<typeof qaReviewTargetSourceSchema>;

export const qaReviewTargetSchema = z.object({
  workingDirectory: z.string().trim().min(1),
  source: qaReviewTargetSourceSchema,
});
export type QaReviewTarget = z.infer<typeof qaReviewTargetSchema>;

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
