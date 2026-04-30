import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";

type RuntimeSessionTranscriptSourceBase = {
  runtimeKind: RuntimeKind;
  runtimeId: string;
  workingDirectory: string;
  externalSessionId?: string;
  isLive?: boolean;
  pendingPermissions?: AgentPermissionRequest[] | undefined;
};

export type RuntimeSessionTranscriptSource = RuntimeSessionTranscriptSourceBase;
