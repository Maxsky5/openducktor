import type { GitTargetBranch, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionStartMode } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { SessionLaunchActionId } from "./session-start-launch-options";
import type { SessionStartExistingSessionOption } from "./session-start-types";
import type { SessionStartPostAction } from "./session-start-workflow";

export type SessionStartModalSource = "agent_studio" | "kanban";

export type SessionStartModalIntent = {
  source: SessionStartModalSource;
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  initialStartMode?: AgentSessionStartMode;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
  targetWorkingDirectory?: string | null;
  initialTargetBranch?: GitTargetBranch | null;
  initialTargetBranchError?: string | null;
  postStartAction: SessionStartPostAction;
  message?: string;
  requestedRuntimeKind?: RuntimeKind | null;
  selectedModel?: AgentModelSelection | null;
  title: string;
  description?: string;
};
