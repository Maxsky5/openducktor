import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

type RuntimeSessionTranscriptSourceBase = {
  runtimeKind: RuntimeKind;
  runtimeId?: string;
  workingDirectory: string;
  externalSessionId?: string;
  isLive?: boolean;
  pendingApprovals?: AgentApprovalRequest[];
  pendingQuestions?: AgentQuestionRequest[];
};

export type RuntimeSessionTranscriptSource = RuntimeSessionTranscriptSourceBase;
