import type { AgentEvent, ReplyApprovalInput, ReplyQuestionInput } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import {
  claudePendingInputResolutionRoute,
  emitClaudePendingInputEvent,
} from "./claude-agent-sdk-pending-input-routing";
import type { ClaudeSession } from "./claude-agent-sdk-types";

type ResolveClaudePendingInput = {
  emit: (session: ClaudeSession, event: AgentEvent) => void;
  now: () => string;
  session: ClaudeSession;
};

export const replyClaudeApproval = ({
  emit,
  input,
  now,
  session,
}: ResolveClaudePendingInput & { input: ReplyApprovalInput }): void => {
  const pending = session.pendingApprovals.get(input.requestId);
  if (!pending) {
    throw new HostValidationError({
      field: "requestId",
      message: `Claude approval request '${input.requestId}' is not pending.`,
      details: {
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
      },
    });
  }
  if (input.outcome !== "approve_once" && input.outcome !== "reject") {
    throw new HostValidationError({
      field: "outcome",
      message: `Claude approval replies support only approve_once or reject, received '${input.outcome}'.`,
      details: {
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
        outcome: input.outcome,
      },
    });
  }
  session.pendingApprovals.delete(input.requestId);
  pending.resolve(
    input.outcome === "approve_once"
      ? { behavior: "allow" }
      : {
          behavior: "deny",
          message: input.message ?? "Denied by user.",
          interrupt: true,
        },
  );
  emitClaudePendingInputEvent({
    emit,
    session,
    event: {
      type: "approval_resolved",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      requestId: input.requestId,
      ...claudePendingInputResolutionRoute(pending.event),
    },
  });
};

export const replyClaudeQuestion = ({
  emit,
  input,
  now,
  session,
}: ResolveClaudePendingInput & { input: ReplyQuestionInput }): void => {
  const pending = session.pendingQuestions.get(input.requestId);
  if (!pending) {
    throw new HostValidationError({
      field: "requestId",
      message: `Claude question request '${input.requestId}' is not pending.`,
      details: {
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
      },
    });
  }
  session.pendingQuestions.delete(input.requestId);
  pending.resolve(input.answers);
  emitClaudePendingInputEvent({
    emit,
    session,
    event: {
      type: "question_resolved",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      requestId: input.requestId,
      ...claudePendingInputResolutionRoute(pending.event),
    },
  });
};
