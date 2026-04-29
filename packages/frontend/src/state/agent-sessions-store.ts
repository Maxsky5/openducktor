import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import { shouldIncludeAgentSessionInActivity } from "./operations/agent-orchestrator/support/session-purpose";

export type AgentSessionsById = Record<string, AgentSessionState>;
export type AgentSessionSummary = Pick<
  AgentSessionState,
  | "sessionId"
  | "externalSessionId"
  | "taskId"
  | "role"
  | "scenario"
  | "status"
  | "startedAt"
  | "workingDirectory"
  | "pendingPermissions"
  | "pendingQuestions"
> & {
  selectedModel: AgentSessionState["selectedModel"];
  runtimeKind?: AgentSessionState["runtimeKind"];
};

export type WorkflowAgentSessionSummary = AgentSessionSummary &
  Pick<WorkflowAgentSessionState, "role" | "scenario">;

export const isWorkflowAgentSessionSummary = (
  session: AgentSessionSummary | null | undefined,
): session is WorkflowAgentSessionSummary => {
  if (!session) {
    return false;
  }

  return session.role !== null && session.scenario !== null;
};

export type AgentActivitySessionSummary = Pick<
  WorkflowAgentSessionState,
  "sessionId" | "taskId" | "role" | "scenario" | "status" | "startedAt"
> & {
  repoPath: string;
  hasPendingPermissions: boolean;
  hasPendingQuestions: boolean;
};

type Listener = () => void;

export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getSessionsSnapshot: () => AgentSessionState[];
  getSessionSummariesSnapshot: () => AgentSessionSummary[];
  getActivitySessionsSnapshot: () => AgentActivitySessionSummary[];
  getSessionsByIdSnapshot: () => AgentSessionsById;
  getSessionSnapshot: (sessionId: string | null) => AgentSessionState | null;
  setSessionsById: (nextSessionsById: AgentSessionsById) => void;
};

const sortByStartedAtDesc = (left: AgentSessionState, right: AgentSessionState): number =>
  left.startedAt > right.startedAt ? -1 : left.startedAt < right.startedAt ? 1 : 0;

export const toAgentSessionSummary = (session: AgentSessionState): AgentSessionSummary => ({
  sessionId: session.sessionId,
  externalSessionId: session.externalSessionId,
  taskId: session.taskId,
  role: session.role,
  scenario: session.scenario,
  status: session.status,
  startedAt: session.startedAt,
  workingDirectory: session.workingDirectory,
  selectedModel: session.selectedModel,
  runtimeKind: session.runtimeKind,
  pendingPermissions: session.pendingPermissions,
  pendingQuestions: session.pendingQuestions,
});

export const toAgentActivitySessionSummary = (
  session: AgentSessionState,
): AgentActivitySessionSummary => {
  if (!shouldIncludeAgentSessionInActivity(session)) {
    throw new Error(`Session '${session.sessionId}' is not a workflow session`);
  }

  return {
    sessionId: session.sessionId,
    taskId: session.taskId,
    repoPath: session.repoPath,
    role: session.role,
    scenario: session.scenario,
    status: session.status,
    startedAt: session.startedAt,
    hasPendingPermissions: session.pendingPermissions.length > 0,
    hasPendingQuestions: session.pendingQuestions.length > 0,
  };
};

const areSummariesEquivalent = (
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary,
): boolean => {
  return (
    left?.sessionId === right.sessionId &&
    left.externalSessionId === right.externalSessionId &&
    left.taskId === right.taskId &&
    left.role === right.role &&
    left.scenario === right.scenario &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.workingDirectory === right.workingDirectory &&
    left.selectedModel === right.selectedModel &&
    left.runtimeKind === right.runtimeKind &&
    left.pendingPermissions === right.pendingPermissions &&
    left.pendingQuestions === right.pendingQuestions
  );
};

const areActivitySummariesEquivalent = (
  left: AgentActivitySessionSummary | undefined,
  right: AgentActivitySessionSummary,
): boolean => {
  return (
    left?.sessionId === right.sessionId &&
    left.taskId === right.taskId &&
    left.repoPath === right.repoPath &&
    left.role === right.role &&
    left.scenario === right.scenario &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.hasPendingPermissions === right.hasPendingPermissions &&
    left.hasPendingQuestions === right.hasPendingQuestions
  );
};

const areArraysReferenceEqual = <T>(left: T[], right: T[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

export const createAgentSessionsStore = (): AgentSessionsStore => {
  let sessionsById: AgentSessionsById = {};
  let sessions: AgentSessionState[] = [];
  let sessionSummaries: AgentSessionSummary[] = [];
  let activitySessionSummaries: AgentActivitySessionSummary[] = [];
  let hasPendingNotification = false;
  let framePending = false;
  const listeners = new Set<Listener>();

  const notifyListeners = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const flushNotifications = (): void => {
    framePending = false;
    if (!hasPendingNotification) {
      return;
    }

    hasPendingNotification = false;
    notifyListeners();
  };

  const scheduleNotification = (): void => {
    if (process.env.NODE_ENV === "test" || typeof requestAnimationFrame !== "function") {
      notifyListeners();
      return;
    }

    hasPendingNotification = true;
    if (framePending) {
      return;
    }

    framePending = true;
    requestAnimationFrame(flushNotifications);
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSessionsSnapshot: () => sessions,
    getSessionSummariesSnapshot: () => sessionSummaries,
    getActivitySessionsSnapshot: () => activitySessionSummaries,
    getSessionsByIdSnapshot: () => sessionsById,
    getSessionSnapshot: (sessionId) => (sessionId ? (sessionsById[sessionId] ?? null) : null),
    setSessionsById: (nextSessionsById) => {
      if (nextSessionsById === sessionsById) {
        return;
      }

      const previousSummaryById = new Map(
        sessionSummaries.map((summary) => [summary.sessionId, summary]),
      );
      const previousActivitySummaryById = new Map(
        activitySessionSummaries.map((summary) => [summary.sessionId, summary]),
      );
      const nextSessions = Object.values(nextSessionsById).sort(sortByStartedAtDesc);
      const nextSessionSummaries = nextSessions.flatMap((session) => {
        if (!shouldIncludeAgentSessionInActivity(session)) {
          return [];
        }
        const nextSummary = toAgentSessionSummary(session);
        const previousSummary = previousSummaryById.get(session.sessionId);
        return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
          ? [previousSummary]
          : [nextSummary];
      });
      const nextActivitySessionSummaries = nextSessions.flatMap((session) => {
        if (!shouldIncludeAgentSessionInActivity(session)) {
          return [];
        }
        const nextSummary = toAgentActivitySessionSummary(session);
        const previousSummary = previousActivitySummaryById.get(session.sessionId);
        return areActivitySummariesEquivalent(previousSummary, nextSummary) && previousSummary
          ? [previousSummary]
          : [nextSummary];
      });

      sessionsById = nextSessionsById;
      sessions = nextSessions;
      sessionSummaries = areArraysReferenceEqual(sessionSummaries, nextSessionSummaries)
        ? sessionSummaries
        : nextSessionSummaries;
      activitySessionSummaries = areArraysReferenceEqual(
        activitySessionSummaries,
        nextActivitySessionSummaries,
      )
        ? activitySessionSummaries
        : nextActivitySessionSummaries;
      scheduleNotification();
    },
  };
};
