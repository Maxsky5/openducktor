import type {
  AgentQueuedMessageState,
  AgentSessionUserMessagePart,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { compareRuntimeVersion } from "./runtime-version";

export type AgentDeliveryAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/**
 * Tells if the runtime can steer running work. `runtimeVersion` is the version that the host
 * read from the runtime executable, or `null` when the host could not read it.
 */
export const resolveRuntimeSteeringAvailability = (
  descriptor: Pick<RuntimeDescriptor, "label" | "capabilities">,
  runtimeVersion: string | null,
): AgentDeliveryAvailability => {
  const { label } = descriptor;
  const { minimumSteeringRuntimeVersion } = descriptor.capabilities.messageDelivery;
  if (minimumSteeringRuntimeVersion === null) {
    return {
      available: false,
      reason: `${label} cannot send a message to running work.`,
    };
  }
  const comparison = compareRuntimeVersion(runtimeVersion, minimumSteeringRuntimeVersion);
  if (comparison === null) {
    return {
      available: false,
      reason: `OpenDucktor cannot read the ${label} version. Steering needs ${label} ${minimumSteeringRuntimeVersion} or later.`,
    };
  }
  if (!comparison.supported) {
    return {
      available: false,
      reason: `${label} ${comparison.version} cannot steer running work. Update ${label} to ${minimumSteeringRuntimeVersion} or later.`,
    };
  }
  return { available: true };
};

/** A queued message whose delivery started waits for the runtime, so nobody can change it. */
export const isQueuedDeliveryStarted = (entry: {
  readonly state: AgentQueuedMessageState;
}): boolean => entry.state === "sending" || entry.state === "steering";

/** A native slash command starts its own turn, so it cannot join running work. */
export const steeringPartsBlockedReason = (
  parts: ReadonlyArray<Pick<AgentSessionUserMessagePart, "kind">>,
): string | null =>
  parts.some((part) => part.kind === "slash_command")
    ? "A slash command cannot join running work."
    : null;

/** An approval or a blocking question stops the agent until the user answers it. */
export const isAgentSessionBlockedOnInput = (session: {
  readonly pendingApprovals: ReadonlyArray<object>;
  readonly pendingQuestions: ReadonlyArray<{ readonly blocking?: boolean | undefined }>;
}): boolean =>
  session.pendingApprovals.length > 0 ||
  session.pendingQuestions.some((question) => question.blocking !== false);

export const BLOCKED_ON_INPUT_REASON =
  "The agent waits for your answer to a pending request. Answer it first.";
