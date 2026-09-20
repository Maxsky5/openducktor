import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

export type BackgroundQuestionProjection = {
  pendingQuestions: readonly AgentQuestionRequest[];
  handledQuestionIds: ReadonlySet<string>;
};

export const emptyBackgroundQuestionProjection = (): BackgroundQuestionProjection => ({
  pendingQuestions: [],
  handledQuestionIds: new Set(),
});

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

export const mergeBackgroundQuestions = (
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
