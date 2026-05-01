import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionStartMode } from "@openducktor/core";
import type { SessionLaunchActionId } from "./session-start-launch-options";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export type SessionStartModalSource = "agent_studio" | "kanban";
export type SessionStartPostAction = "none" | "kickoff" | "send_message";

export type SessionStartModalIntent = {
  source: SessionStartModalSource;
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  initialStartMode?: AgentSessionStartMode;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceExternalSessionId?: string | null;
  targetWorkingDirectory?: string | null;
  initialTargetBranch?: GitTargetBranch | null;
  initialTargetBranchError?: string | null;
  postStartAction: SessionStartPostAction;
  message?: string;
  selectedModel?: AgentModelSelection | null;
  title: string;
  description?: string;
};
