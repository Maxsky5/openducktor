import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";

type PendingRuntimeRequest = {
  requestId: string;
};

export const mergeRuntimePendingRequests = <Request extends PendingRuntimeRequest>(
  sourceRequests: readonly Request[] | undefined,
  sessionRequests: readonly Request[] | undefined,
  repliedRequestIds: ReadonlySet<string>,
): Request[] => {
  const byRequestId = new Map<string, Request>();
  for (const request of sourceRequests ?? []) {
    byRequestId.set(request.requestId, request);
  }
  for (const request of sessionRequests ?? []) {
    byRequestId.set(request.requestId, request);
  }
  for (const requestId of repliedRequestIds) {
    byRequestId.delete(requestId);
  }
  return Array.from(byRequestId.values());
};

export const mergeRuntimePendingApprovals = ({
  source,
  session,
  repliedRequestIds,
}: {
  source: RuntimeSessionTranscriptSource | null;
  session: AgentChatThreadSession | null;
  repliedRequestIds: ReadonlySet<string>;
}): AgentApprovalRequest[] =>
  mergeRuntimePendingRequests(
    source?.pendingApprovals,
    session?.pendingApprovals,
    repliedRequestIds,
  );

export const mergeRuntimePendingQuestions = ({
  source,
  session,
  repliedRequestIds,
}: {
  source: RuntimeSessionTranscriptSource | null;
  session: AgentChatThreadSession | null;
  repliedRequestIds: ReadonlySet<string>;
}): AgentQuestionRequest[] =>
  mergeRuntimePendingRequests(
    source?.pendingQuestions,
    session?.pendingQuestions,
    repliedRequestIds,
  );
