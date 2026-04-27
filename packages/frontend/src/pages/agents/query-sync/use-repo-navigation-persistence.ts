import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type AgentStudioNavigationState,
  clearAgentStudioNavigationState,
  hasAgentStudioNavigationSelection,
  type PersistedAgentStudioContext,
  parsePersistedContext,
  restoreNavigationFromPersistedContext,
  serializePersistedContext,
  toContextStorageKey,
} from "./agent-studio-navigation";

type UseRepoNavigationPersistenceArgs = {
  activeWorkspace: ActiveWorkspace | null;
  navigation: AgentStudioNavigationState;
  setNavigation: Dispatch<SetStateAction<AgentStudioNavigationState>>;
};

type UseRepoNavigationPersistenceResult = {
  isRepoNavigationBoundaryPending: boolean;
  persistenceError: Error | null;
  retryPersistenceRestore: () => void;
};

export type RepoNavigationBoundaryPhase = "idle" | "detecting" | "clearing";

export const resolveRepoNavigationBoundaryPhase = ({
  activeWorkspace,
  lastWorkspaceId,
  boundaryWorkspaceId,
}: {
  activeWorkspace: ActiveWorkspace | null;
  lastWorkspaceId: string | null;
  boundaryWorkspaceId: string | null;
}): RepoNavigationBoundaryPhase => {
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  if (!activeWorkspaceId) {
    return "idle";
  }

  if (lastWorkspaceId && lastWorkspaceId !== activeWorkspaceId) {
    return "detecting";
  }

  if (boundaryWorkspaceId === activeWorkspaceId) {
    return "clearing";
  }

  return "idle";
};

const readPersistedContextPayload = (storageKey: string): string | null => {
  try {
    return globalThis.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new Error(
      `Failed to read agent studio context storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};

const writePersistedContextPayload = (storageKey: string, payload: string): void => {
  try {
    globalThis.localStorage.setItem(storageKey, payload);
  } catch (cause) {
    throw new Error(
      `Failed to persist agent studio context storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};

export function useRepoNavigationPersistence({
  activeWorkspace,
  navigation,
  setNavigation,
}: UseRepoNavigationPersistenceArgs): UseRepoNavigationPersistenceResult {
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const lastWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const restoredContextWorkspaceIdRef = useRef<string | null>(null);
  const persistedContextPayloadRef = useRef<string | null>(null);
  const pendingContextPersistRef = useRef<{ key: string; payload: string } | null>(null);
  const pendingPersistTimeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [boundaryWorkspaceId, setBoundaryWorkspaceId] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);
  const repoNavigationBoundaryPhase = resolveRepoNavigationBoundaryPhase({
    activeWorkspace,
    lastWorkspaceId: lastWorkspaceIdRef.current,
    boundaryWorkspaceId,
  });
  const isRepoNavigationBoundaryPending = repoNavigationBoundaryPhase !== "idle";

  const flushPendingContextPersist = useCallback((): void => {
    const pendingPersist = pendingContextPersistRef.current;
    if (!pendingPersist) {
      return;
    }

    if (pendingPersistTimeoutIdRef.current !== null) {
      globalThis.clearTimeout(pendingPersistTimeoutIdRef.current);
      pendingPersistTimeoutIdRef.current = null;
    }

    writePersistedContextPayload(pendingPersist.key, pendingPersist.payload);
    pendingContextPersistRef.current = null;
  }, []);

  const retryPersistenceRestore = useCallback((): void => {
    restoredContextWorkspaceIdRef.current = null;
    persistedContextPayloadRef.current = null;
    setPersistenceError(null);
  }, []);

  const surfacePersistenceWriteError = useCallback((cause: unknown): void => {
    persistedContextPayloadRef.current = null;
    pendingContextPersistRef.current = null;
    pendingPersistTimeoutIdRef.current = null;
    setPersistenceError(cause instanceof Error ? cause : new Error(errorMessage(cause)));
  }, []);

  const tryFlushPendingContextPersist = useCallback((): boolean => {
    try {
      flushPendingContextPersist();
      return true;
    } catch (cause) {
      surfacePersistenceWriteError(cause);
      return false;
    }
  }, [flushPendingContextPersist, surfacePersistenceWriteError]);

  useEffect(() => {
    if (lastWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    const previousWorkspaceId = lastWorkspaceIdRef.current;
    lastWorkspaceIdRef.current = activeWorkspaceId;
    restoredContextWorkspaceIdRef.current = null;
    persistedContextPayloadRef.current = null;
    setBoundaryWorkspaceId(previousWorkspaceId && activeWorkspaceId ? activeWorkspaceId : null);

    if (persistenceError) {
      setPersistenceError(null);
    }
  }, [activeWorkspaceId, persistenceError]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      if (!tryFlushPendingContextPersist()) {
        return;
      }
      setBoundaryWorkspaceId(null);
      restoredContextWorkspaceIdRef.current = null;
      persistedContextPayloadRef.current = null;
      setPersistenceError(null);
    }
  }, [activeWorkspaceId, tryFlushPendingContextPersist]);

  useEffect(() => {
    if (!activeWorkspace || repoNavigationBoundaryPhase !== "clearing") {
      return;
    }

    if (!hasAgentStudioNavigationSelection(navigation)) {
      setBoundaryWorkspaceId(null);
      return;
    }

    setNavigation((current) => clearAgentStudioNavigationState(current));
  }, [activeWorkspace, navigation, repoNavigationBoundaryPhase, setNavigation]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    if (persistenceError || isRepoNavigationBoundaryPending) {
      return;
    }
    if (restoredContextWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    let raw: string | null;
    let persisted: PersistedAgentStudioContext | null = null;
    try {
      raw = readPersistedContextPayload(toContextStorageKey(activeWorkspaceId));
      if (raw) {
        persisted = parsePersistedContext(raw);
      }
    } catch (cause) {
      setPersistenceError(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      return;
    }

    restoredContextWorkspaceIdRef.current = activeWorkspaceId;
    persistedContextPayloadRef.current = raw;

    if (!persisted) {
      return;
    }

    setNavigation((current) => {
      if (hasAgentStudioNavigationSelection(current)) {
        return current;
      }

      return restoreNavigationFromPersistedContext(current, persisted);
    });
  }, [activeWorkspaceId, isRepoNavigationBoundaryPending, persistenceError, setNavigation]);

  useEffect(() => {
    if (
      !activeWorkspaceId ||
      isRepoNavigationBoundaryPending ||
      persistenceError ||
      restoredContextWorkspaceIdRef.current !== activeWorkspaceId
    ) {
      return;
    }

    const serializedPayload = serializePersistedContext(navigation);
    if (serializedPayload === persistedContextPayloadRef.current) {
      return;
    }

    persistedContextPayloadRef.current = serializedPayload;
    const storageKey = toContextStorageKey(activeWorkspaceId);
    pendingContextPersistRef.current = { key: storageKey, payload: serializedPayload };

    if (pendingPersistTimeoutIdRef.current !== null) {
      globalThis.clearTimeout(pendingPersistTimeoutIdRef.current);
      pendingPersistTimeoutIdRef.current = null;
    }

    const timeoutId = globalThis.setTimeout(() => {
      const pendingPersist = pendingContextPersistRef.current;
      if (!pendingPersist || pendingPersist.key !== storageKey) {
        pendingPersistTimeoutIdRef.current = null;
        return;
      }
      try {
        writePersistedContextPayload(pendingPersist.key, pendingPersist.payload);
        pendingContextPersistRef.current = null;
        pendingPersistTimeoutIdRef.current = null;
      } catch (cause) {
        surfacePersistenceWriteError(cause);
      }
    }, 0);
    pendingPersistTimeoutIdRef.current = timeoutId;

    return () => {
      if (pendingPersistTimeoutIdRef.current === timeoutId) {
        tryFlushPendingContextPersist();
      }
    };
  }, [
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    navigation,
    persistenceError,
    surfacePersistenceWriteError,
    tryFlushPendingContextPersist,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        tryFlushPendingContextPersist();
      }
    };

    window.addEventListener("pagehide", tryFlushPendingContextPersist);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", tryFlushPendingContextPersist);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [tryFlushPendingContextPersist]);

  return {
    isRepoNavigationBoundaryPending,
    persistenceError,
    retryPersistenceRestore,
  };
}
