import {
  isRpcError,
  type OpenCodeClient,
  type SessionMessageInfo,
  type V2Event,
} from "@opencode/client";
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

/**
 * Reads the goal of a session through the plugin RPC. `null`: the session has no goal. The goal
 * plugin is not a protected plugin, so a user config can turn it off. OpenCode then answers with
 * `rpc.unavailable`, and the server has no goals, so the session has none either.
 */
export const readOpenCodeGoal = async (
  client: OpenCodeClient,
  sessionID: string,
  directory: string,
): Promise<AgentSessionGoal | null> => {
  const response = await client.rpc
    .call({ rpcID: GOAL_RPC_ID, method: "get", location: { directory }, input: { sessionID } })
    .catch((cause: unknown) => {
      if (isRpcError(cause) && cause.type === "rpc.unavailable") return { output: null };
      throw cause;
    });
  return projectGoal(goalReadSchema.parse(response).output);
};

/** The new goal of a `changed` event. `null`: the goal was cleared. */
export const readOpenCodeGoalChange = (
  event: Extract<V2Event, { type: `rpc.${string}` }>,
): AgentSessionGoal | null => projectGoal(goalChangedSchema.parse(event.data).goal);

/** The argument text of the native `/goal` command. */
export const openCodeGoalCommandText = (command: AgentSessionGoalCommand): string =>
  command.kind === "set" ? command.objective : command.kind;

/**
 * OpenCode has no `/goal` command when a config turns the goal plugin off. Its native error names
 * no reason, so this message says how to turn goals on again.
 */
export const OPENCODE_GOAL_PLUGIN_OFF_MESSAGE =
  'OpenCode has no /goal command, because its config turns the goal plugin off. Remove "-opencode.goal" from "plugins" in the OpenCode config, then try again.';

const UNTRUSTED_OBJECTIVE = /<untrusted_objective>\n([\s\S]*?)\n<\/untrusted_objective>/;

/**
 * The objective of the message that the goal plugin writes when `/goal <objective>` sets a goal,
 * or `null` for another message. The plugin writes no user message, so this message stands for the
 * `/goal` message of the user, live and in history. The plugin escapes `&`, `<`, and `>`.
 */
export const readOpenCodeGoalKickoffObjective = (message: SessionMessageInfo): string | null => {
  // The goal plugin gives a description only to the message that starts a new goal.
  if (
    message.type !== "synthetic" ||
    message.description === undefined ||
    message.metadata?.source !== "goal"
  )
    return null;
  const escaped = UNTRUSTED_OBJECTIVE.exec(message.text)?.[1];
  if (escaped === undefined) return null;
  return escaped.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
};
