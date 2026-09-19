import type {
  AgentAsyncQuestion,
  AgentAsyncQuestionAnnotation,
  AgentAsyncQuestionReply,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";

export type AgentAsyncQuestionProjection = {
  pendingAsyncQuestions: readonly AgentAsyncQuestion[];
  handledAsyncQuestionIds: ReadonlySet<string>;
};

export const emptyAgentAsyncQuestionProjection = (): AgentAsyncQuestionProjection => ({
  pendingAsyncQuestions: [],
  handledAsyncQuestionIds: new Set(),
});

export const applyAsyncQuestionAnnotation = (
  current: AgentAsyncQuestionProjection,
  annotation: AgentAsyncQuestionAnnotation | undefined,
): AgentAsyncQuestionProjection => {
  if (annotation?.status !== "pending") {
    return current;
  }
  const pendingById = new Map(
    current.pendingAsyncQuestions.map((question) => [question.questionItemId, question]),
  );
  for (const question of annotation.questions) {
    if (!current.handledAsyncQuestionIds.has(question.questionItemId)) {
      pendingById.set(question.questionItemId, question);
    }
  }
  return { ...current, pendingAsyncQuestions: [...pendingById.values()] };
};

export const applyAsyncQuestionUserMessage = (
  current: AgentAsyncQuestionProjection,
  replies: readonly AgentAsyncQuestionReply[] | undefined,
): AgentAsyncQuestionProjection => {
  const handled = new Set(current.handledAsyncQuestionIds);
  if (replies) {
    for (const reply of replies) handled.add(reply.questionItemId);
  } else {
    for (const question of current.pendingAsyncQuestions) handled.add(question.questionItemId);
  }
  return {
    pendingAsyncQuestions: current.pendingAsyncQuestions.filter(
      (question) => !handled.has(question.questionItemId),
    ),
    handledAsyncQuestionIds: handled,
  };
};

export const markAsyncQuestionsHandled = (
  current: AgentAsyncQuestionProjection,
  questionItemIds: Iterable<string>,
): AgentAsyncQuestionProjection => {
  const handled = new Set(current.handledAsyncQuestionIds);
  for (const questionItemId of questionItemIds) handled.add(questionItemId);
  return {
    pendingAsyncQuestions: current.pendingAsyncQuestions.filter(
      (question) => !handled.has(question.questionItemId),
    ),
    handledAsyncQuestionIds: handled,
  };
};

export const projectAsyncQuestionsFromHistory = (
  history: readonly AgentSessionHistoryMessage[],
): AgentAsyncQuestionProjection => {
  let projected = emptyAgentAsyncQuestionProjection();
  for (const message of history) {
    projected =
      message.role === "assistant"
        ? applyAsyncQuestionAnnotation(projected, message.asyncQuestion)
        : message.role === "user"
          ? applyAsyncQuestionUserMessage(projected, message.asyncQuestionReplies)
          : projected;
  }
  return projected;
};

export const mergeAsyncQuestionHistory = (
  history: AgentAsyncQuestionProjection,
  current: AgentAsyncQuestionProjection,
  atReadStart?: AgentAsyncQuestionProjection,
): AgentAsyncQuestionProjection => {
  let merged = markAsyncQuestionsHandled(history, current.handledAsyncQuestionIds);
  if (!atReadStart) return merged;
  const pendingAtReadStart = new Set(
    atReadStart.pendingAsyncQuestions.map((question) => question.questionItemId),
  );
  const liveAdditions = current.pendingAsyncQuestions.filter(
    (question) => !pendingAtReadStart.has(question.questionItemId),
  );
  return applyAsyncQuestionAnnotation(
    merged,
    liveAdditions.length > 0 ? { status: "pending", questions: liveAdditions } : undefined,
  );
};
