import { z } from "zod";
import { terminalIdSchema } from "./terminal-schemas";

export const devServerScriptStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
]);
export type DevServerScriptStatus = z.infer<typeof devServerScriptStatusSchema>;

export const devServerScriptStateSchema = z
  .object({
    scriptId: z.string().min(1),
    name: z.string().min(1),
    command: z.string().min(1),
    startedCommand: z.string().min(1).nullable(),
    status: devServerScriptStatusSchema,
    pid: z.number().int().positive().nullable(),
    startedAt: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    lastError: z.string().nullable(),
    terminalId: terminalIdSchema.nullable(),
  })
  .strict()
  .superRefine((script, context) => {
    const isActive =
      script.status === "starting" || script.status === "running" || script.status === "stopping";
    if (isActive && script.terminalId === null) {
      context.addIssue({
        code: "custom",
        message: `Dev server script status ${script.status} requires a terminal ID.`,
        path: ["terminalId"],
      });
      return;
    }

    if ((isActive || script.terminalId !== null) && script.startedCommand === null) {
      context.addIssue({
        code: "custom",
        message: "Dev server scripts with a run must state the started command.",
        path: ["startedCommand"],
      });
    }
  });
export type DevServerScriptState = z.infer<typeof devServerScriptStateSchema>;

export const devServerOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: z.string().min(1) }),
  z.object({
    kind: z.literal("workspace_session"),
    workspaceId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
]);
export type DevServerOwner = z.infer<typeof devServerOwnerSchema>;

export const formatDevServerOwnerKey = (owner: DevServerOwner): string =>
  owner.kind === "task"
    ? JSON.stringify(["task", owner.taskId])
    : JSON.stringify(["workspace_session", owner.workspaceId, owner.sessionId]);

export const devServerCommandInputSchema = z.object({
  repoPath: z.string().min(1),
  owner: devServerOwnerSchema,
});
export type DevServerCommandInput = z.infer<typeof devServerCommandInputSchema>;

export const devServerGroupStateSchema = z.object({
  repoPath: z.string().min(1),
  owner: devServerOwnerSchema,
  workingDirectory: z.string().nullable(),
  scripts: z.array(devServerScriptStateSchema).default([]),
  revision: z.number().int().nonnegative(),
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
    owner: devServerOwnerSchema,
    script: devServerScriptStateSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
  }),
]);
export type DevServerEvent = z.infer<typeof devServerEventSchema>;
