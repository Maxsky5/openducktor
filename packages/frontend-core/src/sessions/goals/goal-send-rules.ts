import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  goalCommandBlockedReason,
} from "@openducktor/core";
import { MISSING_RUNTIME_REASON } from "../send/agent-message-send-policy";

/**
 * Checks a `/goal` message before the composer sends it, so a refused command keeps the draft.
 * It throws for a malformed command and for an action that the runtime cannot run.
 */
export const assertGoalCommandAllowed = (
  parts: AgentUserMessagePart[],
  runtimeDescriptor: RuntimeDescriptor | null,
  runtimeVersion: string | null,
): void => {
  const invocation = classifySystemSlashCommandInvocation(parts);
  if (invocation.kind !== "goal") return;
  if (!runtimeDescriptor) throw new Error(MISSING_RUNTIME_REASON);
  const reason = goalCommandBlockedReason(invocation.command, runtimeDescriptor, runtimeVersion);
  if (reason) throw new Error(reason);
};
