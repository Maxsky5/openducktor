import type { GitTargetBranch, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { SessionStartExistingSessionOption } from "./session-start-types";
import type { SessionStartPostAction } from "./session-start-workflow";
import type {
  BuiltinLaunchActionId as SessionLaunchActionId,
  BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";

/** Where the start began: an Agent Studio session view, or a task action on any task view. */
export type SessionStartModalSource = "agent_studio" | "task_action";

export type SessionStartModalIntent = {
  source: SessionStartModalSource;
  requestId?: string;
  resolveKickoffPrompt?: (targetBranch?: GitTargetBranch) => Promise<string>;
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
