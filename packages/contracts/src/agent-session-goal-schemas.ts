import { z } from "zod";

/** The longest goal objective that every runtime accepts. */
export const AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH = 4000;

const agentSessionGoalStatusValues = [
  "active",
  "paused",
  "blocked",
  "limit_reached",
  "complete",
  /** The goal is set, and the runtime continues it only with the next user message. */
  "waiting_for_message",
  /** The runtime ended the goal without a reason that OpenDucktor can read. */
  "ended",
] as const;
export const agentSessionGoalStatusSchema = z.enum(agentSessionGoalStatusValues);
export type AgentSessionGoalStatus = z.infer<typeof agentSessionGoalStatusSchema>;

/** The goal that the runtime reports for a session. The runtime owns it; OpenDucktor stores none. */
export const agentSessionGoalSchema = z
  .object({
    objective: z.string().trim().min(1),
    status: agentSessionGoalStatusSchema,
    /** Runtime text, for example "Stopped by the user". */
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type AgentSessionGoal = z.infer<typeof agentSessionGoalSchema>;

/** A goal objective that every runtime accepts. */
export const agentSessionGoalObjectiveSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH);
