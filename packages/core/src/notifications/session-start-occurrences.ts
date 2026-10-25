import type {
  NotificationActionOccurrence,
  NotificationSessionIdentity,
} from "@openducktor/contracts";
import { trimTrailingPathSeparators } from "@openducktor/path-support";
import { normalizeSessionErrorMessage } from "./session-error-message";

/** The workspace fields that a session start notification shows. */
export type SessionStartOccurrenceWorkspace = {
  repoPath: string;
  repositoryLabel: string;
};

/** One launch attempt. Manual starts and Autopilot build the same notifications from it. */
export type SessionStartOccurrenceInput = {
  launchAttemptId: string;
  taskId: string;
  taskTitle?: string;
  role: string;
  roleLabel: string;
  session?: NotificationSessionIdentity;
  errorAttentionId?: string;
};

const sessionKey = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: NotificationSessionIdentity): string =>
  [externalSessionId, runtimeKind, trimTrailingPathSeparators(workingDirectory.trim())]
    .map(encodeURIComponent)
    .join("|");

const toSession = (session: NotificationSessionIdentity): NotificationSessionIdentity => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
});

const task = (
  input: SessionStartOccurrenceInput,
): NonNullable<NotificationActionOccurrence["task"]> => {
  const result: NonNullable<NotificationActionOccurrence["task"]> = { id: input.taskId };
  if (input.taskTitle) result.title = input.taskTitle;
  return result;
};

export const buildSessionStartedOccurrence = (
  workspace: SessionStartOccurrenceWorkspace,
  input: SessionStartOccurrenceInput & { session: NotificationSessionIdentity },
): NotificationActionOccurrence => ({
  occurrenceId: `agent.session_started:${workspace.repoPath}:${sessionKey(input.session)}:${input.launchAttemptId}`,
  kind: "agent.session_started",
  repoPath: workspace.repoPath,
  repositoryLabel: workspace.repositoryLabel,
  task: task(input),
  role: input.role,
  sessionLabel: `${input.roleLabel} Agent Session`,
  status: "Agent Session started.",
  navigationTarget: {
    type: "agent_session",
    repoPath: workspace.repoPath,
    taskId: input.taskId,
    session: toSession(input.session),
  },
});

const errorNavigationTarget = (
  { repoPath }: SessionStartOccurrenceWorkspace,
  { taskId, role, session, errorAttentionId }: SessionStartOccurrenceInput,
): NotificationActionOccurrence["navigationTarget"] => {
  if (!session) return { type: "agent_studio_task", repoPath, taskId, preferredRole: role };
  if (!errorAttentionId)
    return { type: "agent_session", repoPath, taskId, session: toSession(session) };
  return {
    type: "session_error",
    repoPath,
    taskId,
    session: toSession(session),
    errorId: errorAttentionId,
  };
};

export const buildSessionStartErrorOccurrence = (
  workspace: SessionStartOccurrenceWorkspace,
  input: SessionStartOccurrenceInput,
  message?: string,
): NotificationActionOccurrence => {
  const sessionSuffix = input.session ? `:${sessionKey(input.session)}` : "";
  const occurrence: NotificationActionOccurrence = {
    occurrenceId: `agent.session_error:${workspace.repoPath}:${input.taskId}:${input.launchAttemptId}${sessionSuffix}`,
    kind: "agent.session_error",
    repoPath: workspace.repoPath,
    repositoryLabel: workspace.repositoryLabel,
    task: task(input),
    role: input.role,
    status:
      normalizeSessionErrorMessage(message ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 240) || "The session failed. Open it for details.",
    navigationTarget: errorNavigationTarget(workspace, input),
  };
  if (input.session) occurrence.sessionLabel = `${input.roleLabel} Agent Session`;
  return occurrence;
};
