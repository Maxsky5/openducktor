import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import { shouldIncludeAgentSessionInActivity } from "./operations/agent-orchestrator/support/workflow-session";

export type AgentSessionsById = Record<string, AgentSessionState>;
export type AgentSessionSummary = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "title"
  | "taskId"
  | "role"
  | "status"
  | "startedAt"
  | "workingDirectory"
  | "pendingApprovals"
  | "pendingQuestions"
> & {
  selectedModel: AgentSessionState["selectedModel"];
  runtimeKind: AgentSessionState["runtimeKind"];
};

export type WorkflowAgentSessionSummary = AgentSessionSummary &
  Pick<WorkflowAgentSessionState, "role">;

export const isWorkflowAgentSessionSummary = (
  session: AgentSessionSummary | null | undefined,
): session is WorkflowAgentSessionSummary => {
  if (!session) {
    return false;
  }

  return session.role !== null;
};

export type AgentActivitySessionSummary = Pick<
  WorkflowAgentSessionState,
  "externalSessionId" | "taskId" | "role" | "status" | "startedAt"
> & {
  hasPendingApprovals: boolean;
  hasPendingQuestions: boolean;
};

export type AgentActivitySessionsSnapshot = {
  workspaceRepoPath: string | null;
  sessions: AgentActivitySessionSummary[];
};

type Listener = () => void;

export type AgentSessionsStore = {
  subscribe: (listener: Listener) => () => void;
  getSessionsSnapshot: () => AgentSessionState[];
  getSessionSummariesSnapshot: () => AgentSessionSummary[];
  getActivitySessionsSnapshot: () => AgentActivitySessionSummary[];
  getActivitySnapshot: () => AgentActivitySessionsSnapshot;
  getSessionsByIdSnapshot: () => AgentSessionsById;
  getSessionSnapshot: (externalSessionId: string | null) => AgentSessionState | null;
  setSessionsById: (nextSessionsById: AgentSessionsById) => void;
  resetWorkspace: (workspaceRepoPath: string | null) => void;
};

const sortByStartedAtDesc = (left: AgentSessionState, right: AgentSessionState): number =>
  left.startedAt > right.startedAt ? -1 : left.startedAt < right.startedAt ? 1 : 0;

export const toAgentSessionSummary = (session: AgentSessionState): AgentSessionSummary => ({
  externalSessionId: session.externalSessionId,
  ...(session.title ? { title: session.title } : {}),
  taskId: session.taskId,
  role: session.role,
  status: session.status,
  startedAt: session.startedAt,
  workingDirectory: session.workingDirectory,
  selectedModel: session.selectedModel,
  runtimeKind: session.runtimeKind,
  pendingApprovals: session.pendingApprovals,
  pendingQuestions: session.pendingQuestions,
});

export const toAgentActivitySessionSummary = (
  session: AgentSessionState,
): AgentActivitySessionSummary => {
  if (!shouldIncludeAgentSessionInActivity(session)) {
    throw new Error(`Session '${session.externalSessionId}' is not a workflow session`);
  }

  return {
    externalSessionId: session.externalSessionId,
    taskId: session.taskId,
    role: session.role,
    status: session.status,
    startedAt: session.startedAt,
    hasPendingApprovals: session.pendingApprovals.length > 0,
    hasPendingQuestions: session.pendingQuestions.length > 0,
  };
};

const areSummariesEquivalent = (
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary,
): boolean => {
  return (
    left?.externalSessionId === right.externalSessionId &&
    left?.title === right.title &&
    left.taskId === right.taskId &&
    left.role === right.role &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.workingDirectory === right.workingDirectory &&
    left.selectedModel === right.selectedModel &&
    left.runtimeKind === right.runtimeKind &&
    left.pendingApprovals === right.pendingApprovals &&
    left.pendingQuestions === right.pendingQuestions
  );
};

const areActivitySummariesEquivalent = (
  left: AgentActivitySessionSummary | undefined,
  right: AgentActivitySessionSummary,
): boolean => {
  return (
    left?.externalSessionId === right.externalSessionId &&
    left.taskId === right.taskId &&
    left.role === right.role &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
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

const createActivitySnapshot = (
  workspaceRepoPath: string | null,
  sessions: AgentActivitySessionSummary[],
): AgentActivitySessionsSnapshot => ({
  workspaceRepoPath,
  sessions,
});

export const createAgentSessionsStore = (
  initialWorkspaceRepoPath: string | null = null,
): AgentSessionsStore => {
  let workspaceRepoPath = initialWorkspaceRepoPath;
  let sessionsById: AgentSessionsById = {};
  let sessions: AgentSessionState[] = [];
  let sessionSummaries: AgentSessionSummary[] = [];
  let activitySessionSummaries: AgentActivitySessionSummary[] = [];
  let activitySnapshot = createActivitySnapshot(workspaceRepoPath, activitySessionSummaries);
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
    getActivitySnapshot: () => activitySnapshot,
    getSessionsByIdSnapshot: () => sessionsById,
    getSessionSnapshot: (externalSessionId) =>
      externalSessionId ? (sessionsById[externalSessionId] ?? null) : null,
    setSessionsById: (nextSessionsById) => {
      if (nextSessionsById === sessionsById) {
        return;
      }

      const previousSummaryById = new Map(
        sessionSummaries.map((summary) => [summary.externalSessionId, summary]),
      );
      const previousActivitySummaryById = new Map(
        activitySessionSummaries.map((summary) => [summary.externalSessionId, summary]),
      );
      const nextSessions = Object.values(nextSessionsById).sort(sortByStartedAtDesc);
      const nextSessionSummaries = nextSessions.flatMap((session) => {
        if (!shouldIncludeAgentSessionInActivity(session)) {
          return [];
        }
        const nextSummary = toAgentSessionSummary(session);
        const previousSummary = previousSummaryById.get(session.externalSessionId);
        return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
          ? [previousSummary]
          : [nextSummary];
      });
      const nextActivitySessionSummaries = nextSessions.flatMap((session) => {
        if (!shouldIncludeAgentSessionInActivity(session)) {
          return [];
        }
        const nextSummary = toAgentActivitySessionSummary(session);
        const previousSummary = previousActivitySummaryById.get(session.externalSessionId);
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
      if (activitySnapshot.sessions !== activitySessionSummaries) {
        activitySnapshot = createActivitySnapshot(workspaceRepoPath, activitySessionSummaries);
      }
      scheduleNotification();
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionsById = {};
      sessions = [];
      sessionSummaries = [];
      activitySessionSummaries = [];
      activitySnapshot = createActivitySnapshot(workspaceRepoPath, activitySessionSummaries);
      scheduleNotification();
    },
  };
};
