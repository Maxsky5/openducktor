import type { AgentSessionState } from "@/types/agent-orchestrator";

export const findFirstChangedMessageIndex = (
  previousMessages: AgentSessionState["messages"] | null,
  nextMessages: AgentSessionState["messages"],
): number => {
  if (previousMessages === null) {
    return 0;
  }

  if (nextMessages.length < previousMessages.length) {
    return 0;
  }

  const sharedLength = Math.min(previousMessages.length, nextMessages.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (previousMessages[index] !== nextMessages[index]) {
      return index;
    }
  }

  return nextMessages.length > previousMessages.length ? previousMessages.length : -1;
};
