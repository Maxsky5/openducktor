import type { AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { isRecord } from "@/lib/guards";
import { isRole } from "./agents-page-constants";
import { toContextStorageKey } from "./agents-page-utils";

type QueryUpdate = Record<string, string | undefined>;

type PersistedAgentStudioContext = {
  taskId?: string;
  role?: AgentRole;
  sessionId?: string;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

type AgentStudioNavigationState = {
  taskId: string;
  sessionId: string | null;
  role: AgentRole | null;
};

const parseNavigationStateFromSearchParams = (
  searchParams: URLSearchParams,
): AgentStudioNavigationState => {
  const roleValue = readOptionalString(searchParams.get("agent")) ?? null;

  return {
    taskId: readOptionalString(searchParams.get("task")) ?? "",
    sessionId: readOptionalString(searchParams.get("session")) ?? null,
    role: isRole(roleValue) ? roleValue : null,
  };
};

const buildSearchParamsFromNavigationState = (
  searchParams: URLSearchParams,
  navigation: AgentStudioNavigationState,
): URLSearchParams => {
  const next = new URLSearchParams(searchParams);
  const managedKeys = ["task", "session", "agent", "autostart", "start"];
  for (const key of managedKeys) {
    next.delete(key);
  }

  if (navigation.taskId) {
    next.set("task", navigation.taskId);
  }
  if (navigation.sessionId) {
    next.set("session", navigation.sessionId);
  }
  if (navigation.role) {
    next.set("agent", navigation.role);
  }

  return next;
};

const toNavigationStateFromQueryUpdates = (
  current: AgentStudioNavigationState,
  updates: QueryUpdate,
): AgentStudioNavigationState => {
  let next = current;

  for (const [key, value] of Object.entries(updates)) {
    if (key === "task") {
      const taskId = readOptionalString(value) ?? "";
      if (taskId !== next.taskId) {
        next = { ...next, taskId };
      }
      continue;
    }

    if (key === "session") {
      const sessionId = readOptionalString(value) ?? null;
      if (sessionId !== next.sessionId) {
        next = { ...next, sessionId };
      }
      continue;
    }

    if (key === "agent") {
      const roleValue = readOptionalString(value) ?? null;
      const role = isRole(roleValue) ? roleValue : null;
      if (role !== next.role) {
        next = { ...next, role };
      }
    }
  }

  return next;
};

const isSameNavigationState = (
  left: AgentStudioNavigationState,
  right: AgentStudioNavigationState,
): boolean => {
  return (
    left.taskId === right.taskId && left.sessionId === right.sessionId && left.role === right.role
  );
};

const parsePersistedContext = (raw: string): PersistedAgentStudioContext | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const taskId = readOptionalString(parsed.taskId);
  const roleValue = readOptionalString(parsed.role) ?? null;
  const role = isRole(roleValue) ? roleValue : undefined;
  const sessionId = readOptionalString(parsed.sessionId);

  return {
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
};

type UseAgentStudioQuerySyncArgs = {
  activeRepo: string | null;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

export function useAgentStudioQuerySync({
  activeRepo,
  searchParams,
  setSearchParams,
}: UseAgentStudioQuerySyncArgs): {
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  updateQuery: (updates: QueryUpdate) => void;
} {
  const restoredContextRepoRef = useRef<string | null>(null);
  const persistedContextPayloadRef = useRef<string | null>(null);
  const pendingContextPersistRef = useRef<{ key: string; payload: string } | null>(null);
  const pendingPersistTimeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const syncingFromSearchParamsRef = useRef(false);
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(() =>
    parseNavigationStateFromSearchParams(searchParams),
  );

  const updateQuery = useCallback((updates: QueryUpdate): void => {
    setNavigation((current) => toNavigationStateFromQueryUpdates(current, updates));
  }, []);

  const flushPendingContextPersist = useCallback((): void => {
    const pendingPersist = pendingContextPersistRef.current;
    if (!pendingPersist) {
      return;
    }

    if (pendingPersistTimeoutIdRef.current !== null) {
      globalThis.clearTimeout(pendingPersistTimeoutIdRef.current);
      pendingPersistTimeoutIdRef.current = null;
    }

    globalThis.localStorage.setItem(pendingPersist.key, pendingPersist.payload);
    pendingContextPersistRef.current = null;
  }, []);

  useEffect(() => {
    const parsed = parseNavigationStateFromSearchParams(searchParams);
    setNavigation((current) => {
      if (isSameNavigationState(current, parsed)) {
        return current;
      }
      syncingFromSearchParamsRef.current = true;
      return parsed;
    });
  }, [searchParams]);

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

      const raw = globalThis.localStorage.getItem(toContextStorageKey(activeRepo));
      if (!raw) {
        persistedContextPayloadRef.current = null;
        return current;
      }

      persistedContextPayloadRef.current = raw;

      const persisted = parsePersistedContext(raw);
      if (!persisted) {
        return current;
      }

      const role = current.role ?? persisted.role ?? null;

      return {
        ...current,
        taskId: current.taskId || persisted.taskId || "",
        sessionId: current.sessionId ?? persisted.sessionId ?? null,
        role,
      };
    });
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo || restoredContextRepoRef.current !== activeRepo) {
      return;
    }
    const roleForContext = navigation.role ?? "spec";
    const payload = {
      taskId: navigation.taskId || undefined,
      role: roleForContext,
      sessionId: navigation.sessionId || undefined,
    };
    const serializedPayload = JSON.stringify(payload);
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
      globalThis.localStorage.setItem(pendingPersist.key, pendingPersist.payload);
      pendingContextPersistRef.current = null;
      pendingPersistTimeoutIdRef.current = null;
    }, 0);
    pendingPersistTimeoutIdRef.current = timeoutId;

    return () => {
      if (pendingPersistTimeoutIdRef.current === timeoutId) {
        flushPendingContextPersist();
      }
    };
  }, [
    activeRepo,
    flushPendingContextPersist,
    navigation.role,
    navigation.sessionId,
    navigation.taskId,
  ]);

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

  useEffect(() => {
    if (syncingFromSearchParamsRef.current) {
      syncingFromSearchParamsRef.current = false;
      return;
    }
    const next = buildSearchParamsFromNavigationState(searchParams, navigation);
    if (next.toString() === searchParams.toString()) {
      return;
    }
    setSearchParams(next, { replace: true });
  }, [navigation, searchParams, setSearchParams]);

  const hasExplicitRoleParam = navigation.role !== null;
  const roleFromQuery: AgentRole = navigation.role ?? "spec";

  return {
    taskIdParam: navigation.taskId,
    sessionParam: navigation.sessionId,
    hasExplicitRoleParam,
    roleFromQuery,
    updateQuery,
  };
}
