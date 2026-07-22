import { z } from "zod";
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
]);
export type HostInvokeFailure = z.infer<typeof hostInvokeFailureSchema>;
