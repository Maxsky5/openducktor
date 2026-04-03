import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentSessionsById = Record<string, AgentSessionState>;
export type AgentSessionSummary = Pick<
  AgentSessionState,
  | "sessionId"
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

type Listener = () => void;

export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getSessionsSnapshot: () => AgentSessionState[];
  getSessionSummariesSnapshot: () => AgentSessionSummary[];
  getSessionsByIdSnapshot: () => AgentSessionsById;
  getSessionSnapshot: (sessionId: string | null) => AgentSessionState | null;
  setSessionsById: (nextSessionsById: AgentSessionsById) => void;
};

const sortByStartedAtDesc = (left: AgentSessionState, right: AgentSessionState): number =>
  left.startedAt > right.startedAt ? -1 : left.startedAt < right.startedAt ? 1 : 0;

export const toAgentSessionSummary = (session: AgentSessionState): AgentSessionSummary => ({
  sessionId: session.sessionId,
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

const areSummariesEquivalent = (
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary,
): boolean => {
  return (
    left?.sessionId === right.sessionId &&
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
    getSessionsByIdSnapshot: () => sessionsById,
    getSessionSnapshot: (sessionId) => (sessionId ? (sessionsById[sessionId] ?? null) : null),
    setSessionsById: (nextSessionsById) => {
      if (nextSessionsById === sessionsById) {
        return;
      }

      const previousSummaryById = new Map(
        sessionSummaries.map((summary) => [summary.sessionId, summary]),
      );
      const nextSessions = Object.values(nextSessionsById).sort(sortByStartedAtDesc);
      const nextSessionSummaries = nextSessions.map((session) => {
        const nextSummary = toAgentSessionSummary(session);
        const previousSummary = previousSummaryById.get(session.sessionId);
        return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
          ? previousSummary
          : nextSummary;
      });

      sessionsById = nextSessionsById;
      sessions = nextSessions;
      sessionSummaries = areArraysReferenceEqual(sessionSummaries, nextSessionSummaries)
        ? sessionSummaries
        : nextSessionSummaries;
      scheduleNotification();
    },
  };
};
