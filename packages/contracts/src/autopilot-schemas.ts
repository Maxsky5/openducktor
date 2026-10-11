import { z } from "zod";
import { autopilotActionIdSchema, autopilotEventIdSchema } from "./config-schemas";
import { workflowLaunchResultSchema } from "./workflow-launch-schemas";

const autopilotOutcomeFieldsSchema = z.strictObject({
  /** Identifies one automatic attempt. A client shows each outcome once. */
  outcomeId: z.string().min(1),
  workspaceId: z.string().min(1),
  repoPath: z.string().min(1),
  task: z.strictObject({ id: z.string().min(1), title: z.string() }),
  eventId: autopilotEventIdSchema,
  actionId: autopilotActionIdSchema,
  occurredAt: z.string().min(1),
});

/** The result of one automatic attempt. A canceled launch is a failure. */
export const autopilotOutcomeSchema = z.discriminatedUnion("kind", [
  autopilotOutcomeFieldsSchema.extend({
    kind: z.literal("started"),
    launch: workflowLaunchResultSchema,
  }),
  autopilotOutcomeFieldsSchema.extend({ kind: z.literal("skipped"), reason: z.string().min(1) }),
  autopilotOutcomeFieldsSchema.extend({
    kind: z.literal("failed"),
    message: z.string().min(1),
    /** The host omits it when the launch did not start. */
    launch: workflowLaunchResultSchema.optional(),
    /**
     * The error notification that the host published for this failure. A client that shows the
     * failure itself skips the in-app toast of that notification.
     */
    notificationId: z.string().min(1).optional(),
  }),
]);
export type AutopilotOutcome = z.infer<typeof autopilotOutcomeSchema>;

/** Why Autopilot cannot evaluate task changes, with the recovery step. Null while it works. */
const autopilotFailureSchema = z.string().min(1).nullable();

export const autopilotStateReadInputSchema = z.strictObject({ workspaceId: z.string().min(1) });
export type AutopilotStateReadInput = z.infer<typeof autopilotStateReadInputSchema>;

/** The failed and skipped outcomes that the host holds for one workspace. */
export const autopilotStateSchema = z.strictObject({
  outcomes: z.array(autopilotOutcomeSchema),
  failure: autopilotFailureSchema,
});
export type AutopilotState = z.infer<typeof autopilotStateSchema>;

/** Only one client can send the unsent first message of a failed automatic launch again. */
export const autopilotRecoveryClaimInputSchema = z.strictObject({
  workspaceId: z.string().min(1),
  outcomeId: z.string().min(1),
});
export type AutopilotRecoveryClaimInput = z.infer<typeof autopilotRecoveryClaimInputSchema>;

export const autopilotRecoveryClaimResultSchema = z.strictObject({ claimed: z.boolean() });
export type AutopilotRecoveryClaimResult = z.infer<typeof autopilotRecoveryClaimResultSchema>;

/** Autopilot payloads on the `openducktor://run-event` channel. */
export const autopilotRunEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("autopilot_outcome"), outcome: autopilotOutcomeSchema }),
  z.strictObject({ type: z.literal("autopilot_failure"), failure: autopilotFailureSchema }),
  // A save changed the Autopilot rules. Each client reads the saved settings again.
  z.strictObject({ type: z.literal("autopilot_settings_saved") }),
]);
export type AutopilotRunEvent = z.infer<typeof autopilotRunEventSchema>;
