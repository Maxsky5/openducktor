import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  formatSubagentContent,
  isSubagentMessage,
  mergeSubagentMeta,
  type SubagentMessage,
} from "./subagent-messages";

const chooseSubagentDescription = (
  loadedMeta: SubagentMessage["meta"],
  currentMeta: SubagentMessage["meta"],
  resolvedStatus: SubagentMessage["meta"]["status"],
): string | undefined => {
  const currentMatchesResolvedStatus = currentMeta.status === resolvedStatus;
  const loadedMatchesResolvedStatus = loadedMeta.status === resolvedStatus;

  if (currentMatchesResolvedStatus && !loadedMatchesResolvedStatus) {
    return currentMeta.description ?? loadedMeta.description;
  }
  if (loadedMatchesResolvedStatus && !currentMatchesResolvedStatus) {
    return loadedMeta.description ?? currentMeta.description;
  }

  return loadedMeta.description ?? currentMeta.description;
};

export const mergeSubagentMessages = (
  loadedMessage: SubagentMessage,
  currentMessage: SubagentMessage,
): AgentChatMessage => {
  const loadedMeta = loadedMessage.meta;
  const currentMeta = currentMessage.meta;
  const nextMeta = mergeSubagentMeta(loadedMeta, {
    ...currentMeta,
    partId: loadedMeta.partId,
    correlationKey: loadedMeta.correlationKey,
  });
  const description = chooseSubagentDescription(loadedMeta, currentMeta, nextMeta.status);
  const resolvedMeta = {
    ...nextMeta,
    ...(typeof description === "string" ? { description } : {}),
  };

  return {
    ...loadedMessage,
    content: formatSubagentContent(resolvedMeta),
    meta: resolvedMeta,
  };
};

export const matchesLoadedSubagent = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (candidate.id === loadedMessage.id) {
    return false;
  }

  const loadedSessionId = loadedMessage.meta.externalSessionId;
  if (loadedSessionId) {
    return candidate.meta.externalSessionId === loadedSessionId;
  }

  return false;
};

export const canAbsorbLoadedPartSubagentIntoCurrentSessionRow = (
  loadedMessage: AgentChatMessage,
  candidate: AgentChatMessage,
): boolean => {
  if (!isSubagentMessage(loadedMessage) || !isSubagentMessage(candidate)) {
    return false;
  }
  if (loadedMessage.meta.externalSessionId || !candidate.meta.externalSessionId) {
    return false;
  }
  if (!loadedMessage.meta.correlationKey.startsWith("part:")) {
    return false;
  }
  if (!candidate.meta.correlationKey.startsWith("session:")) {
    return false;
  }

  const loadedAgent = loadedMessage.meta.agent?.trim();
  const candidateAgent = candidate.meta.agent?.trim();
  const loadedPrompt = loadedMessage.meta.prompt?.trim();
  const candidatePrompt = candidate.meta.prompt?.trim();

  if (!loadedAgent || !candidateAgent || !loadedPrompt || !candidatePrompt) {
    return false;
  }

  return loadedAgent === candidateAgent && loadedPrompt === candidatePrompt;
};
