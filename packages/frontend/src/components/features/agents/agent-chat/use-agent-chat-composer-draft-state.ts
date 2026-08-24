import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import type { AgentChatDraftPersistence, AgentChatDraftScope } from "./agent-chat-draft-scope";

type ComposerDraftState = {
  key: string;
  persistence: AgentChatDraftPersistence | null;
  draft: AgentChatComposerDraft;
};

type UseAgentChatComposerDraftStateArgs = {
  scope: AgentChatDraftScope;
};

type SubmittedDraftSnapshot = {
  key: string;
  persistence: AgentChatDraftPersistence | null;
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

const createInitialDraftState = ({
  key,
  persistence,
}: AgentChatDraftScope): ComposerDraftState => ({
  key,
  persistence,
  draft: persistence?.hydrate() ?? createEmptyComposerDraft(),
});

export function useAgentChatComposerDraftState({
  scope,
}: UseAgentChatComposerDraftStateArgs): UseAgentChatComposerDraftStateResult {
  const [state, setState] = useState<ComposerDraftState>(() => createInitialDraftState(scope));
  const latestStateRef = useRef(state);
  const nextKey = scope.key;
  const nextPersistence = scope.persistence;

  useLayoutEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useLayoutEffect(() => {
    const current = latestStateRef.current;
    const isSameDraft = current.key === nextKey;
    const isSamePersistenceTarget = current.persistence?.targetKey === nextPersistence?.targetKey;
    if (isSameDraft && isSamePersistenceTarget) {
      if (current.persistence !== nextPersistence) {
        // Equivalent wrappers may be recreated every render. Updating state here would loop;
        // callbacks and lifecycle handlers read this ref until the next state update catches up.
        latestStateRef.current = {
          key: current.key,
          persistence: nextPersistence,
          draft: current.draft,
        };
      }
      return;
    }

    if (current.persistence) {
      void current.persistence.flush();
    }

    if (isSameDraft) {
      const hasCurrentDraft = draftHasMeaningfulContent(current.draft);
      const nextDraft = hasCurrentDraft
        ? current.draft
        : (nextPersistence?.hydrate() ?? current.draft);
      if (hasCurrentDraft) {
        nextPersistence?.set(current.draft);
      }
      setState({
        key: current.key,
        persistence: nextPersistence,
        draft: nextDraft,
      });
      return;
    }

    setState(createInitialDraftState({ key: nextKey, persistence: nextPersistence }));
  }, [nextKey, nextPersistence]);

  useEffect(() => {
    if (typeof globalThis.window === "undefined" || typeof globalThis.document === "undefined") {
      return;
    }

    const flushDraft = (): void => {
      const persistence = latestStateRef.current.persistence;
      if (persistence) {
        void persistence.flush();
      }
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flushDraft();
      }
    };

    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushDraft();
    };
  }, []);

  const commitDraft = useCallback((nextDraft: AgentChatComposerDraft): void => {
    const current = latestStateRef.current;
    current.persistence?.set(nextDraft);
    setState({
      key: current.key,
      persistence: current.persistence,
      draft: nextDraft,
    });
  }, []);

  const setDisplayedDraft = useCallback((nextDraft: AgentChatComposerDraft): void => {
    const current = latestStateRef.current;
    setState({
      key: current.key,
      persistence: current.persistence,
      draft: nextDraft,
    });
  }, []);

  const createSubmittedDraftSnapshot = useCallback(
    (draft: AgentChatComposerDraft): SubmittedDraftSnapshot => {
      const current = latestStateRef.current;
      return {
        key: current.key,
        persistence: current.persistence,
        version: current.persistence?.readVersion() ?? null,
        draft,
      };
    },
    [],
  );

  const clearSubmittedDraft = useCallback((snapshot: SubmittedDraftSnapshot): void => {
    snapshot.persistence?.clear({ onlyIfVersion: snapshot.version });
  }, []);

  const restoreSubmittedDraft = useCallback((snapshot: SubmittedDraftSnapshot): void => {
    const current = latestStateRef.current;
    if (current.key !== snapshot.key || draftHasMeaningfulContent(current.draft)) {
      return;
    }

    current.persistence?.set(snapshot.draft);
    setState({
      key: current.key,
      persistence: current.persistence,
      draft: snapshot.draft,
    });
  }, []);

  return useMemo(
    () => ({
      draft: state.key === nextKey ? state.draft : createEmptyComposerDraft(),
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
      restoreSubmittedDraft,
      nextKey,
      setDisplayedDraft,
      state.draft,
      state.key,
    ],
  );
}
