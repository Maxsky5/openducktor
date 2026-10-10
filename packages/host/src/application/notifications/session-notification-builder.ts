import type {
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveSnapshot,
  AgentSessionScope,
  NotificationNavigationTarget,
  NotificationOccurrence,
  NotificationSessionIdentity,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { pendingInputIdentity } from "./pending-input-identity";

export type SessionNotificationSource = {
  association: AgentSessionScope | null;
  snapshot: AgentSessionLiveSnapshot;
};

export const createSessionNotificationBuilder = ({
  repositoryLabel,
  resolveTask,
}: {
  repositoryLabel: string;
  resolveTask(taskId: string): { id: string; title?: string } | null;
}) => {
  let currentRepositoryLabel = repositoryLabel;

  const sessionOccurrence = (
    projection: SessionNotificationSource,
    input: {
      kind:
        | "agent.permission_requested"
        | "agent.question_asked"
        | "agent.session_error"
        | "agent.session_idle";
      suffix: string;
      status: string;
      navigationTarget: NotificationNavigationTarget;
    },
  ): NotificationOccurrence => {
    const occurrence: NotificationOccurrence = {
      occurrenceId: `${input.kind}:${agentSessionRefKey(projection.snapshot.ref)}:${input.suffix}`,
      kind: input.kind,
      repoPath: projection.snapshot.ref.repoPath,
      repositoryLabel: currentRepositoryLabel,
      status: input.status,
      navigationTarget: input.navigationTarget,
    };
    if (projection.association?.kind === "workflow") {
      const taskId = projection.association.taskId;
      occurrence.task = resolveTask(taskId) ?? { id: taskId };
      occurrence.role = projection.association.role;
    }
    return occurrence;
  };

  const sessionTarget = (
    projection: SessionNotificationSource,
  ): Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> => {
    const target: Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> = {
      repoPath: projection.snapshot.ref.repoPath,
      session: toSessionIdentity(projection.snapshot.ref),
    };
    if (projection.association?.kind === "workflow") target.taskId = projection.association.taskId;
    return target;
  };

  const projectPendingInput = (
    projection: SessionNotificationSource,
    input:
      | { inputKind: "permission"; request: AgentSessionLivePendingApprovalRequest }
      | { inputKind: "question"; request: AgentSessionLivePendingQuestionRequest },
  ): NotificationOccurrence => {
    const requestIdentity = pendingInputIdentity(input.request);
    const kind =
      input.inputKind === "permission" ? "agent.permission_requested" : "agent.question_asked";
    const status =
      input.inputKind === "permission"
        ? permissionStatus(input.request)
        : questionStatus(input.request);
    return sessionOccurrence(projection, {
      kind,
      suffix: requestIdentity,
      status,
      navigationTarget: {
        type: "pending_input",
        ...sessionTarget(projection),
        inputKind: input.inputKind,
        requestId: requestIdentity,
      },
    });
  };

  return {
    sessionOccurrence,
    sessionTarget,
    projectPendingInput,
    setRepositoryLabel(label: string) {
      currentRepositoryLabel = label;
    },
  };
};

export const toNotificationStatus = (message: string): string =>
  message.trim().replace(/\s+/g, " ").slice(0, 240);

const toSessionIdentity = (ref: AgentSessionLiveSnapshot["ref"]): NotificationSessionIdentity => ({
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

const permissionStatus = (request: AgentSessionLivePendingApprovalRequest): string => {
  const summary = request.summary?.trim() || request.title.trim();
  const action =
    request.command?.command ??
    request.action?.description ??
    request.action?.name ??
    request.tool?.title ??
    request.tool?.name;
  return (
    toNotificationStatus([summary, action].filter(Boolean).join(": ")) ||
    "Approval is needed to continue."
  );
};

const questionStatus = (request: AgentSessionLivePendingQuestionRequest): string => {
  const question = request.questions[0]?.question.trim() || "Your answer is needed to continue.";
  const remaining = request.questions.length - 1;
  const suffix = remaining > 0 ? ` +${remaining} more question${remaining === 1 ? "" : "s"}` : "";
  return `${toNotificationStatus(question).slice(0, 240 - suffix.length)}${suffix}`;
};
