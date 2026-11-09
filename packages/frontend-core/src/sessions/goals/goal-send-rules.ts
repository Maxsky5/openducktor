import {
  GOAL_SLASH_COMMAND,
  type RuntimeDescriptor,
  textAfterLeadingGoalCommand,
} from "@openducktor/contracts";
import {
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  goalCommandBlockedReason,
  resolveRuntimeGoalAvailability,
} from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createSlashCommandSegment,
  createTextSegment,
} from "../../drafts/agent-chat-composer-draft";
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

/**
 * A typed or pasted `/goal …` is the system command, as if the user picked it in the menu. Without
 * goals, the text goes to the runtime unchanged.
 */
export const promoteTypedGoalCommand = (
  draft: AgentChatComposerDraft,
  runtimeDescriptor: RuntimeDescriptor | null,
  runtimeVersion: string | null,
): AgentChatComposerDraft => {
  const [first, ...rest] = draft.segments;
  if (first?.kind !== "text" || !runtimeDescriptor) return draft;
  const objective = textAfterLeadingGoalCommand(first.text);
  if (
    objective === null ||
    !resolveRuntimeGoalAvailability(runtimeDescriptor, runtimeVersion).available
  )
    return draft;
  return {
    ...draft,
    segments: [
      createSlashCommandSegment({ ...GOAL_SLASH_COMMAND, hints: [...GOAL_SLASH_COMMAND.hints] }),
      createTextSegment(objective),
      ...rest,
    ],
  };
};
