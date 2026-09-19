import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const trackedIdsBySession = new Map<string, Set<string>>();

const emitDraftChange = (key: string): void => {
  for (const listener of listeners.get(key) ?? []) {
    listener();
  }
};

const writeDraft = (key: string, value: string): void => {
  if (value.length === 0) {
    drafts.delete(key);
  } else {
    drafts.set(key, value);
  }
  emitDraftChange(key);
};

export const agentAsyncQuestionDraftKey = (
  sessionIdentity: AgentSessionIdentity,
  questionItemId: string,
): string => JSON.stringify([agentSessionIdentityKey(sessionIdentity), questionItemId]);

export const pruneAgentAsyncQuestionDrafts = (
  sessionIdentity: AgentSessionIdentity,
  pendingIds: readonly string[],
): void => {
  const sessionKey = agentSessionIdentityKey(sessionIdentity);
  const trackedIds = trackedIdsBySession.get(sessionKey);
  const pendingSet = new Set(pendingIds);
  if (trackedIds) {
    for (const questionItemId of trackedIds) {
      if (!pendingSet.has(questionItemId)) {
        writeDraft(agentAsyncQuestionDraftKey(sessionIdentity, questionItemId), "");
      }
    }
  }
  trackedIdsBySession.set(sessionKey, pendingSet);
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
  const setAnswer = useCallback((value: string) => writeDraft(key, value), [key]);
  const clearAnswer = useCallback(() => writeDraft(key, ""), [key]);

  return useMemo(() => ({ answer, setAnswer, clearAnswer }), [answer, clearAnswer, setAnswer]);
};
