import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
} from "./agent-chat-draft-storage";
import {
  clearAgentChatDraft,
  flushAgentChatDraft,
  flushAllAgentChatDrafts,
  hydrateAgentChatDraft,
  readAgentChatDraftVersion,
  setAgentChatDraft,
} from "./agent-chat-draft-store";

type ComposerDraftState = {
  key: string;
  identity: AgentChatDraftSessionIdentity | null;
  draft: AgentChatComposerDraft;
};

type UseAgentChatComposerDraftStateArgs = {
  draftStateKey: string;
  persistenceIdentity: AgentChatDraftSessionIdentity | null;
  taskId: string;
};

type SubmittedDraftSnapshot = {
  key: string;
  identity: AgentChatDraftSessionIdentity | null;
  version: number | null;
  draft: AgentChatComposerDraft;
};

type UseAgentChatComposerDraftStateResult = {
  draft: AgentChatComposerDraft;
  commitDraft: (draft: AgentChatComposerDraft) => void;
  setDisplayedDraft: (draft: AgentChatComposerDraft) => void;
  createSubmittedDraftSnapshot: (draft: AgentChatComposerDraft) => SubmittedDraftSnapshot;
  clearSubmittedDraft: (snapshot: SubmittedDraftSnapshot) => void;
  restoreSubmittedDraft: (snapshot: SubmittedDraftSnapshot) => void;
};

const toComposerDraftStateKey = (
  draftStateKey: string,
  identity: AgentChatDraftSessionIdentity | null,
): string => (identity ? toAgentChatDraftStorageKey(identity) : draftStateKey);

const areIdentitiesEqual = (
  left: AgentChatDraftSessionIdentity | null,
  right: AgentChatDraftSessionIdentity | null,
): boolean =>
  left?.workspaceId === right?.workspaceId && left?.externalSessionId === right?.externalSessionId;

const createInitialDraftState = ({
  draftStateKey,
  persistenceIdentity,
  taskId,
}: UseAgentChatComposerDraftStateArgs): ComposerDraftState => ({
  key: toComposerDraftStateKey(draftStateKey, persistenceIdentity),
  identity: persistenceIdentity,
  draft: persistenceIdentity
    ? hydrateAgentChatDraft(persistenceIdentity, taskId)
    : createEmptyComposerDraft(),
});

export function useAgentChatComposerDraftState({
  draftStateKey,
  persistenceIdentity,
  taskId,
}: UseAgentChatComposerDraftStateArgs): UseAgentChatComposerDraftStateResult {
  const [state, setState] = useState<ComposerDraftState>(() =>
    createInitialDraftState({ draftStateKey, persistenceIdentity, taskId }),
  );
  const latestStateRef = useRef(state);
  const nextStateKey = toComposerDraftStateKey(draftStateKey, persistenceIdentity);

  latestStateRef.current = state;

  useLayoutEffect(() => {
    const current = latestStateRef.current;
    if (current.key === nextStateKey && areIdentitiesEqual(current.identity, persistenceIdentity)) {
      return;
    }

    if (current.identity) {
      void flushAgentChatDraft(current.identity);
    }

    const nextDraft = persistenceIdentity
      ? hydrateAgentChatDraft(persistenceIdentity, taskId)
      : createEmptyComposerDraft();
    setState({
      key: nextStateKey,
      identity: persistenceIdentity,
      draft: nextDraft,
    });
  }, [nextStateKey, persistenceIdentity, taskId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const flushDrafts = (): void => {
      void flushAllAgentChatDrafts();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flushDrafts();
      }
    };

    window.addEventListener("pagehide", flushDrafts);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushDrafts);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushDrafts();
    };
  }, []);

  const commitDraft = useCallback(
    (nextDraft: AgentChatComposerDraft): void => {
      const activeIdentity = latestStateRef.current.identity;
      const activeKey = latestStateRef.current.key;
      if (activeIdentity) {
        setAgentChatDraft(activeIdentity, taskId, nextDraft);
      }
      setState({
        key: activeKey,
        identity: activeIdentity,
        draft: nextDraft,
      });
    },
    [taskId],
  );

  const setDisplayedDraft = useCallback((nextDraft: AgentChatComposerDraft): void => {
    const current = latestStateRef.current;
    setState({
      key: current.key,
      identity: current.identity,
      draft: nextDraft,
    });
  }, []);

  const createSubmittedDraftSnapshot = useCallback(
    (draft: AgentChatComposerDraft): SubmittedDraftSnapshot => {
      const current = latestStateRef.current;
      return {
        key: current.key,
        identity: current.identity,
        version: current.identity ? readAgentChatDraftVersion(current.identity) : null,
        draft,
      };
    },
    [],
  );

  const clearSubmittedDraft = useCallback((snapshot: SubmittedDraftSnapshot): void => {
    if (!snapshot.identity) {
      return;
    }
    clearAgentChatDraft(snapshot.identity, { onlyIfVersion: snapshot.version });
  }, []);

  const restoreSubmittedDraft = useCallback((snapshot: SubmittedDraftSnapshot): void => {
    setState((current) => {
      if (current.key !== snapshot.key || draftHasMeaningfulContent(current.draft)) {
        return current;
      }

      return {
        key: current.key,
        identity: current.identity,
        draft: snapshot.draft,
      };
    });
  }, []);

  return useMemo(
    () => ({
      draft: state.key === nextStateKey ? state.draft : createEmptyComposerDraft(),
      commitDraft,
      setDisplayedDraft,
      createSubmittedDraftSnapshot,
      clearSubmittedDraft,
      restoreSubmittedDraft,
    }),
    [
      clearSubmittedDraft,
      commitDraft,
      createSubmittedDraftSnapshot,
      nextStateKey,
      restoreSubmittedDraft,
      setDisplayedDraft,
      state.draft,
      state.key,
    ],
  );
}
