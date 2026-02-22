import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isRole, isScenario, SCENARIOS_BY_ROLE } from "./agents-page-constants";
import { toContextStorageKey } from "./agents-page-utils";

type QueryUpdate = Record<string, string | undefined>;

type PersistedAgentStudioContext = {
  taskId?: string;
  role?: AgentRole;
  scenario?: AgentScenario;
  sessionId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  const scenarioValue = readOptionalString(parsed.scenario) ?? null;
  const scenario = isScenario(scenarioValue) ? scenarioValue : undefined;
  const sessionId = readOptionalString(parsed.sessionId);

  return {
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(scenario ? { scenario } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
};

type UseAgentStudioQuerySyncArgs = {
  activeRepo: string | null;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  taskIdParam: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  selectedSessionById: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
};

export function useAgentStudioQuerySync({
  activeRepo,
  searchParams,
  setSearchParams,
  taskIdParam,
  taskId,
  role,
  scenario,
  selectedSessionById,
  activeSession,
  isLoadingTasks,
  tasks,
}: UseAgentStudioQuerySyncArgs): {
  updateQuery: (updates: QueryUpdate) => void;
} {
  const restoredContextRepoRef = useRef<string | null>(null);

  const updateQuery = useCallback(
    (updates: QueryUpdate): void => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }

      if (next.toString() === searchParams.toString()) {
        return;
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!activeRepo) {
      restoredContextRepoRef.current = null;
    }
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    if (restoredContextRepoRef.current === activeRepo) {
      return;
    }

    const hasExplicitTaskContext =
      Boolean(searchParams.get("task")) || Boolean(searchParams.get("session"));
    if (hasExplicitTaskContext) {
      restoredContextRepoRef.current = activeRepo;
      return;
    }

    restoredContextRepoRef.current = activeRepo;
    const raw = globalThis.localStorage.getItem(toContextStorageKey(activeRepo));
    if (!raw) {
      return;
    }

    const persisted = parsePersistedContext(raw);
    if (!persisted) {
      return;
    }

    const persistedRole = persisted.role ?? null;
    const persistedScenario = persisted.scenario ?? null;
    const explicitRoleParam = searchParams.get("agent");
    const explicitScenarioParam = searchParams.get("scenario");
    const roleForScenarioValidation = isRole(explicitRoleParam) ? explicitRoleParam : persistedRole;

    const next = new URLSearchParams(searchParams);
    if (persisted.taskId) {
      next.set("task", persisted.taskId);
    }
    if (persistedRole && !explicitRoleParam) {
      next.set("agent", persistedRole);
    }
    if (
      persistedScenario &&
      !explicitScenarioParam &&
      (!roleForScenarioValidation ||
        SCENARIOS_BY_ROLE[roleForScenarioValidation].includes(persistedScenario))
    ) {
      next.set("scenario", persistedScenario);
    }
    if (persisted.sessionId) {
      next.set("session", persisted.sessionId);
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeRepo, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeRepo || restoredContextRepoRef.current !== activeRepo) {
      return;
    }
    const payload = {
      taskId: taskId || undefined,
      role,
      scenario,
      sessionId: activeSession?.sessionId,
    };
    globalThis.localStorage.setItem(toContextStorageKey(activeRepo), JSON.stringify(payload));
  }, [activeRepo, activeSession?.sessionId, role, scenario, taskId]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    if (!taskIdParam || selectedSessionById) {
      return;
    }
    if (tasks.some((entry) => entry.id === taskIdParam)) {
      return;
    }
    updateQuery({
      task: undefined,
      session: undefined,
      agent: undefined,
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
  }, [isLoadingTasks, selectedSessionById, taskIdParam, tasks, updateQuery]);

  useEffect(() => {
    if (!selectedSessionById) {
      return;
    }
    if (selectedSessionById.taskId === taskIdParam) {
      return;
    }
    updateQuery({ task: selectedSessionById.taskId });
  }, [selectedSessionById, taskIdParam, updateQuery]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const updates: QueryUpdate = {};
    if (searchParams.get("task") !== activeSession.taskId) {
      updates.task = activeSession.taskId;
    }
    if (searchParams.get("session") !== activeSession.sessionId) {
      updates.session = activeSession.sessionId;
    }
    if (searchParams.get("autostart")) {
      updates.autostart = undefined;
    }
    if (searchParams.get("start")) {
      updates.start = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }
    updateQuery(updates);
  }, [activeSession, searchParams, updateQuery]);

  return {
    updateQuery,
  };
}
