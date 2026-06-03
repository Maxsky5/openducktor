import type { RuntimeRef } from "@openducktor/contracts";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

type RuntimeSessionTranscriptSourceBase = {
  runtimeRef: RuntimeRef;
  workingDirectory: string;
  externalSessionId?: string;
  isLive?: boolean;
  pendingApprovals?: AgentApprovalRequest[];
  pendingQuestions?: AgentQuestionRequest[];
};

export type RuntimeSessionTranscriptSource = RuntimeSessionTranscriptSourceBase;
