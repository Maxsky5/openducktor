import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  formatSubagentContent,
  isSubagentMessage,
  mergeSubagentMeta,
  type SubagentMessage,
} from "./subagent-messages";

const resolvePreferredHydratedCorrelationKey = (
  existingMeta: SubagentMessage["meta"],
  incomingMeta: SubagentMessage["meta"],
): string => {
  if (
    existingMeta.correlationKey !== incomingMeta.correlationKey &&
    incomingMeta.externalSessionId &&
    !existingMeta.externalSessionId
  ) {
    return incomingMeta.correlationKey;
  }
  if (
    existingMeta.correlationKey !== incomingMeta.correlationKey &&
    existingMeta.externalSessionId &&
    !incomingMeta.externalSessionId
  ) {
    return existingMeta.correlationKey;
  }
  if (existingMeta.correlationKey.startsWith("part:")) {
    return existingMeta.correlationKey;
  }
  if (incomingMeta.correlationKey.startsWith("part:")) {
    return incomingMeta.correlationKey;
  }
  if (existingMeta.correlationKey.startsWith("spawn:")) {
    return existingMeta.correlationKey;
  }
  if (incomingMeta.correlationKey.startsWith("spawn:")) {
    return incomingMeta.correlationKey;
  }

  return existingMeta.correlationKey;
};

const matchesHydratedSubagentMessage = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  if (existingMessage.meta.correlationKey === incomingMessage.meta.correlationKey) {
    return true;
  }

  const existingSessionId = existingMessage.meta.externalSessionId;
  const incomingSessionId = incomingMessage.meta.externalSessionId;
  if (existingSessionId && incomingSessionId) {
    return existingSessionId === incomingSessionId;
  }

  return false;
};

const matchesHydratedSubagentActivity = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  const existingAgent = existingMessage.meta.agent;
  const incomingAgent = incomingMessage.meta.agent;
  const existingPrompt = existingMessage.meta.prompt;
  const incomingPrompt = incomingMessage.meta.prompt;

  return (
    existingMessage.timestamp === incomingMessage.timestamp &&
    typeof existingAgent === "string" &&
    typeof incomingAgent === "string" &&
    existingAgent === incomingAgent &&
    typeof existingPrompt === "string" &&
    typeof incomingPrompt === "string" &&
    existingPrompt === incomingPrompt
  );
};

const shouldIgnoreIncomingHydratedSubagent = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  return Boolean(
    existingMessage.meta.externalSessionId &&
      !incomingMessage.meta.externalSessionId &&
      existingMessage.meta.correlationKey !== incomingMessage.meta.correlationKey &&
      matchesHydratedSubagentActivity(existingMessage, incomingMessage),
  );
};

const canMergeHydratedSubagentMessage = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  if (matchesHydratedSubagentMessage(existingMessage, incomingMessage)) {
    return true;
  }

  return Boolean(
    incomingMessage.meta.externalSessionId &&
      !existingMessage.meta.externalSessionId &&
      matchesHydratedSubagentActivity(existingMessage, incomingMessage),
  );
};

const mergeHydratedSubagentMessages = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): SubagentMessage => {
  const existingMeta = existingMessage.meta;
  const incomingMeta = incomingMessage.meta;
  const correlationKey = resolvePreferredHydratedCorrelationKey(existingMeta, incomingMeta);
  const nextMeta = mergeSubagentMeta(existingMeta, {
    ...incomingMeta,
    correlationKey,
  });

  return {
    ...existingMessage,
    id: `subagent:${correlationKey}`,
    content: formatSubagentContent(nextMeta),
    meta: nextMeta,
  };
};

const findLastHydratedSubagentIndex = (
  messages: AgentChatMessage[],
  incomingMessage: SubagentMessage,
  predicate: (existingMessage: SubagentMessage, incomingMessage: SubagentMessage) => boolean,
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!isSubagentMessage(entry)) {
      continue;
    }
    if (predicate(entry, incomingMessage)) {
      return index;
    }
  }

  return -1;
};

export const appendHydratedSubagentMessage = (
  messages: AgentChatMessage[],
  incomingMessage: SubagentMessage,
): void => {
  const ignoredIndex = findLastHydratedSubagentIndex(
    messages,
    incomingMessage,
    shouldIgnoreIncomingHydratedSubagent,
  );
  if (ignoredIndex >= 0) {
    return;
  }

  const existingIndex = findLastHydratedSubagentIndex(
    messages,
    incomingMessage,
    canMergeHydratedSubagentMessage,
  );
  if (existingIndex >= 0) {
    const existingMessage = messages[existingIndex];
    if (isSubagentMessage(existingMessage)) {
      messages[existingIndex] = mergeHydratedSubagentMessages(existingMessage, incomingMessage);
      return;
    }
  }

  messages.push(incomingMessage);
};
