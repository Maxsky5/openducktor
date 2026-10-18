import { z } from "zod";
import {
  acceptedAgentInputSchema,
  agentSessionMessageContentFields,
  refineAgentSessionUserMessageParts,
} from "./agent-session-control-schemas";
import { agentSessionLiveRefSchema, agentSessionScopeSchema } from "./agent-session-schemas";
import { isoTimestampSchema } from "./string-schemas";
import { submissionAcknowledgementSchema } from "./workflow-operation-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

/** The exact session that owns a message queue. */
export const agentMessageTargetSchema = agentSessionLiveRefSchema
  .extend({ sessionScope: agentSessionScopeSchema })
  .strict();
export type AgentMessageTarget = z.infer<typeof agentMessageTargetSchema>;

/**
 * `default` starts a turn when the session is idle and has no queue. Otherwise it adds the
 * message to the end of the queue. `steer` sends the message to the running work at once.
 */
export const agentMessageSubmitModeSchema = z.enum(["default", "steer"]);
export type AgentMessageSubmitMode = z.infer<typeof agentMessageSubmitModeSchema>;

export const agentMessageSubmitInputSchema = agentMessageTargetSchema
  .extend({
    submissionId: nonEmptyStringSchema,
    mode: agentMessageSubmitModeSchema,
    parts: agentSessionMessageContentFields.parts,
  })
  .strict()
  .superRefine(refineAgentSessionUserMessageParts);
export type AgentMessageSubmitInput = z.infer<typeof agentMessageSubmitInputSchema>;

/**
 * `editing` keeps the message out of automatic delivery. `sending` and `steering` mean that
 * native delivery started, so the message cannot change. `acceptance_unknown` means that the
 * runtime gave no conclusive answer, so the message cannot be sent again.
 */
export const agentQueuedMessageStateSchema = z.enum([
  "queued",
  "editing",
  "sending",
  "steering",
  "acceptance_unknown",
]);
export type AgentQueuedMessageState = z.infer<typeof agentQueuedMessageStateSchema>;

const agentQueuedMessageFields = {
  submissionId: nonEmptyStringSchema,
  parts: agentSessionMessageContentFields.parts,
  queuedAt: isoTimestampSchema,
  /** The last delivery failure of this message. */
  error: nonEmptyStringSchema.optional(),
};

export const agentQueuedMessageSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...agentQueuedMessageFields,
      state: z.literal("editing"),
      /** Identifies the current edit. Only Save or Cancel with this ID can end it. */
      editId: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      ...agentQueuedMessageFields,
      state: agentQueuedMessageStateSchema.exclude(["editing"]),
    })
    .strict(),
]);
export type AgentQueuedMessage = z.infer<typeof agentQueuedMessageSchema>;

/** Automatic delivery waits until the user resumes the queue. */
export const agentMessageQueuePauseSchema = z
  .object({
    message: nonEmptyStringSchema,
  })
  .strict();
export type AgentMessageQueuePause = z.infer<typeof agentMessageQueuePauseSchema>;

export const agentMessageQueueSnapshotSchema = z
  .object({
    target: agentMessageTargetSchema,
    /** Increases with each change, so a reader can ignore an older snapshot. */
    revision: z.number().int().nonnegative(),
    entries: z.array(agentQueuedMessageSchema),
    pause: agentMessageQueuePauseSchema.nullable(),
  })
  .strict();
export type AgentMessageQueueSnapshot = z.infer<typeof agentMessageQueueSnapshotSchema>;

export const agentMessageSubmitResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("acknowledged"),
    submissionId: nonEmptyStringSchema,
    outcome: z.enum(["accepted", "queued", "uncertain"]),
    acknowledgement: submissionAcknowledgementSchema.optional(),
  }),
  z
    .object({
      kind: z.literal("queued"),
      queue: agentMessageQueueSnapshotSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("accepted"),
      acceptedMessage: acceptedAgentInputSchema,
    })
    .strict(),
]);
export type AgentMessageSubmitResult = z.infer<typeof agentMessageSubmitResultSchema>;

export const agentMessageQueueActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("begin_edit"), submissionId: nonEmptyStringSchema }).strict(),
  z
    .object({
      kind: z.literal("save_edit"),
      submissionId: nonEmptyStringSchema,
      editId: nonEmptyStringSchema,
      parts: agentSessionMessageContentFields.parts,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cancel_edit"),
      submissionId: nonEmptyStringSchema,
      editId: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove"),
      submissionId: nonEmptyStringSchema,
      editId: nonEmptyStringSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("steer"), submissionId: nonEmptyStringSchema }).strict(),
  z.object({ kind: z.literal("resume") }).strict(),
]);
export type AgentMessageQueueAction = z.infer<typeof agentMessageQueueActionSchema>;

export const agentMessageQueueManageInputSchema = agentMessageTargetSchema
  .extend({ action: agentMessageQueueActionSchema })
  .strict()
  .superRefine(({ action }, ctx) => {
    if (action.kind === "save_edit") refineAgentSessionUserMessageParts(action, ctx);
  });
export type AgentMessageQueueManageInput = z.infer<typeof agentMessageQueueManageInputSchema>;

export const agentMessageQueueManageResultSchema = z
  .object({
    queue: agentMessageQueueSnapshotSchema,
    /** Present when the action delivered a message to the runtime. */
    acceptedMessage: acceptedAgentInputSchema.optional(),
  })
  .strict();
export type AgentMessageQueueManageResult = z.infer<typeof agentMessageQueueManageResultSchema>;
