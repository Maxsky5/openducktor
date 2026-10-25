import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type AgentSessionUsageLimit,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { runtimeSupportsCapability } from "./agent-runtime";
import { isAgentSessionActivityActive } from "./agent-session-activity-state";
import type { OptionalAgentSessionActivityState } from "../types/agent-session-activity";
import type { AgentChatMessage } from "../types/agent-orchestrator";

/**
 * True when the transcript holds a user turn whose latest assistant reply is not final.
 * Tool output, partial assistant text, an interruption notice, and an error notice keep the
 * turn open. A manual compaction request is a session command, not an interrupted turn. It
 * settles only when a completed compaction notice follows it; otherwise a typed `/compact`
 * prompt stays resumable.
 */
export const hasUnfinishedLatestTurn = (messages: readonly AgentChatMessage[]): boolean => {
  let compactionSettled = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === "user") {
      return isCompactionCommand(message) ? !compactionSettled : true;
    }
    if (message.meta?.kind === "session_notice" && message.meta.reason === "session_compacted") {
      compactionSettled = message.meta.compactionStatus !== "running";
    }
    if (message.role === "assistant" && message.meta?.kind === "assistant") {
      if (message.meta.isFinal === true) {
        return false;
      }
    }
  }
  return false;
};

/**
 * True when the transcript holds at least one message and its latest turn finished.
 */
export const hasSettledLatestTurn = (messages: readonly AgentChatMessage[]): boolean =>
  messages.length > 0 && !hasUnfinishedLatestTurn(messages);

export const latestTurnUsageLimit = (
  messages: readonly AgentChatMessage[],
): AgentSessionUsageLimit | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user" || (message.meta?.kind === "assistant" && message.meta.isFinal)) {
      return undefined;
    }
    if (message.meta?.kind === "session_notice" && message.meta.reason === "session_error") {
      return message.meta.usageLimit;
    }
  }
  return undefined;
};

export const canResumeInterruptedTurn = ({
  activityState,
  messages,
  runtimeDescriptor,
}: {
  activityState: OptionalAgentSessionActivityState;
  messages: readonly AgentChatMessage[];
  runtimeDescriptor: RuntimeDescriptor | null;
}): boolean => {
  if (activityState === null || isAgentSessionActivityActive(activityState)) {
    return false;
  }
  if (
    !runtimeDescriptor ||
    !runtimeSupportsCapability(runtimeDescriptor, "sessionLifecycle.supportsInterruptedTurnResume")
  ) {
    return false;
  }
  return hasUnfinishedLatestTurn(messages);
};

const COMPACTION_COMMAND = `/${MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger}`;

const isCompactionCommand = (message: AgentChatMessage): boolean =>
  message.role === "user" && message.content.trim() === COMPACTION_COMMAND;
