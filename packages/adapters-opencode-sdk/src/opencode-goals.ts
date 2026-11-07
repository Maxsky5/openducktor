import type { OpenCodeClient, V2Event } from "@opencode/client";
import type { AgentSessionGoal } from "@openducktor/contracts";
import type { AgentSessionGoalCommand } from "@openducktor/core";
import { z } from "zod";

/** The built-in `/goal` plugin of OpenCode 2.2.1 and later. */
const GOAL_RPC_ID = "opencode.goal";
/** The plugin publishes this event in the session location on every goal write. */
export const OPENCODE_GOAL_CHANGED_EVENT = `rpc.${GOAL_RPC_ID}.changed`;

// Mirrors `Goal.State` of `@opencode/schema/goal`. Only the fields that OpenDucktor shows are read.
const nativeGoalSchema = z.object({
  objective: z.string().trim().min(1),
  status: z.enum(["active", "paused", "complete"]),
  reason: z.string().optional(),
});
const goalReadSchema = z.object({ output: nativeGoalSchema.nullable() });
const goalChangedSchema = z.object({
  sessionID: z.string().min(1),
  goal: nativeGoalSchema.nullable(),
});

const projectGoal = (goal: z.infer<typeof nativeGoalSchema> | null): AgentSessionGoal | null => {
  if (!goal) return null;
  const projected: AgentSessionGoal = { objective: goal.objective, status: goal.status };
  const reason = goal.reason?.trim();
  if (reason) projected.reason = reason;
  return projected;
};

/** Reads the goal of a session through the plugin RPC. `null`: the session has no goal. */
export const readOpenCodeGoal = async (
  client: OpenCodeClient,
  sessionID: string,
  directory: string,
): Promise<AgentSessionGoal | null> =>
  projectGoal(
    goalReadSchema.parse(
      await client.rpc.call({
        rpcID: GOAL_RPC_ID,
        method: "get",
        location: { directory },
        input: { sessionID },
      }),
    ).output,
  );

/** The new goal of a `changed` event. `null`: the goal was cleared. */
export const readOpenCodeGoalChange = (
  event: Extract<V2Event, { type: `rpc.${string}` }>,
): AgentSessionGoal | null => projectGoal(goalChangedSchema.parse(event.data).goal);

/** The argument text of the native `/goal` command. */
export const openCodeGoalCommandText = (command: AgentSessionGoalCommand): string =>
  command.kind === "set" ? command.objective : command.kind;
