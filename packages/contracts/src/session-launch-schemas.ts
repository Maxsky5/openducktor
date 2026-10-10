import { z } from "zod";
import {
  agentSessionControlSummarySchema,
  acceptedAgentUserMessageSchema,
  agentSessionUserMessagePartSchema,
} from "./agent-session-control-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";

/** The settled result of one host launch. */
export const sessionLaunchResultSchema = z.strictObject({
  workspaceId: z.string(),
  repoPath: z.string(),
  status: z.enum(["completed", "failed", "skipped", "canceled"]),
  /** The saved session. The host omits it when it did not save session ownership. */
  session: agentSessionControlSummarySchema.optional(),
  model: agentSessionModelSelectionSchema.optional(),
  acceptedMessage: acceptedAgentUserMessageSchema.optional(),
  /**
   * The first instruction, when it is safe to send again: the runtime did not get it or rejected
   * it. The host omits it after other send failures, because the runtime can have accepted it.
   */
  unsentInstruction: z.array(agentSessionUserMessagePartSchema).min(1).optional(),
  failure: z
    .strictObject({
      message: z.string(),
      cleanupErrors: z.array(z.string()),
      /**
       * The session notice that shows this failure. The host sets it only after it showed the
       * failure in the live session, which also sends its error notification.
       */
      noticeId: z.string().min(1).optional(),
    })
    .optional(),
  skipReason: z.string().optional(),
});
export type SessionLaunchResult = z.infer<typeof sessionLaunchResultSchema>;
