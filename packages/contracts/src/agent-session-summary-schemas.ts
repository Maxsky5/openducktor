import { z } from "zod";
import { isoTimestampSchema } from "./string-schemas";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentModelSelectionSchema } from "./agent-session-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export const agentSessionControlSummarySchema = z
  .object({
    externalSessionId: nonEmptyStringSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: nonEmptyStringSchema,
    title: z.string().optional(),
    startedAt: isoTimestampSchema,
    status: z.enum(["starting", "running", "idle", "error", "stopped"]),
    firstTurnCompleted: z.boolean().optional(),
    // Native settings after the operation, when the runtime reports them.
    model: agentModelSelectionSchema.optional(),
  })
  .strict();
export type AgentSessionControlSummary = z.infer<typeof agentSessionControlSummarySchema>;
