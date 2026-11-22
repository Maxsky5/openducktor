import {
  HANDOFF_ATTEMPT_MISSING,
  type AgentChatHandoffSendInput,
  type AgentChatHandoffCheckInput,
  type AgentChatHandoffResult,
  type AgentChatRef,
  type AgentSessionLiveRef,
  type HandoffLink,
  type WorkflowFailure,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { SessionOperationError } from "../../ports/session-operation-error";

export type HandoffSendResult = AgentChatHandoffResult & {
  handoff: { destination: AgentChatHandoffSendInput["destination"] };
};

export const handoffChatKey = (chat: AgentChatRef) =>
  JSON.stringify(
    chat.kind === "workspace_session"
      ? [chat.workspaceId, chat.kind, chat.sessionId]
      : [
          chat.workspaceId,
          chat.kind,
          chat.taskId,
          chat.role,
          chat.first.runtimeKind,
          chat.first.workingDirectory,
          chat.first.externalSessionId,
        ],
  );

export const handoffFailure = (
  stage: string,
  message: string,
  nextAction: string,
): WorkflowFailure => ({
  stage,
  code: "runtime_handoff_failed",
  message,
  nextAction,
});

export const keepAcceptedFailure = (
  accepted: WorkflowFailure | undefined,
  later: WorkflowFailure,
): WorkflowFailure =>
  accepted
    ? {
        ...accepted,
        message: `${accepted.message} ${later.message}`,
        nextAction: `${accepted.nextAction} ${later.nextAction}`,
      }
    : later;

export const newHandoffResult = ({
  chat,
  destination,
  expectedActive,
  submissionId,
}: Pick<
  AgentChatHandoffSendInput,
  "chat" | "destination" | "expectedActive" | "submissionId"
>): HandoffSendResult => ({
  ref: { ...expectedActive, repoPath: chat.repoPath },
  kind: "handoff",
  submissionId,
  pending: true,
  nativeOutcome: "not_issued",
  handoff: { chat, destination, expectedActive },
});

export function unknownHandoffSubmission(ref: AgentSessionLiveRef, submissionId: string) {
  const message = "This host has no delivery record for this submission yet.";
  return new SessionOperationError(
    {
      ref,
      kind: "handoff",
      pending: false,
      nativeOutcome: "uncertain",
      submissionId,
      failure: {
        stage: "check",
        code: HANDOFF_ATTEMPT_MISSING,
        message,
        nextAction: "Keep the draft and check delivery again when the host has a result.",
      },
    },
    new HostValidationError({ field: "handoff", message }),
  );
}

export const restoredHandoffResult = (
  input: AgentChatHandoffCheckInput,
  links: readonly HandoffLink[],
  matches: (link: HandoffLink) => boolean,
): AgentChatHandoffResult | null => {
  const link = links.find(matches);
  if (!link) return null;
  return {
    ref: { ...link.from, repoPath: input.chat.repoPath },
    kind: "handoff",
    submissionId: input.submissionId,
    pending: false,
    nativeOutcome: "accepted",
    handoff: { chat: input.chat, expectedActive: link.from, acceptedLink: link, committed: true },
  };
};
