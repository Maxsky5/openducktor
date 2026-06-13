import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

export type RuntimeSessionTranscriptSource = {
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  pendingApprovals?: AgentApprovalRequest[];
  pendingQuestions?: AgentQuestionRequest[];
};
