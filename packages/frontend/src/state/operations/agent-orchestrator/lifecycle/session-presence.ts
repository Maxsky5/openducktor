import type { AgentSessionRecord, RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentSessionPresenceSnapshot,
  type AgentSessionRef,
  type RepoRuntimeRef,
  toPersistedOnlyAgentSessionPresenceSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { hasPendingOutboundSend } from "../support/pending-outbound-send";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

export type { AgentSessionPresence, AgentSessionPresenceSnapshot } from "@openducktor/core";

type SessionPresenceReader = (input: AgentSessionRef) => Promise<AgentSessionPresenceSnapshot>;

export const toMissingRuntimeAgentSessionPresenceSnapshot = ({
  record,
  repoPath,
  runtimeKind,
  reason,
}: {
  record: AgentSessionRecord;
  repoPath: RepoRuntimeRef["repoPath"];
  runtimeKind: RepoRuntimeRef["runtimeKind"];
  reason: string;
}): AgentSessionPresenceSnapshot =>
  toPersistedOnlyAgentSessionPresenceSnapshot({
    ref: {
      repoPath,
      runtimeKind,
      externalSessionId: record.externalSessionId,
      workingDirectory: record.workingDirectory,
    },
    reason,
  });

export const createSessionPresenceReader = ({
  repoPath,
  resolveHydrationRuntime,
  readPresence,
}: {
  repoPath: RepoRuntimeRef["repoPath"];
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  readPresence: SessionPresenceReader;
}): ((record: AgentSessionRecord) => Promise<AgentSessionPresenceSnapshot>) => {
  return async (record) => {
    const runtimeResolution = await resolveHydrationRuntime(record);
    if (!runtimeResolution.ok) {
      return toMissingRuntimeAgentSessionPresenceSnapshot({
        record,
        repoPath,
        runtimeKind: runtimeResolution.runtimeKind,
        reason: runtimeResolution.reason,
      });
    }

    return readPresence({
      ...runtimeResolution.runtimeRef,
      externalSessionId: record.externalSessionId,
      workingDirectory: runtimeResolution.workingDirectory,
    });
  };
};

export const isAttachableAgentSessionPresenceSnapshot = (
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
    missingSessionRuntimeId?: string | null;
    preserveStartingStatusForIdlePresence?: boolean;
  } = {},
): AgentSessionState => {
  const promptOverrides = options.promptOverrides ?? current.promptOverrides;
  const selectedModel = options.selectedModel ?? current.selectedModel;
  const promptOverridesPatch = promptOverrides ? { promptOverrides } : {};
  if (snapshot.presence === "runtime") {
    let status: AgentSessionState["status"] = snapshot.agentSessionStatus;
    if (snapshot.agentSessionStatus === "idle") {
      if (options.preserveStartingStatusForIdlePresence === true && current.status === "starting") {
        status = "starting";
      }
      if (hasPendingOutboundSend(current)) {
        status = "running";
      }
    }

    return {
      ...current,
      runtimeKind: snapshot.ref.runtimeKind,
      runtimeId: snapshot.runtimeId,
      workingDirectory: snapshot.ref.workingDirectory,
      runtimeRecoveryState: "idle",
      status,
      title: snapshot.title,
      pendingApprovals: snapshot.pendingApprovals,
      pendingQuestions: snapshot.pendingQuestions,
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  if (snapshot.presence === "stale") {
    const runtimeId =
      options.missingSessionRuntimeId !== undefined
        ? options.missingSessionRuntimeId
        : snapshot.runtimeId;
    if (hasPendingOutboundSend(current)) {
      return {
        ...current,
        runtimeRecoveryState: "recovering_runtime",
        runtimeKind: snapshot.ref.runtimeKind,
        runtimeId,
        workingDirectory: snapshot.ref.workingDirectory,
        ...promptOverridesPatch,
        selectedModel,
      };
    }
    return {
      ...current,
      status: current.status === "running" ? "idle" : current.status,
      runtimeKind: snapshot.ref.runtimeKind,
      runtimeId,
      workingDirectory: snapshot.ref.workingDirectory,
      pendingApprovals: [],
      pendingQuestions: [],
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  if (hasPendingOutboundSend(current)) {
    return {
      ...current,
      runtimeRecoveryState: "recovering_runtime",
      runtimeKind: snapshot.ref.runtimeKind,
      runtimeId: null,
      workingDirectory: snapshot.ref.workingDirectory,
      pendingApprovals: [],
      pendingQuestions: [],
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  return {
    ...current,
    status: current.status === "running" ? "idle" : current.status,
    runtimeKind: snapshot.ref.runtimeKind,
    runtimeId: null,
    workingDirectory: snapshot.ref.workingDirectory,
    pendingApprovals: [],
    pendingQuestions: [],
    ...promptOverridesPatch,
    selectedModel,
  };
};
