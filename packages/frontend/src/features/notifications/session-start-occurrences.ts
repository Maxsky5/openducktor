import type { NotificationOccurrence, NotificationSessionIdentity } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { SessionStartNotificationInput } from "@/features/session-start/session-start-orchestration";

type SessionStartWorkspace = {
  repoPath: string;
  repositoryLabel: string;
};

const roleLabel = (role: SessionStartNotificationInput["role"]): string => {
  if (role === "spec") return "Spec Agent Session";
  if (role === "planner") return "Planner Agent Session";
  if (role === "build") return "Builder Agent Session";
  return "QA Agent Session";
};

const toSession = (
  session: NonNullable<SessionStartNotificationInput["session"]>,
): NotificationSessionIdentity => ({
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  externalSessionId: session.externalSessionId,
});

const task = (
  input: SessionStartNotificationInput,
): NonNullable<NotificationOccurrence["task"]> => {
  const result: NonNullable<NotificationOccurrence["task"]> = { id: input.taskId };
  if (input.taskTitle) result.title = input.taskTitle;
  return result;
};

export const buildSessionStartedOccurrence = (
  workspace: SessionStartWorkspace,
  input: SessionStartNotificationInput & {
    session: NonNullable<SessionStartNotificationInput["session"]>;
  },
): NotificationOccurrence => ({
  occurrenceId: `agent.session_started:${workspace.repoPath}:${agentSessionIdentityKey(input.session)}:${input.launchAttemptId}`,
  kind: "agent.session_started",
  repoPath: workspace.repoPath,
  repositoryLabel: workspace.repositoryLabel,
  task: task(input),
  role: input.role,
  sessionLabel: roleLabel(input.role),
  status: "Agent Session started.",
  navigationTarget: {
    type: "agent_session",
    repoPath: workspace.repoPath,
    taskId: input.taskId,
    session: toSession(input.session),
  },
});

export const buildSessionStartErrorOccurrence = (
  workspace: SessionStartWorkspace,
  input: SessionStartNotificationInput,
): NotificationOccurrence => {
  const sessionSuffix = input.session ? `:${agentSessionIdentityKey(input.session)}` : "";
  const occurrence: NotificationOccurrence = {
    occurrenceId: `agent.session_error:${workspace.repoPath}:${input.taskId}:${input.launchAttemptId}${sessionSuffix}`,
    kind: "agent.session_error",
    repoPath: workspace.repoPath,
    repositoryLabel: workspace.repositoryLabel,
    task: task(input),
    role: input.role,
    status: "Agent Session failed to start or send its first message.",
    navigationTarget: input.session
      ? {
          type: "session_error",
          repoPath: workspace.repoPath,
          taskId: input.taskId,
          session: toSession(input.session),
          errorId: input.launchAttemptId,
        }
      : {
          type: "agent_studio_task",
          repoPath: workspace.repoPath,
          taskId: input.taskId,
          preferredRole: input.role,
        },
  };
  if (input.session) occurrence.sessionLabel = roleLabel(input.role);
  return occurrence;
};
