import { z } from "zod";

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
