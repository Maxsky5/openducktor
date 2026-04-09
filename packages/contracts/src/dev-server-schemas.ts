import { z } from "zod";

export const devServerScriptStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
]);
export type DevServerScriptStatus = z.infer<typeof devServerScriptStatusSchema>;

export const devServerTerminalChunkSchema = z.object({
  scriptId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  data: z.string(),
  timestamp: z.string(),
});
export type DevServerTerminalChunk = z.infer<typeof devServerTerminalChunkSchema>;

export const devServerScriptStateSchema = z.object({
  scriptId: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  status: devServerScriptStatusSchema,
  pid: z.number().int().positive().nullable(),
  startedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  bufferedTerminalChunks: z.array(devServerTerminalChunkSchema).default([]),
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
