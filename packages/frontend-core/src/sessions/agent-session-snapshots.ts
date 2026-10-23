import { getAgentSessionActivityStateFromSession } from "../lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "../lib/agent-session-identity";
import type { AgentSessionCollection } from "./agent-session-collection";
import { listAgentSessions } from "./agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "../types/agent-orchestrator";
import type { AgentSessionActivityState } from "../types/agent-session-activity";
import { isWorkflowAgentSession } from "./agent-orchestrator/support/workflow-session";

export type AgentSessionSummary = AgentSessionIdentity &
  Pick<WorkflowAgentSessionState, "title" | "startedAt" | "statusUnavailableReason"> & {
    taskId: WorkflowAgentSessionState["sessionAssociation"]["taskId"];
    role: WorkflowAgentSessionState["sessionAssociation"]["role"];
    activityState: AgentSessionActivityState;
    pendingApprovalCount: number;
    pendingQuestionCount: number;
    selectedModel: AgentSessionState["selectedModel"];
  };

export type AgentActivitySessionsSnapshot = {
  workspaceRepoPath: string | null;
  sessions: AgentSessionSummary[];
  repositorySessions: RepositoryAgentSessionSummary[];
  pendingInputSessions: AgentSessionPendingInputSummary[];
};

export type AgentSessionPendingInputSummary = AgentSessionIdentity &
  Pick<AgentSessionSummary, "pendingApprovalCount" | "pendingQuestionCount">;

export type RepositoryAgentSessionSummary = Omit<AgentSessionSummary, "taskId" | "role">;

export const createEmptyAgentActivitySnapshot = (
  workspaceRepoPath: string | null,
): AgentActivitySessionsSnapshot => createActivitySnapshot(workspaceRepoPath, []);

export const createAgentActivitySnapshot = ({
  collection,
  previous,
  workspaceRepoPath,
}: {
  collection: AgentSessionCollection;
  previous: AgentActivitySessionsSnapshot;
  workspaceRepoPath: string | null;
}): AgentActivitySessionsSnapshot => {
  const previousSummaryByIdentity = new Map(
    previous.sessions.map((summary) => [agentSessionIdentityKey(summary), summary]),
  );
  const sessions = listAgentSessions(collection).sort(newestFirst);
  const nextActivitySessions = sessions.flatMap((session): AgentSessionSummary[] => {
    if (!isWorkflowAgentSession(session) || session.liveParentExternalSessionId !== undefined) {
      return [];
    }
    const nextSummary = toAgentSessionSummary(session);
    const previousSummary = previousSummaryByIdentity.get(agentSessionIdentityKey(session));
    return sameTaskSummary(previousSummary, nextSummary) && previousSummary
      ? [previousSummary]
      : [nextSummary];
  });
  const activitySessions = reuseArray(previous.sessions, nextActivitySessions);
  const repositorySessions = repositoryActivitySummaries(sessions, previous.repositorySessions);
  const pendingInputSessions = pendingInputCounts(sessions, previous.pendingInputSessions);

  return previous.workspaceRepoPath === workspaceRepoPath &&
    previous.sessions === activitySessions &&
    previous.repositorySessions === repositorySessions &&
    previous.pendingInputSessions === pendingInputSessions
    ? previous
    : createActivitySnapshot(
        workspaceRepoPath,
        activitySessions,
        repositorySessions,
        pendingInputSessions,
      );
};

export function toAgentSessionSummary(session: AgentSessionState): AgentSessionSummary {
  if (!isWorkflowAgentSession(session)) {
    throw new Error(
      `Cannot create an activity session summary for ${session.sessionAssociation.kind} session '${session.externalSessionId}'.`,
    );
  }

  return {
    ...toSummary(session),
    taskId: session.sessionAssociation.taskId,
    role: session.sessionAssociation.role,
  };
}

const newestFirst = (left: AgentSessionState, right: AgentSessionState): number => {
  if (left.startedAt > right.startedAt) return -1;
  if (left.startedAt < right.startedAt) return 1;
  return 0;
};

const sameTaskSummary = (
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary,
): boolean =>
  sameSummary(left, right) && left?.taskId === right.taskId && left?.role === right.role;

const toSummary = (session: AgentSessionState): RepositoryAgentSessionSummary => {
  const summary: RepositoryAgentSessionSummary = {
    ...toAgentSessionIdentity(session),
    startedAt: session.startedAt,
    selectedModel: session.selectedModel,
    activityState: getAgentSessionActivityStateFromSession(session),
    statusUnavailableReason: session.statusUnavailableReason,
    pendingApprovalCount: session.pendingApprovals.length,
    pendingQuestionCount: session.pendingQuestions.length,
  };
  if (session.title) summary.title = session.title;
  return summary;
};

const sameSummary = (
  left: RepositoryAgentSessionSummary | undefined,
  right: RepositoryAgentSessionSummary,
): boolean =>
  left !== undefined &&
  left.title === right.title &&
  left.activityState === right.activityState &&
  left.statusUnavailableReason === right.statusUnavailableReason &&
  left.startedAt === right.startedAt &&
  left.workingDirectory === right.workingDirectory &&
  left.selectedModel === right.selectedModel &&
  left.pendingApprovalCount === right.pendingApprovalCount &&
  left.pendingQuestionCount === right.pendingQuestionCount;

const reuseArray = <T>(previous: T[], next: T[]): T[] => {
  if (previous.length !== next.length) {
    return next;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return next;
    }
  }
  return previous;
};

const createActivitySnapshot = (
  workspaceRepoPath: string | null,
  sessions: AgentSessionSummary[],
  repositorySessions: RepositoryAgentSessionSummary[] = [],
  pendingInputSessions: AgentSessionPendingInputSummary[] = [],
): AgentActivitySessionsSnapshot => ({
  workspaceRepoPath,
  sessions,
  repositorySessions,
  pendingInputSessions,
});

const pendingInputCounts = (
  sessions: AgentSessionState[],
  previous: AgentSessionPendingInputSummary[],
): AgentSessionPendingInputSummary[] => {
  const previousByIdentity = new Map(
    previous.map((summary) => [agentSessionIdentityKey(summary), summary]),
  );
  const next = sessions.flatMap((session): AgentSessionPendingInputSummary[] => {
    const pendingApprovalCount = session.pendingApprovals.length;
    const pendingQuestionCount = session.pendingQuestions.length;
    if (pendingApprovalCount + pendingQuestionCount === 0) return [];
    const prior = previousByIdentity.get(agentSessionIdentityKey(session));
    if (
      prior?.pendingApprovalCount === pendingApprovalCount &&
      prior.pendingQuestionCount === pendingQuestionCount
    )
      return [prior];
    return [{ ...toAgentSessionIdentity(session), pendingApprovalCount, pendingQuestionCount }];
  });
  return reuseArray(previous, next);
};

const repositoryActivitySummaries = (
  sessions: AgentSessionState[],
  previous: RepositoryAgentSessionSummary[],
): RepositoryAgentSessionSummary[] => {
  const previousByIdentity = new Map(
    previous.map((session) => [agentSessionIdentityKey(session), session]),
  );
  const next = sessions.flatMap((session): RepositoryAgentSessionSummary[] => {
    if (
      session.sessionAssociation.kind !== "repository" ||
      session.liveParentExternalSessionId !== undefined
    )
      return [];
    const summary = toSummary(session);
    const prior = previousByIdentity.get(agentSessionIdentityKey(session));
    if (sameSummary(prior, summary) && prior) return [prior];
    return [summary];
  });
  return reuseArray(previous, next);
};
