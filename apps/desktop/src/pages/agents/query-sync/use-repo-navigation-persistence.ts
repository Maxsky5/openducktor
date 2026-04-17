import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
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
  activeRepo: string | null;
  persistenceWorkspaceId: string | null;
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
  activeRepo,
  lastActiveRepo,
  boundaryRepo,
}: {
  activeRepo: string | null;
  lastActiveRepo: string | null;
  boundaryRepo: string | null;
}): RepoNavigationBoundaryPhase => {
  if (!activeRepo) {
    return "idle";
  }

  if (Boolean(lastActiveRepo) && lastActiveRepo !== activeRepo) {
    return "detecting";
  }

  if (boundaryRepo === activeRepo) {
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
  activeRepo,
  persistenceWorkspaceId,
  navigation,
  setNavigation,
}: UseRepoNavigationPersistenceArgs): UseRepoNavigationPersistenceResult {
  const lastActiveRepoRef = useRef<string | null>(activeRepo);
  const restoredContextRepoRef = useRef<string | null>(null);
  const persistedContextPayloadRef = useRef<string | null>(null);
  const pendingContextPersistRef = useRef<{ key: string; payload: string } | null>(null);
  const pendingPersistTimeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [boundaryRepo, setBoundaryRepo] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);
  const repoNavigationBoundaryPhase = resolveRepoNavigationBoundaryPhase({
    activeRepo,
    lastActiveRepo: lastActiveRepoRef.current,
    boundaryRepo,
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
    restoredContextRepoRef.current = null;
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
    if (lastActiveRepoRef.current === activeRepo) {
      return;
    }

    const previousRepo = lastActiveRepoRef.current;
    lastActiveRepoRef.current = activeRepo;
    restoredContextRepoRef.current = null;
    persistedContextPayloadRef.current = null;
    setBoundaryRepo(previousRepo && activeRepo ? activeRepo : null);

    if (persistenceError) {
      setPersistenceError(null);
    }
  }, [activeRepo, persistenceError]);

  useEffect(() => {
    if (!activeRepo) {
      if (!tryFlushPendingContextPersist()) {
        return;
      }
      setBoundaryRepo(null);
      restoredContextRepoRef.current = null;
      persistedContextPayloadRef.current = null;
      setPersistenceError(null);
    }
  }, [activeRepo, tryFlushPendingContextPersist]);

  useEffect(() => {
    if (!activeRepo || repoNavigationBoundaryPhase !== "clearing") {
      return;
    }

    if (!hasAgentStudioNavigationSelection(navigation)) {
      setBoundaryRepo(null);
      return;
    }

    setNavigation((current) => clearAgentStudioNavigationState(current));
  }, [activeRepo, navigation, repoNavigationBoundaryPhase, setNavigation]);

  useEffect(() => {
    if (!activeRepo || !persistenceWorkspaceId) {
      return;
    }
    if (persistenceError) {
      return;
    }
    if (isRepoNavigationBoundaryPending) {
      return;
    }
    if (restoredContextRepoRef.current === activeRepo) {
      return;
    }

    let raw: string | null;
    let persisted: PersistedAgentStudioContext | null = null;
    try {
      raw = readPersistedContextPayload(toContextStorageKey(persistenceWorkspaceId));
      if (raw) {
        persisted = parsePersistedContext(raw);
      }
    } catch (cause) {
      setPersistenceError(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      return;
    }

    restoredContextRepoRef.current = activeRepo;
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
  }, [
    activeRepo,
    persistenceWorkspaceId,
    isRepoNavigationBoundaryPending,
    persistenceError,
    setNavigation,
  ]);

  useEffect(() => {
    if (
      !activeRepo ||
      !persistenceWorkspaceId ||
      isRepoNavigationBoundaryPending ||
      persistenceError ||
      restoredContextRepoRef.current !== activeRepo
    ) {
      return;
    }

    const serializedPayload = serializePersistedContext(navigation);
    if (serializedPayload === persistedContextPayloadRef.current) {
      return;
    }

    persistedContextPayloadRef.current = serializedPayload;
    const storageKey = toContextStorageKey(persistenceWorkspaceId);
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
    activeRepo,
    persistenceWorkspaceId,
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
