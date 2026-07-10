import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionTurnMetadata = {
  recordModel: (sessionKey: string, model: AgentSessionState["selectedModel"] | undefined) => void;
  readModel: (sessionKey: string) => AgentSessionState["selectedModel"] | undefined;
  recordContextUsageMessageId: (sessionKey: string, messageId: string) => void;
  hasContextUsageMessageId: (sessionKey: string, messageId: string) => boolean;
  recordSessionContextUsageUpdate: (sessionKey: string) => void;
  hasSessionContextUsageUpdate: (sessionKey: string) => boolean;
  clearContextUsage: (sessionKey: string) => void;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
};

export const createSessionTurnMetadata = (): SessionTurnMetadata => {
  const modelBySession: Record<string, AgentSessionState["selectedModel"]> = {};
  const contextUsageMessageIdBySession: Record<string, string> = {};
  const contextUsageUpdatedSessionKeys = new Set<string>();

  const clearSession = (sessionKey: string): void => {
    delete modelBySession[sessionKey];
    delete contextUsageMessageIdBySession[sessionKey];
    contextUsageUpdatedSessionKeys.delete(sessionKey);
  };
  const clearContextUsage = (sessionKey: string): void => {
    delete contextUsageMessageIdBySession[sessionKey];
    contextUsageUpdatedSessionKeys.delete(sessionKey);
  };

  return {
    recordModel: (sessionKey, model) => {
      modelBySession[sessionKey] = model ?? null;
    },
    readModel: (sessionKey) => modelBySession[sessionKey],
    recordContextUsageMessageId: (sessionKey, messageId) => {
      contextUsageMessageIdBySession[sessionKey] = messageId;
    },
    hasContextUsageMessageId: (sessionKey, messageId) =>
      contextUsageMessageIdBySession[sessionKey] === messageId,
    recordSessionContextUsageUpdate: (sessionKey) => {
      contextUsageUpdatedSessionKeys.add(sessionKey);
    },
    hasSessionContextUsageUpdate: (sessionKey) => contextUsageUpdatedSessionKeys.has(sessionKey),
    clearContextUsage,
    clearSession,
    clearAll: () => {
      for (const sessionKey of Object.keys(modelBySession)) {
        delete modelBySession[sessionKey];
      }
      for (const sessionKey of Object.keys(contextUsageMessageIdBySession)) {
        delete contextUsageMessageIdBySession[sessionKey];
      }
      contextUsageUpdatedSessionKeys.clear();
    },
  };
};
