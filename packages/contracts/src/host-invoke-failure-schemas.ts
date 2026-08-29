import { z } from "zod";
import { workspaceTextFileWriteFailureSchema } from "./filesystem-schemas";
import { jsonValueSchema } from "./json-types";
import { sessionHistoryFailureSchema } from "./session-history-failure-schemas";
import { taskAssetFailureSchema } from "./task-asset-schemas";
import { terminalFailureSchema } from "./terminal-schemas";

export const hostInvokeFailureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("terminal"),
      terminalFailure: terminalFailureSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task_asset"),
      taskAssetFailure: taskAssetFailureSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("session_history"),
      sessionHistoryFailure: sessionHistoryFailureSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("workspace_text_file_write"),
      workspaceTextFileWriteFailure: workspaceTextFileWriteFailureSchema,
    })
    .strict(),
]);
export type HostInvokeFailure = z.infer<typeof hostInvokeFailureSchema>;

export const hostErrorResponseSchema = z
  .object({
    error: z.string().trim().min(1).optional(),
    failure: hostInvokeFailureSchema.optional(),
    failureKind: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).optional(),
  })
  .catchall(jsonValueSchema);
export type HostErrorResponse = z.infer<typeof hostErrorResponseSchema>;
