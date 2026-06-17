import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import { listAgentSessions } from "@/state/agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import { shouldIncludeAgentSessionInActivity } from "./operations/agent-orchestrator/support/workflow-session";

export type AgentSessionSummary = AgentSessionIdentity &
  Pick<AgentSessionState, "title" | "taskId" | "role" | "startedAt"> & {
    activityState: AgentSessionActivityState;
    pendingApprovalCount: number;
    pendingQuestionCount: number;
    selectedModel: AgentSessionState["selectedModel"];
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

export type AgentActivitySessionsSnapshot = {
  workspaceRepoPath: string | null;
  sessions: WorkflowAgentSessionSummary[];
};

export type AgentSessionSnapshots = {
  sessions: AgentSessionState[];
  sessionSummaries: WorkflowAgentSessionSummary[];
  activitySnapshot: AgentActivitySessionsSnapshot;
};

const sortByStartedAtDesc = (left: AgentSessionState, right: AgentSessionState): number =>
  left.startedAt > right.startedAt ? -1 : left.startedAt < right.startedAt ? 1 : 0;

export function toAgentSessionSummary(
  session: WorkflowAgentSessionState,
): WorkflowAgentSessionSummary;
export function toAgentSessionSummary(session: AgentSessionState): AgentSessionSummary;
export function toAgentSessionSummary(session: AgentSessionState): AgentSessionSummary {
  return {
    ...toAgentSessionIdentity(session),
    ...(session.title ? { title: session.title } : {}),
    taskId: session.taskId,
    role: session.role,
    activityState: getAgentSessionActivityStateFromSession(session),
    startedAt: session.startedAt,
    selectedModel: session.selectedModel,
    pendingApprovalCount: session.pendingApprovals.length,
    pendingQuestionCount: session.pendingQuestions.length,
  };
}

const areSummariesEquivalent = (
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary,
): boolean =>
  left !== undefined &&
  agentSessionIdentityKey(left) === agentSessionIdentityKey(right) &&
  left.title === right.title &&
  left.taskId === right.taskId &&
  left.role === right.role &&
  left.activityState === right.activityState &&
  left.startedAt === right.startedAt &&
  left.workingDirectory === right.workingDirectory &&
  left.selectedModel === right.selectedModel &&
  left.runtimeKind === right.runtimeKind &&
  left.pendingApprovalCount === right.pendingApprovalCount &&
  left.pendingQuestionCount === right.pendingQuestionCount;

const reuseArrayWhenItemsMatch = <T>(previous: T[], next: T[]): T[] => {
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
  sessions: WorkflowAgentSessionSummary[],
): AgentActivitySessionsSnapshot => ({
  workspaceRepoPath,
  sessions,
});

export const createEmptyAgentSessionSnapshots = (
  workspaceRepoPath: string | null,
): AgentSessionSnapshots => {
  const sessionSummaries: WorkflowAgentSessionSummary[] = [];
  return {
    sessions: [],
    sessionSummaries,
    activitySnapshot: createActivitySnapshot(workspaceRepoPath, sessionSummaries),
  };
};

export const createAgentSessionSnapshots = ({
  collection,
  previous,
  workspaceRepoPath,
}: {
  collection: AgentSessionCollection;
  previous: AgentSessionSnapshots;
  workspaceRepoPath: string | null;
}): AgentSessionSnapshots => {
  const previousSummaryByIdentity = new Map(
    previous.sessionSummaries.map((summary) => [agentSessionIdentityKey(summary), summary]),
  );
  const sessions = listAgentSessions(collection).sort(sortByStartedAtDesc);
  const nextSessionSummaries = sessions.flatMap((session): WorkflowAgentSessionSummary[] => {
    if (!shouldIncludeAgentSessionInActivity(session)) {
      return [];
    }
    const nextSummary = toAgentSessionSummary(session);
    const previousSummary = previousSummaryByIdentity.get(agentSessionIdentityKey(session));
    return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
      ? [previousSummary]
      : [nextSummary];
  });
  const sessionSummaries = reuseArrayWhenItemsMatch(
    previous.sessionSummaries,
    nextSessionSummaries,
  );
  const activitySnapshot =
    previous.activitySnapshot.workspaceRepoPath === workspaceRepoPath &&
    previous.activitySnapshot.sessions === sessionSummaries
      ? previous.activitySnapshot
      : createActivitySnapshot(workspaceRepoPath, sessionSummaries);

  return {
    sessions,
    sessionSummaries,
    activitySnapshot,
  };
};
