import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";

type BackgroundQuestionProjection = {
  pendingQuestions: readonly AgentQuestionRequest[];
  handledQuestionIds: ReadonlySet<string>;
};

type BackgroundQuestionState = Pick<
  AgentSessionState,
  "pendingQuestions" | "handledBackgroundQuestionIds"
>;

export const projectBackgroundQuestions = (
  history: readonly AgentSessionHistoryMessage[],
): BackgroundQuestionProjection => {
  const pending = new Map<string, AgentQuestionRequest>();
  const handled = new Set<string>();
  for (const message of history) {
    if (message.role === "assistant" && message.questionRequest) {
      if (!handled.has(message.questionRequest.requestId)) {
        pending.set(message.questionRequest.requestId, message.questionRequest);
      }
      continue;
    }
    if (message.role !== "user") continue;
    for (const requestId of message.resolvedQuestionRequestIds ?? []) {
      handled.add(requestId);
      pending.delete(requestId);
    }
  }
  return { pendingQuestions: [...pending.values()], handledQuestionIds: handled };
};

const mergeBackgroundQuestions = (
  history: BackgroundQuestionProjection,
  current: BackgroundQuestionProjection,
): BackgroundQuestionProjection => {
  const handledQuestionIds = new Set([
    ...history.handledQuestionIds,
    ...current.handledQuestionIds,
  ]);
  const pending = new Map<string, AgentQuestionRequest>();
  for (const request of [...history.pendingQuestions, ...current.pendingQuestions]) {
    if (!handledQuestionIds.has(request.requestId)) pending.set(request.requestId, request);
  }
  return { pendingQuestions: [...pending.values()], handledQuestionIds };
};

export const mergeBackgroundQuestionHistory = (
  history: readonly AgentSessionHistoryMessage[],
  current: BackgroundQuestionState,
): BackgroundQuestionState => {
  const background = mergeBackgroundQuestions(projectBackgroundQuestions(history), {
    pendingQuestions: current.pendingQuestions.filter((request) => request.blocking === false),
    handledQuestionIds: current.handledBackgroundQuestionIds ?? new Set(),
  });
  const merged = [
    ...current.pendingQuestions.filter((request) => request.blocking !== false),
    ...background.pendingQuestions,
  ];
  const pendingQuestions =
    merged.length === current.pendingQuestions.length &&
    merged.every((request, index) => request === current.pendingQuestions[index])
      ? current.pendingQuestions
      : merged;
  return {
    pendingQuestions,
    handledBackgroundQuestionIds: background.handledQuestionIds,
  };
};

export const closeBackgroundQuestions = (
  current: BackgroundQuestionState,
  requestIds: readonly string[],
): BackgroundQuestionState => {
  const handledBackgroundQuestionIds = new Set(current.handledBackgroundQuestionIds ?? []);
  for (const requestId of requestIds) {
    handledBackgroundQuestionIds.add(requestId);
  }
  return {
    handledBackgroundQuestionIds,
    pendingQuestions: current.pendingQuestions.filter(
      (request) =>
        request.blocking !== false || !handledBackgroundQuestionIds.has(request.requestId),
    ),
  };
};
