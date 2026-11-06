import type {
  GitTargetBranch,
  RuntimeKind,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import type { AgentMessageSendOptions, AgentSessionIdentity } from "../../types/agent-orchestrator";
import type {
  WorkflowLaunchActionId as SessionLaunchActionId,
  WorkflowRoleId as AgentRole,
} from "@openducktor/workflows";

export type SessionStartExistingSessionOption = {
  value: string;
  sourceSession: AgentSessionIdentity;
  /**
   * The role of the source session when it can differ from the role of the request, as for the
   * core pull request launch. The start then runs as this role.
   */
  role?: AgentRole;
  label: string;
  description: string;
  secondaryLabel?: string;
  runtimeKind?: RuntimeKind | null;
  selectedModel?: AgentModelSelection | null;
};

export type NewSessionStartRequest = {
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedModel: AgentModelSelection | null;
  targetWorkingDirectory?: string | null;
  initialTargetBranch?: GitTargetBranch | null;
  initialTargetBranchError?: string | null;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
};

export type FreshSessionStartDecision = {
  startMode: "fresh";
  selectedModel: AgentModelSelection;
  targetBranch?: GitTargetBranch;
  kickoffPrompt?: string;
};

export type ReuseSessionStartDecision = {
  startMode: "reuse";
  sourceSession: AgentSessionIdentity;
  /** Omit to keep the source speed. Null sets standard speed. */
  speed?: string | null;
  targetBranch?: GitTargetBranch;
  kickoffPrompt?: string;
};

export type ForkSessionStartDecision = {
  startMode: "fork";
  selectedModel: AgentModelSelection;
  sourceSession: AgentSessionIdentity;
  targetBranch?: GitTargetBranch;
  kickoffPrompt?: string;
};

export type NewSessionStartDecision =
  | FreshSessionStartDecision
  | ReuseSessionStartDecision
  | ForkSessionStartDecision
  | null;

export type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

export type SessionStartPostAction = "none" | "kickoff" | "send_message";

/** A workflow event that the host commits before the session starts. */
export type SessionStartBeforeAction = {
  eventId: string;
  note?: string;
};

export type SessionStartFlowRequest = Omit<NewSessionStartRequest, "selectedModel"> & {
  initialStartMode?: AgentSessionStartMode;
  postStartAction: SessionStartPostAction;
  /** Collected context for the declared prompt, not a complete instruction. */
  humanFeedback?: string;
  /** A complete message instruction, such as Git conflict assistance. */
  message?: string;
  parts?: AgentSessionUserMessagePart[];
  assertBeforeLaunch?: () => void;
  /** Checks the recipient before a retry sends the first instruction again. */
  assertCanSubmit?: AgentMessageSendOptions["assertCanSubmit"];
  beforeStartAction?: SessionStartBeforeAction;
};
