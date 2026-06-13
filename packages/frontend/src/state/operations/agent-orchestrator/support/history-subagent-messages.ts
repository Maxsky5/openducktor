import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  formatSubagentContent,
  isSubagentMessage,
  mergeSubagentMeta,
  type SubagentMessage,
} from "./subagent-messages";

const resolvePreferredLoadedCorrelationKey = (
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

const matchesLoadedSubagentMessage = (
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

const matchesLoadedSubagentActivity = (
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

const shouldIgnoreIncomingLoadedSubagent = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  return Boolean(
    existingMessage.meta.externalSessionId &&
      !incomingMessage.meta.externalSessionId &&
      existingMessage.meta.correlationKey !== incomingMessage.meta.correlationKey &&
      matchesLoadedSubagentActivity(existingMessage, incomingMessage),
  );
};

const canMergeLoadedSubagentMessage = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): boolean => {
  if (matchesLoadedSubagentMessage(existingMessage, incomingMessage)) {
    return true;
  }

  return Boolean(
    incomingMessage.meta.externalSessionId &&
      !existingMessage.meta.externalSessionId &&
      matchesLoadedSubagentActivity(existingMessage, incomingMessage),
  );
};

const mergeLoadedSubagentMessages = (
  existingMessage: SubagentMessage,
  incomingMessage: SubagentMessage,
): SubagentMessage => {
  const existingMeta = existingMessage.meta;
  const incomingMeta = incomingMessage.meta;
  const correlationKey = resolvePreferredLoadedCorrelationKey(existingMeta, incomingMeta);
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

const findLastLoadedSubagentIndex = (
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

export const appendHistorySubagentMessage = (
  messages: AgentChatMessage[],
  incomingMessage: SubagentMessage,
): void => {
  const ignoredIndex = findLastLoadedSubagentIndex(
    messages,
    incomingMessage,
    shouldIgnoreIncomingLoadedSubagent,
  );
  if (ignoredIndex >= 0) {
    return;
  }

  const existingIndex = findLastLoadedSubagentIndex(
    messages,
    incomingMessage,
    canMergeLoadedSubagentMessage,
  );
  if (existingIndex >= 0) {
    const existingMessage = messages[existingIndex];
    if (isSubagentMessage(existingMessage)) {
      messages[existingIndex] = mergeLoadedSubagentMessages(existingMessage, incomingMessage);
      return;
    }
  }

  messages.push(incomingMessage);
};
