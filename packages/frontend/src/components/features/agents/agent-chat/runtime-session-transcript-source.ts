import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentPermissionRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

type RuntimeSessionTranscriptSourceBase = {
  runtimeKind: RuntimeKind;
  runtimeId: string;
  workingDirectory: string;
  externalSessionId?: string;
  isLive?: boolean;
  pendingPermissions?: AgentPermissionRequest[] | undefined;
  pendingQuestions?: AgentQuestionRequest[] | undefined;
};

export type RuntimeSessionTranscriptSource = RuntimeSessionTranscriptSourceBase;
