import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const draftIdsBySession = new Map<string, Set<string>>();

const emitDraftChange = (key: string): void => {
  for (const listener of listeners.get(key) ?? []) {
    listener();
  }
};

export const agentAsyncQuestionDraftKey = (
  sessionIdentity: AgentSessionIdentity,
  questionItemId: string,
): string => JSON.stringify([agentSessionIdentityKey(sessionIdentity), questionItemId]);

const writeDraft = (
  sessionIdentity: AgentSessionIdentity,
  questionItemId: string,
  value: string,
): void => {
  const sessionKey = agentSessionIdentityKey(sessionIdentity);
  const key = agentAsyncQuestionDraftKey(sessionIdentity, questionItemId);
  if (value.length === 0) {
    drafts.delete(key);
    const draftIds = draftIdsBySession.get(sessionKey);
    draftIds?.delete(questionItemId);
    if (draftIds?.size === 0) {
      draftIdsBySession.delete(sessionKey);
    }
  } else {
    drafts.set(key, value);
    const draftIds = draftIdsBySession.get(sessionKey) ?? new Set();
    draftIds.add(questionItemId);
    draftIdsBySession.set(sessionKey, draftIds);
  }
  emitDraftChange(key);
};

export const pruneAgentAsyncQuestionDrafts = (
  sessionIdentity: AgentSessionIdentity,
  pendingIds: readonly string[],
): void => {
  const draftIds = draftIdsBySession.get(agentSessionIdentityKey(sessionIdentity));
  if (!draftIds) {
    return;
  }
  const pending = new Set(pendingIds);
  for (const questionItemId of draftIds) {
    if (!pending.has(questionItemId)) {
      writeDraft(sessionIdentity, questionItemId, "");
    }
  }
};

export const clearAgentAsyncQuestionDrafts = (sessionIdentity: AgentSessionIdentity): void => {
  const draftIds = draftIdsBySession.get(agentSessionIdentityKey(sessionIdentity));
  if (!draftIds) {
    return;
  }
  for (const questionItemId of draftIds) {
    writeDraft(sessionIdentity, questionItemId, "");
  }
};

export const useAgentAsyncQuestionDraft = (
  sessionIdentity: AgentSessionIdentity,
  questionItemId: string,
): { answer: string; setAnswer: (answer: string) => void; clearAnswer: () => void } => {
  const key = useMemo(
    () => agentAsyncQuestionDraftKey(sessionIdentity, questionItemId),
    [questionItemId, sessionIdentity],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const draftListeners = listeners.get(key) ?? new Set();
      draftListeners.add(listener);
      listeners.set(key, draftListeners);
      return () => {
        draftListeners.delete(listener);
        if (draftListeners.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => drafts.get(key) ?? "", [key]);
  const answer = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setAnswer = useCallback(
    (value: string) => writeDraft(sessionIdentity, questionItemId, value),
    [questionItemId, sessionIdentity],
  );
  const clearAnswer = useCallback(
    () => writeDraft(sessionIdentity, questionItemId, ""),
    [questionItemId, sessionIdentity],
  );

  return useMemo(() => ({ answer, setAnswer, clearAnswer }), [answer, clearAnswer, setAnswer]);
};
