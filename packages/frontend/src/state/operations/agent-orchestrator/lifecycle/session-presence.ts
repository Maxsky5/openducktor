import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settlePendingOutboundSendFields } from "../support/pending-outbound-send";

export type { AgentSessionPresence, AgentSessionPresenceSnapshot } from "@openducktor/core";

export const shouldListenToAgentSessionPresenceSnapshot = (
  snapshot: AgentSessionPresenceSnapshot,
): boolean => {
  return snapshot.presence === "runtime" && snapshot.classification !== "idle";
};

export const sessionPresenceHasPendingInput = (snapshot: AgentSessionPresenceSnapshot): boolean => {
  return snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;
};

const shouldKeepStartingUntilSend = (
  current: AgentSessionState,
  snapshot: Extract<AgentSessionPresenceSnapshot, { presence: "runtime" }>,
): boolean => {
  return (
    current.status === "starting" &&
    snapshot.agentSessionStatus === "idle" &&
    !sessionPresenceHasPendingInput(snapshot)
  );
};

const statusWithoutRuntimePresence = (current: AgentSessionState): AgentSessionState["status"] => {
  if (current.status === "error" || current.status === "stopped") {
    return current.status;
  }
  return "idle";
};

export const applyAgentSessionPresenceSnapshotToSession = (
  current: AgentSessionState,
  snapshot: AgentSessionPresenceSnapshot,
  options: {
    promptOverrides?: RepoPromptOverrides;
    selectedModel?: AgentSessionState["selectedModel"];
  } = {},
): AgentSessionState => {
  const promptOverrides = options.promptOverrides ?? current.promptOverrides;
  const selectedModel = options.selectedModel ?? current.selectedModel;
  const promptOverridesPatch = promptOverrides ? { promptOverrides } : {};
  if (snapshot.presence === "runtime") {
    // Runtime presence owns live status; local starting survives only until the send is attempted.
    const status = shouldKeepStartingUntilSend(current, snapshot)
      ? current.status
      : snapshot.agentSessionStatus;
    const pendingOutboundSendFields = status === "idle" ? settlePendingOutboundSendFields() : {};

    return {
      ...current,
      runtimeKind: snapshot.ref.runtimeKind,
      workingDirectory: snapshot.ref.workingDirectory,
      status,
      title: snapshot.title,
      pendingApprovals: snapshot.pendingApprovals,
      pendingQuestions: snapshot.pendingQuestions,
      ...pendingOutboundSendFields,
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  return {
    ...current,
    runtimeKind: snapshot.ref.runtimeKind,
    workingDirectory: snapshot.ref.workingDirectory,
    status: statusWithoutRuntimePresence(current),
    pendingApprovals: [],
    pendingQuestions: [],
    ...settlePendingOutboundSendFields(),
    ...promptOverridesPatch,
    selectedModel,
  };
};
