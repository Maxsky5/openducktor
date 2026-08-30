import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

export type PendingInputIdentity = Pick<
  AgentApprovalRequest | AgentQuestionRequest,
  "requestId" | "requestInstanceId"
>;

export const pendingInputIdentity = (entry: PendingInputIdentity): string =>
  entry.requestInstanceId ?? entry.requestId;
