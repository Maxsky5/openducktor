import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  settleLiveTurnFields,
  shouldHoldSessionOnIdleSignal,
  statusWithoutRuntimePresence,
} from "./session-idle-signal";

export type { AgentSessionPresence, AgentSessionPresenceSnapshot } from "@openducktor/core";

export const shouldListenToAgentSessionPresenceSnapshot = (
  snapshot: AgentSessionPresenceSnapshot,
): boolean => {
  return snapshot.presence === "runtime" && snapshot.classification !== "idle";
};

export const sessionPresenceHasPendingInput = (snapshot: AgentSessionPresenceSnapshot): boolean => {
  return snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;
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
    const status =
      snapshot.agentSessionStatus === "idle" &&
      !sessionPresenceHasPendingInput(snapshot) &&
      shouldHoldSessionOnIdleSignal(current)
        ? current.status
        : snapshot.agentSessionStatus;
    const liveTurnFields = status === "idle" ? settleLiveTurnFields() : {};

    return {
      ...current,
      runtimeKind: snapshot.ref.runtimeKind,
      workingDirectory: snapshot.ref.workingDirectory,
      status,
      title: snapshot.title,
      pendingApprovals: snapshot.pendingApprovals,
      pendingQuestions: snapshot.pendingQuestions,
      ...liveTurnFields,
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
    ...settleLiveTurnFields(),
    ...promptOverridesPatch,
    selectedModel,
  };
};
