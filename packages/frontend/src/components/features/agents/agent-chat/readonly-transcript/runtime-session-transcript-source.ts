import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

type RuntimeSessionTranscriptSourceBase = {
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  externalSessionId?: string;
  pendingApprovals?: AgentApprovalRequest[];
  pendingQuestions?: AgentQuestionRequest[];
};

export type RuntimeSessionTranscriptSource = RuntimeSessionTranscriptSourceBase;
