import { z } from "zod";

export const devServerScriptStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
]);
export type DevServerScriptStatus = z.infer<typeof devServerScriptStatusSchema>;

export const devServerRunOrderSchema = z.object({
  hostInstanceId: z.string().min(1),
  generation: z.number().int().positive(),
});
export type DevServerRunOrder = z.infer<typeof devServerRunOrderSchema>;

export const devServerTerminalChunkSchema = z.object({
  scriptId: z.string().min(1),
  runId: z.string().min(1),
  runOrder: devServerRunOrderSchema,
  sequence: z.number().int().nonnegative(),
  data: z.string(),
  timestamp: z.string(),
});
export type DevServerTerminalChunk = z.infer<typeof devServerTerminalChunkSchema>;

export const devServerScriptStateSchema = z
  .object({
    scriptId: z.string().min(1),
    name: z.string().min(1),
    command: z.string().min(1),
    status: devServerScriptStatusSchema,
    runId: z.string().min(1).nullable(),
    runOrder: devServerRunOrderSchema.nullable(),
    pid: z.number().int().positive().nullable(),
    startedAt: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    lastError: z.string().nullable(),
    bufferedTerminalChunks: z.array(devServerTerminalChunkSchema).default([]),
  })
  .superRefine((script, context) => {
    const hasRunId = script.runId !== null;
    const hasRunOrder = script.runOrder !== null;
    if (hasRunId !== hasRunOrder) {
      context.addIssue({
        code: "custom",
        message: "Dev server run id and run order must either both be present or both be null.",
        path: hasRunId ? ["runOrder"] : ["runId"],
      });
    }

    const requiresRunOwnership =
      script.status === "starting" ||
      script.status === "running" ||
      script.status === "stopping" ||
      script.bufferedTerminalChunks.length > 0;
    if (requiresRunOwnership && (!hasRunId || !hasRunOrder)) {
      context.addIssue({
        code: "custom",
        message: `Dev server script status ${script.status} requires explicit run ownership.`,
        path: ["runId"],
      });
    }

    for (const [index, chunk] of script.bufferedTerminalChunks.entries()) {
      if (
        chunk.scriptId !== script.scriptId ||
        chunk.runId !== script.runId ||
        chunk.runOrder.hostInstanceId !== script.runOrder?.hostInstanceId ||
        chunk.runOrder.generation !== script.runOrder?.generation
      ) {
        context.addIssue({
          code: "custom",
          message: "Buffered terminal chunks must belong to the script's current run.",
          path: ["bufferedTerminalChunks", index],
        });
      }
    }
  });
export type DevServerScriptState = z.infer<typeof devServerScriptStateSchema>;

export const devServerGroupStateSchema = z.object({
  repoPath: z.string().min(1),
  taskId: z.string().min(1),
  worktreePath: z.string().nullable(),
  scripts: z.array(devServerScriptStateSchema).default([]),
  updatedAt: z.string(),
});
export type DevServerGroupState = z.infer<typeof devServerGroupStateSchema>;

export const devServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    state: devServerGroupStateSchema,
  }),
  z.object({
    type: z.literal("script_status_changed"),
    repoPath: z.string().min(1),
    taskId: z.string().min(1),
    script: devServerScriptStateSchema,
    updatedAt: z.string(),
  }),
  z.object({
    type: z.literal("terminal_chunk"),
    repoPath: z.string().min(1),
    taskId: z.string().min(1),
    terminalChunk: devServerTerminalChunkSchema,
  }),
]);
export type DevServerEvent = z.infer<typeof devServerEventSchema>;
