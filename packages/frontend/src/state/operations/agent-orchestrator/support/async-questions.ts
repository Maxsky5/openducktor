import type {
  AgentAsyncQuestion,
  AgentAsyncQuestionAnnotation,
  AgentAsyncQuestionReply,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentAsyncQuestionSkipMessage } from "@/types/agent-orchestrator";

const ASYNC_QUESTION_SKIP_MESSAGE_LIMIT = 600;
const LOCAL_ACCEPTED_USER_CONFIRMATION_WINDOW_MS = 10_000;

export type AgentAsyncQuestionProjection = {
  pendingAsyncQuestions: readonly AgentAsyncQuestion[];
  handledAsyncQuestionIds: ReadonlySet<string>;
  asyncQuestionSkipMessages: readonly AgentAsyncQuestionSkipMessage[];
};

export const emptyAgentAsyncQuestionProjection = (): AgentAsyncQuestionProjection => ({
  pendingAsyncQuestions: [],
  handledAsyncQuestionIds: new Set(),
  asyncQuestionSkipMessages: [],
});

const skipMessageTimestampMs = (message: AgentAsyncQuestionSkipMessage): number | null => {
  const parsed = Date.parse(message.timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

const skipMessagesMatch = (
  left: AgentAsyncQuestionSkipMessage,
  right: AgentAsyncQuestionSkipMessage,
): boolean => {
  if (left.messageId === right.messageId) return true;
  if (left.text !== right.text) return false;
  const leftTimestampMs = skipMessageTimestampMs(left);
  const rightTimestampMs = skipMessageTimestampMs(right);
  return (
    leftTimestampMs !== null &&
    rightTimestampMs !== null &&
    Math.abs(leftTimestampMs - rightTimestampMs) <= LOCAL_ACCEPTED_USER_CONFIRMATION_WINDOW_MS
  );
};

const appendSkipMessage = (
  messages: readonly AgentAsyncQuestionSkipMessage[],
  message: AgentAsyncQuestionSkipMessage,
): readonly AgentAsyncQuestionSkipMessage[] =>
  [...messages.filter((candidate) => candidate.messageId !== message.messageId), message].slice(
    -ASYNC_QUESTION_SKIP_MESSAGE_LIMIT,
  );

const takeMatchingSkipIndex = (
  candidates: readonly AgentAsyncQuestionSkipMessage[],
  unmatchedIndexes: Set<number>,
  message: AgentAsyncQuestionSkipMessage,
): number | undefined => {
  const exactIndex = [...unmatchedIndexes].find(
    (index) => candidates[index]?.messageId === message.messageId,
  );
  const matchedIndex =
    exactIndex ??
    [...unmatchedIndexes].find((index) => {
      const candidate = candidates[index];
      return candidate !== undefined && skipMessagesMatch(candidate, message);
    });
  if (matchedIndex !== undefined) unmatchedIndexes.delete(matchedIndex);
  return matchedIndex;
};

const mergeSkipMessages = (
  history: readonly AgentAsyncQuestionSkipMessage[],
  current: readonly AgentAsyncQuestionSkipMessage[],
): readonly AgentAsyncQuestionSkipMessage[] => {
  const merged = [...history];
  const unmatchedHistoryIndexes = new Set(history.map((_, index) => index));
  for (const message of current) {
    if (takeMatchingSkipIndex(history, unmatchedHistoryIndexes, message) === undefined) {
      merged.push(message);
    }
  }
  return merged.slice(-ASYNC_QUESTION_SKIP_MESSAGE_LIMIT);
};

const findUnrepresentedLiveSkips = (
  history: readonly AgentAsyncQuestionSkipMessage[],
  current: readonly AgentAsyncQuestionSkipMessage[],
  atReadStart: readonly AgentAsyncQuestionSkipMessage[],
): readonly AgentAsyncQuestionSkipMessage[] => {
  const skipIdsAtReadStart = new Set(atReadStart.map((message) => message.messageId));
  const unmatchedHistoryIndexes = new Set(history.map((_, index) => index));
  const unrepresented: AgentAsyncQuestionSkipMessage[] = [];
  for (const message of atReadStart) {
    takeMatchingSkipIndex(history, unmatchedHistoryIndexes, message);
  }
  for (const liveMessage of current) {
    if (skipIdsAtReadStart.has(liveMessage.messageId)) continue;
    if (takeMatchingSkipIndex(history, unmatchedHistoryIndexes, liveMessage) === undefined) {
      unrepresented.push(liveMessage);
    }
  }
  return unrepresented;
};

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
  message: AgentAsyncQuestionSkipMessage,
  questionItemIds?: readonly string[],
): AgentAsyncQuestionProjection => {
  const handled = new Set(current.handledAsyncQuestionIds);
  if (replies) {
    for (const reply of replies) handled.add(reply.questionItemId);
  } else {
    const skippedQuestionItemIds =
      questionItemIds ?? current.pendingAsyncQuestions.map((question) => question.questionItemId);
    for (const questionItemId of skippedQuestionItemIds) handled.add(questionItemId);
  }
  return {
    pendingAsyncQuestions: current.pendingAsyncQuestions.filter(
      (question) => !handled.has(question.questionItemId),
    ),
    handledAsyncQuestionIds: handled,
    asyncQuestionSkipMessages: replies
      ? current.asyncQuestionSkipMessages
      : appendSkipMessage(current.asyncQuestionSkipMessages, message),
  };
};

export const markAsyncQuestionsHandled = (
  current: AgentAsyncQuestionProjection,
  questionItemIds: Iterable<string>,
): AgentAsyncQuestionProjection => {
  const handled = new Set(current.handledAsyncQuestionIds);
  for (const questionItemId of questionItemIds) handled.add(questionItemId);
  return {
    ...current,
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
          ? applyAsyncQuestionUserMessage(projected, message.asyncQuestionReplies, message)
          : projected;
  }
  return projected;
};

export const mergeAsyncQuestionHistory = (
  history: AgentAsyncQuestionProjection,
  current: AgentAsyncQuestionProjection,
  atReadStart?: AgentAsyncQuestionProjection,
): AgentAsyncQuestionProjection => {
  let merged: AgentAsyncQuestionProjection = {
    ...markAsyncQuestionsHandled(history, current.handledAsyncQuestionIds),
    asyncQuestionSkipMessages: mergeSkipMessages(
      history.asyncQuestionSkipMessages,
      current.asyncQuestionSkipMessages,
    ),
  };
  if (!atReadStart) return merged;
  const unrepresentedLiveSkips = findUnrepresentedLiveSkips(
    history.asyncQuestionSkipMessages,
    current.asyncQuestionSkipMessages,
    atReadStart.asyncQuestionSkipMessages,
  );
  if (unrepresentedLiveSkips.length > 0) {
    merged = markAsyncQuestionsHandled(
      merged,
      merged.pendingAsyncQuestions.map((question) => question.questionItemId),
    );
  }
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
