import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  type AgentStudioNavigationState,
  parsePersistedContext,
  restoreNavigationFromPersistedContext,
  serializePersistedContext,
  toContextStorageKey,
} from "./agent-studio-navigation";

type UseRepoNavigationPersistenceArgs = {
  activeRepo: string | null;
  navigation: AgentStudioNavigationState;
  setNavigation: Dispatch<SetStateAction<AgentStudioNavigationState>>;
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
  navigation,
  setNavigation,
}: UseRepoNavigationPersistenceArgs): void {
  const restoredContextRepoRef = useRef<string | null>(null);
  const persistedContextPayloadRef = useRef<string | null>(null);
  const pendingContextPersistRef = useRef<{ key: string; payload: string } | null>(null);
  const pendingPersistTimeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

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

  useEffect(() => {
    if (!activeRepo) {
      flushPendingContextPersist();
      restoredContextRepoRef.current = null;
      persistedContextPayloadRef.current = null;
      pendingContextPersistRef.current = null;
      if (pendingPersistTimeoutIdRef.current !== null) {
        globalThis.clearTimeout(pendingPersistTimeoutIdRef.current);
        pendingPersistTimeoutIdRef.current = null;
      }
    }
  }, [activeRepo, flushPendingContextPersist]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    if (restoredContextRepoRef.current === activeRepo) {
      return;
    }

    restoredContextRepoRef.current = activeRepo;
    setNavigation((current) => {
      if (current.taskId || current.sessionId) {
        return current;
      }

      const raw = readPersistedContextPayload(toContextStorageKey(activeRepo));
      if (!raw) {
        persistedContextPayloadRef.current = null;
        return current;
      }

      persistedContextPayloadRef.current = raw;

      const persisted = parsePersistedContext(raw);
      return restoreNavigationFromPersistedContext(current, persisted);
    });
  }, [activeRepo, setNavigation]);

  useEffect(() => {
    if (!activeRepo || restoredContextRepoRef.current !== activeRepo) {
      return;
    }

    const serializedPayload = serializePersistedContext(navigation);
    if (serializedPayload === persistedContextPayloadRef.current) {
      return;
    }

    persistedContextPayloadRef.current = serializedPayload;
    const storageKey = toContextStorageKey(activeRepo);
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
      writePersistedContextPayload(pendingPersist.key, pendingPersist.payload);
      pendingContextPersistRef.current = null;
      pendingPersistTimeoutIdRef.current = null;
    }, 0);
    pendingPersistTimeoutIdRef.current = timeoutId;

    return () => {
      if (pendingPersistTimeoutIdRef.current === timeoutId) {
        flushPendingContextPersist();
      }
    };
  }, [activeRepo, flushPendingContextPersist, navigation]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flushPendingContextPersist();
      }
    };

    window.addEventListener("pagehide", flushPendingContextPersist);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushPendingContextPersist);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingContextPersist]);
}
