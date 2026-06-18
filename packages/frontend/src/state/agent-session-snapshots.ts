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
  Pick<WorkflowAgentSessionState, "title" | "taskId" | "role" | "startedAt"> & {
    activityState: AgentSessionActivityState;
    pendingApprovalCount: number;
    pendingQuestionCount: number;
    selectedModel: AgentSessionState["selectedModel"];
  };

export type AgentActivitySessionsSnapshot = {
  workspaceRepoPath: string | null;
  sessions: AgentSessionSummary[];
};

const sortByStartedAtDesc = (left: AgentSessionState, right: AgentSessionState): number =>
  left.startedAt > right.startedAt ? -1 : left.startedAt < right.startedAt ? 1 : 0;

export function toAgentSessionSummary(session: WorkflowAgentSessionState): AgentSessionSummary;
export function toAgentSessionSummary(session: AgentSessionState): AgentSessionSummary;
export function toAgentSessionSummary(session: AgentSessionState): AgentSessionSummary {
  if (session.role === null) {
    throw new Error("Cannot create an activity session summary for a role-less session.");
  }

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
  sessions: AgentSessionSummary[],
): AgentActivitySessionsSnapshot => ({
  workspaceRepoPath,
  sessions,
});

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
  const sessions = listAgentSessions(collection).sort(sortByStartedAtDesc);
  const nextActivitySessions = sessions.flatMap((session): AgentSessionSummary[] => {
    if (!shouldIncludeAgentSessionInActivity(session)) {
      return [];
    }
    const nextSummary = toAgentSessionSummary(session);
    const previousSummary = previousSummaryByIdentity.get(agentSessionIdentityKey(session));
    return areSummariesEquivalent(previousSummary, nextSummary) && previousSummary
      ? [previousSummary]
      : [nextSummary];
  });
  const activitySessions = reuseArrayWhenItemsMatch(previous.sessions, nextActivitySessions);

  return previous.workspaceRepoPath === workspaceRepoPath && previous.sessions === activitySessions
    ? previous
    : createActivitySnapshot(workspaceRepoPath, activitySessions);
};
