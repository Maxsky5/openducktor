import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { SCENARIOS_BY_ROLE, isRole, isScenario } from "./agents-page-constants";
import { toContextStorageKey } from "./agents-page-utils";

type QueryUpdate = Record<string, string | undefined>;

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

    try {
      const parsed = JSON.parse(raw) as {
        taskId?: string;
        role?: string;
        scenario?: string;
        sessionId?: string;
      };
      const persistedRole = isRole(parsed.role ?? null) ? (parsed.role as AgentRole) : null;
      const persistedScenario = isScenario(parsed.scenario ?? null)
        ? (parsed.scenario as AgentScenario)
        : null;
      const explicitRoleParam = searchParams.get("agent");
      const explicitScenarioParam = searchParams.get("scenario");
      const roleForScenarioValidation = isRole(explicitRoleParam)
        ? explicitRoleParam
        : persistedRole;

      const next = new URLSearchParams(searchParams);
      if (parsed.taskId && parsed.taskId.trim().length > 0) {
        next.set("task", parsed.taskId);
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
      if (parsed.sessionId && parsed.sessionId.trim().length > 0) {
        next.set("session", parsed.sessionId);
      }

      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    } catch (_error) {
      return;
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

    if (Object.keys(updates).length === 0) {
      return;
    }
    updateQuery(updates);
  }, [activeSession, searchParams, updateQuery]);

  return {
    updateQuery,
  };
}
