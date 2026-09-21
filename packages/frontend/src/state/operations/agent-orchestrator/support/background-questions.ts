import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";

export const projectBackgroundQuestions = (
  history: readonly AgentSessionHistoryMessage[],
): AgentQuestionRequest[] => {
  const pending = new Map<string, AgentQuestionRequest>();
  for (const message of history) {
    if (message.role === "assistant" && message.questionRequest) {
      pending.set(message.questionRequest.requestId, message.questionRequest);
      continue;
    }
    if (message.role !== "user") continue;
    const handledRequestIds = message.resolvedQuestionRequestIds ?? [...pending.keys()];
    for (const requestId of handledRequestIds) {
      pending.delete(requestId);
    }
  }
  return [...pending.values()];
};

export const closeBackgroundQuestions = (
  current: Pick<AgentSessionState, "pendingQuestions">,
  requestIds: readonly string[],
): Pick<AgentSessionState, "pendingQuestions"> => {
  const handled = new Set(requestIds);
  return {
    pendingQuestions: current.pendingQuestions.filter(
      (request) => request.blocking !== false || !handled.has(request.requestId),
    ),
  };
};
