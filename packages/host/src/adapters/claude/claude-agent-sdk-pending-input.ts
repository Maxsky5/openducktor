import type { AgentEvent, ReplyApprovalInput, ReplyQuestionInput } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import {
  claudePendingInputResolutionRoute,
  routeClaudePendingInputEvent,
} from "./claude-agent-sdk-pending-input-routing";
import type { ClaudeSession, PendingQuestion } from "./claude-agent-sdk-types";

type ResolveClaudePendingInput = {
  now: () => string;
  session: ClaudeSession;
};

type ClaudePendingInputResolution = {
  event: Extract<AgentEvent, { type: "approval_resolved" | "question_resolved" }>;
  complete: () => void;
};

export const prepareClaudeApprovalReply = ({
  input,
  now,
  session,
}: ResolveClaudePendingInput & { input: ReplyApprovalInput }): ClaudePendingInputResolution => {
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
  return {
    event: routeClaudePendingInputEvent({
      type: "approval_resolved",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      requestId: input.requestId,
      ...claudePendingInputResolutionRoute(pending.event),
    }),
    complete: () => {
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
    },
  };
};

const validateQuestionAnswers = (pending: PendingQuestion, input: ReplyQuestionInput): void => {
  const questions = pending.event.questions;
  if (input.answers.length !== questions.length) {
    throw new HostValidationError({
      field: "answers",
      message: `Claude question '${input.requestId}' requires exactly ${questions.length} answer group${questions.length === 1 ? "" : "s"}, received ${input.answers.length}.`,
      details: {
        externalSessionId: input.externalSessionId,
        requestId: input.requestId,
      },
    });
  }
  questions.forEach((question, index) => {
    const answers = input.answers[index];
    if (!answers || answers.length === 0) {
      throw new HostValidationError({
        field: "answers",
        message: `Claude question '${input.requestId}' answer group ${index + 1} requires at least one answer.`,
        details: {
          externalSessionId: input.externalSessionId,
          requestId: input.requestId,
          questionIndex: index,
        },
      });
    }
    if (answers.some((answer) => answer.trim().length === 0)) {
      throw new HostValidationError({
        field: "answers",
        message: `Claude question '${input.requestId}' answer group ${index + 1} requires non-blank answers.`,
        details: {
          externalSessionId: input.externalSessionId,
          requestId: input.requestId,
          questionIndex: index,
        },
      });
    }
    if (!question.multiple && answers.length > 1) {
      throw new HostValidationError({
        field: "answers",
        message: `Claude question '${input.requestId}' answer group ${index + 1} allows only one answer.`,
        details: {
          externalSessionId: input.externalSessionId,
          requestId: input.requestId,
          questionIndex: index,
        },
      });
    }
  });
};

export const prepareClaudeQuestionReply = ({
  input,
  now,
  session,
}: ResolveClaudePendingInput & { input: ReplyQuestionInput }): ClaudePendingInputResolution => {
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
  validateQuestionAnswers(pending, input);
  return {
    event: routeClaudePendingInputEvent({
      type: "question_resolved",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      requestId: input.requestId,
      ...claudePendingInputResolutionRoute(pending.event),
    }),
    complete: () => {
      session.pendingQuestions.delete(input.requestId);
      pending.resolve(input.answers);
    },
  };
};
