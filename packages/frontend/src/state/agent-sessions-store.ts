import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  emptyAgentSessionCollection,
  getAgentSession,
  hasAgentSessionStateChanges,
  listAgentSessions,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";
import { shouldIncludeAgentSessionInActivity } from "./operations/agent-orchestrator/support/workflow-session";

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
  | "externalSessionId"
  | "runtimeKind"
  | "workingDirectory"
  | "taskId"
  | "role"
  | "status"
  | "startedAt"
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
  getSessionCollectionSnapshot: () => AgentSessionCollection;
  getSessionSnapshot: (identity: AgentSessionIdentity | null) => AgentSessionState | null;
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  updateSession: (
    identity: AgentSessionIdentity,
    updater: (current: AgentSessionState) => AgentSessionState,
  ) => AgentSessionState | null;
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
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
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
    left !== undefined &&
    agentSessionIdentityKey(left) === agentSessionIdentityKey(right) &&
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
    left !== undefined &&
    agentSessionIdentityKey(left) === agentSessionIdentityKey(right) &&
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
  let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
  let sessions: AgentSessionState[] = [];
  let sessionSummaries: AgentSessionSummary[] = [];
  let activitySessionSummaries: AgentActivitySessionSummary[] = [];
  let activitySnapshot = createActivitySnapshot(workspaceRepoPath, activitySessionSummaries);
  const listeners = new Set<Listener>();

  const notifyListeners = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setSessionCollection = (updater: AgentSessionCollectionUpdater): void => {
    const nextCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
    if (nextCollection === sessionCollection) {
      return;
    }

    const previousSummaryByIdentity = new Map(
      sessionSummaries.map((summary) => [agentSessionIdentityKey(summary), summary]),
    );
    const previousActivitySummaryByIdentity = new Map(
      activitySessionSummaries.map((summary) => [agentSessionIdentityKey(summary), summary]),
    );
    const nextSessions = listAgentSessions(nextCollection).sort(sortByStartedAtDesc);
    const nextSessionSummaries = nextSessions.flatMap((session) => {
      if (!shouldIncludeAgentSessionInActivity(session)) {
        return [];
      }
      const nextSummary = toAgentSessionSummary(session);
      const previousSummary = previousSummaryByIdentity.get(agentSessionIdentityKey(session));
      return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
        ? [previousSummary]
        : [nextSummary];
    });
    const nextActivitySessionSummaries = nextSessions.flatMap((session) => {
      if (!shouldIncludeAgentSessionInActivity(session)) {
        return [];
      }
      const nextSummary = toAgentActivitySessionSummary(session);
      const previousSummary = previousActivitySummaryByIdentity.get(
        agentSessionIdentityKey(session),
      );
      return areActivitySummariesEquivalent(previousSummary, nextSummary) && previousSummary
        ? [previousSummary]
        : [nextSummary];
    });

    sessionCollection = nextCollection;
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
    notifyListeners();
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
    getSessionCollectionSnapshot: () => sessionCollection,
    getSessionSnapshot: (identity) => getAgentSession(sessionCollection, identity),
    setSessionCollection,
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionCollection, identity);
      if (!current) {
        return null;
      }

      const nextSession = updater(current);
      if (nextSession === current || !hasAgentSessionStateChanges(current, nextSession)) {
        return null;
      }

      setSessionCollection(replaceAgentSessionByIdentity(sessionCollection, identity, nextSession));
      return nextSession;
    },
    resetWorkspace: (nextWorkspaceRepoPath) => {
      workspaceRepoPath = nextWorkspaceRepoPath;
      sessionCollection = emptyAgentSessionCollection();
      sessions = [];
      sessionSummaries = [];
      activitySessionSummaries = [];
      activitySnapshot = createActivitySnapshot(workspaceRepoPath, activitySessionSummaries);
      notifyListeners();
    },
  };
};
