import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeHydratedMessages } from "../support/hydrated-message-merge";
import { historyToSessionContextUsage } from "../support/persistence";
import {
  mergeSubagentPendingApprovalOverlay,
  mergeSubagentPendingQuestionOverlay,
} from "../support/subagent-approval-overlay";
import type { SuccessfulHydrationRuntime } from "./load-sessions-runtime-resolution-stage";
import type { SessionLifecycleAdapter } from "./load-sessions-stages";
import type { HydratedSubagentPendingInputOverlay } from "./load-sessions-subagent-pending-input-hydration";

export type HydratedRecordHistoryState = {
  promptOverrides: RepoPromptOverrides;
  history: Awaited<ReturnType<SessionLifecycleAdapter["loadSessionHistory"]>>;
  todos: Awaited<ReturnType<AgentEnginePort["loadSessionTodos"]>>;
  runtimeResolution: SuccessfulHydrationRuntime;
  hydratedMessages: AgentSessionState["messages"];
  hydratedSubagentPendingInputByExternalSessionId: HydratedSubagentPendingInputOverlay;
};

export const applyHydratedRecordHistory = (
  current: AgentSessionState,
  {
    promptOverrides,
    history,
    todos,
    runtimeResolution,
    hydratedMessages,
    hydratedSubagentPendingInputByExternalSessionId,
  }: HydratedRecordHistoryState,
): AgentSessionState => ({
  ...current,
  runtimeKind: runtimeResolution.runtimeRef.runtimeKind,
  workingDirectory: runtimeResolution.workingDirectory,
  promptOverrides,
  historyHydrationState: "hydrated",
  runtimeRecoveryState: current.runtimeRecoveryState ?? "idle",
  todos,
  subagentPendingApprovalsByExternalSessionId: mergeSubagentPendingApprovalOverlay({
    current: current.subagentPendingApprovalsByExternalSessionId,
    scannedChildExternalSessionIds:
      hydratedSubagentPendingInputByExternalSessionId.scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId:
      hydratedSubagentPendingInputByExternalSessionId.pendingApprovalsByChildExternalSessionId,
  }),
  subagentPendingQuestionsByExternalSessionId: mergeSubagentPendingQuestionOverlay({
    current: current.subagentPendingQuestionsByExternalSessionId,
    scannedChildExternalSessionIds:
      hydratedSubagentPendingInputByExternalSessionId.scannedChildExternalSessionIds,
    pendingQuestionsByChildExternalSessionId:
      hydratedSubagentPendingInputByExternalSessionId.pendingQuestionsByChildExternalSessionId,
  }),
  contextUsage: historyToSessionContextUsage(history),
  messages: mergeHydratedMessages(current.externalSessionId, hydratedMessages, current.messages),
});
