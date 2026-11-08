import type { AcceptedAgentInput, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentDeliveryAvailability } from "./agent-message-delivery";
import type { AgentSessionGoalCommand } from "./agent-system-slash-commands";
import { compareRuntimeVersion } from "./runtime-version";

type GoalRuntimeDescriptor = Pick<RuntimeDescriptor, "label" | "capabilities" | "updateAction">;

/**
 * Tells if the runtime has native goals. `runtimeVersion` is the version that the host read from
 * the runtime executable, or `null` when the host could not read it.
 */
export const resolveRuntimeGoalAvailability = (
  descriptor: GoalRuntimeDescriptor,
  runtimeVersion: string | null,
): AgentDeliveryAvailability => {
  const { label, updateAction } = descriptor;
  const { minimumRuntimeVersion } = descriptor.capabilities.goals;
  if (minimumRuntimeVersion === null) {
    return { available: false, reason: `${label} has no goals.` };
  }
  const comparison = compareRuntimeVersion(runtimeVersion, minimumRuntimeVersion);
  if (comparison === null) {
    return {
      available: false,
      reason: `OpenDucktor cannot read the ${label} version. Goals need ${label} ${minimumRuntimeVersion} or later. ${updateAction}`,
    };
  }
  if (!comparison.supported) {
    return {
      available: false,
      reason: `Goals need ${label} ${minimumRuntimeVersion} or later. ${updateAction}`,
    };
  }
  return { available: true };
};

/** Why the runtime cannot run a goal command, or `null` when it can. */
export const goalCommandBlockedReason = (
  command: AgentSessionGoalCommand,
  descriptor: GoalRuntimeDescriptor,
  runtimeVersion: string | null,
): string | null => {
  const availability = resolveRuntimeGoalAvailability(descriptor, runtimeVersion);
  if (!availability.available) return availability.reason;
  if (
    (command.kind === "pause" || command.kind === "resume") &&
    !descriptor.capabilities.goals.supportsPauseResume
  ) {
    return `${descriptor.label} cannot ${command.kind} a goal.`;
  }
  return null;
};

/** What a runtime adapter returns when it accepts a goal action. */
export const GOAL_COMMAND_ACCEPTED = {
  type: "command_accepted",
  commandName: "goal",
} as const satisfies Extract<AcceptedAgentInput, { type: "command_accepted" }>;

/** A goal command that starts agent work ends with a turn end. The other commands end at once. */
export const goalCommandStartsWork = (command: AgentSessionGoalCommand): boolean =>
  command.kind === "set" || command.kind === "resume";
