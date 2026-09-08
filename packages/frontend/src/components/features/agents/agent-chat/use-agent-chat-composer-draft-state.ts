import type { AgentChatSendRecovery } from "./agent-chat-send-result";
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

type SubmittedDraftSnapshot = ComposerDraftState & {
  version: number | null;
  editSequence: number;
};

type UseAgentChatComposerDraftStateResult = {
  draft: AgentChatComposerDraft;
  commitDraft: (draft: AgentChatComposerDraft) => void;
  setDisplayedDraft: (draft: AgentChatComposerDraft) => void;
  createSubmittedDraftSnapshot: (draft: AgentChatComposerDraft) => SubmittedDraftSnapshot;
  clearSubmittedDraft: (snapshot: SubmittedDraftSnapshot) => void;
  restoreSubmittedDraft: (
    snapshot: SubmittedDraftSnapshot,
    recovery?: AgentChatSendRecovery,
  ) => void;
};

/** Keeps failed sends for their own draft scope without replacing newer edits. */
export function useAgentChatComposerDraftState({
  scope,
}: UseAgentChatComposerDraftStateArgs): UseAgentChatComposerDraftStateResult {
  const [state, setState] = useState<ComposerDraftState>(() => createInitialDraftState(scope));
  const latestStateRef = useRef(state);
  const pendingRecoveryRef = useRef(new Map<string, AgentChatComposerDraft>());
  // Count edits across scopes so a late failure cannot restore text the user has since cleared.
  const editSequenceRef = useRef(0);
  const scopeEditsRef = useRef(new Map<string, number>());
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
        // Callers can pass a new wrapper for the same store on each render.
        // Update the ref alone to avoid a render loop.
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
      if (hasCurrentDraft && nextPersistence) {
        nextPersistence.set(current.draft);
        pendingRecoveryRef.current.delete(nextKey);
      }
      setState({
        key: current.key,
        persistence: nextPersistence,
        draft: nextDraft,
      });
      return;
    }

    const nextState = createInitialDraftState({ key: nextKey, persistence: nextPersistence });
    const recovered = pendingRecoveryRef.current.get(nextKey);
    if (recovered) {
      if (draftHasMeaningfulContent(nextState.draft)) {
        pendingRecoveryRef.current.delete(nextKey);
      } else {
        nextState.draft = recovered;
        if (nextPersistence) {
          nextPersistence.set(recovered);
          pendingRecoveryRef.current.delete(nextKey);
        }
      }
    }
    latestStateRef.current = nextState;
    setState(nextState);
  }, [nextKey, nextPersistence]);

  useEffect(() => {
    if (globalThis.window === undefined || globalThis.document === undefined) {
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
    editSequenceRef.current += 1;
    scopeEditsRef.current.set(current.key, editSequenceRef.current);
    pendingRecoveryRef.current.delete(current.key);
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
        editSequence: editSequenceRef.current,
        draft,
      };
    },
    [],
  );

  const clearSubmittedDraft = useCallback((snapshot: SubmittedDraftSnapshot): void => {
    pendingRecoveryRef.current.delete(snapshot.key);
    snapshot.persistence?.clear({ onlyIfVersion: snapshot.version });
  }, []);

  const restoreSubmittedDraft = useCallback(
    (snapshot: SubmittedDraftSnapshot, recovery?: AgentChatSendRecovery): void => {
      const current = latestStateRef.current;
      if (recovery && recovery.originKey === snapshot.key) {
        if ((scopeEditsRef.current.get(recovery.recoveryKey) ?? 0) > snapshot.editSequence) return;
        if (current.key === recovery.recoveryKey && draftHasMeaningfulContent(current.draft)) {
          return;
        }
        pendingRecoveryRef.current.set(recovery.recoveryKey, snapshot.draft);
        if (current.key === recovery.recoveryKey) {
          if (current.persistence) {
            current.persistence.set(snapshot.draft);
            pendingRecoveryRef.current.delete(current.key);
          }
          const restored = { ...current, draft: snapshot.draft };
          latestStateRef.current = restored;
          setState(restored);
        }
        return;
      }
      if (
        current.key !== snapshot.key &&
        !snapshot.persistence &&
        (scopeEditsRef.current.get(snapshot.key) ?? 0) <= snapshot.editSequence
      ) {
        pendingRecoveryRef.current.set(snapshot.key, snapshot.draft);
      }
      if (current.key !== snapshot.key || draftHasMeaningfulContent(current.draft)) {
        return;
      }

      current.persistence?.set(snapshot.draft);
      setState({
        key: current.key,
        persistence: current.persistence,
        draft: snapshot.draft,
      });
    },
    [],
  );

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

const createInitialDraftState = ({
  key,
  persistence,
}: AgentChatDraftScope): ComposerDraftState => ({
  key,
  persistence,
  draft: persistence?.hydrate() ?? createEmptyComposerDraft(),
});
