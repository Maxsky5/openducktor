import type { AgentSessionRecord, RepoPromptOverrides } from "@openducktor/contracts";
import {
  type LiveAgentSessionRef,
  type LiveSessionTruth,
  type RepoRuntimeRef,
  toPersistedOnlyLiveSessionTruth,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

export type { LiveSessionTruth, LiveSessionTruthClassification } from "@openducktor/core";

type LiveSessionTruthReader = (input: LiveAgentSessionRef) => Promise<LiveSessionTruth>;

export const toMissingRuntimeLiveSessionTruth = ({
  record,
  repoPath,
  runtimeKind,
  reason,
}: {
  record: AgentSessionRecord;
  repoPath: RepoRuntimeRef["repoPath"];
  runtimeKind: RepoRuntimeRef["runtimeKind"];
  reason: string;
}): LiveSessionTruth =>
  toPersistedOnlyLiveSessionTruth({
    ref: {
      repoPath,
      runtimeKind,
      externalSessionId: record.externalSessionId,
      workingDirectory: record.workingDirectory,
    },
    reason,
  });

export const createLiveSessionTruthReader = ({
  repoPath,
  resolveHydrationRuntime,
  readTruth,
}: {
  repoPath: RepoRuntimeRef["repoPath"];
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  readTruth: LiveSessionTruthReader;
}): ((record: AgentSessionRecord) => Promise<LiveSessionTruth>) => {
  return async (record) => {
    const runtimeResolution = await resolveHydrationRuntime(record);
    if (!runtimeResolution.ok) {
      return toMissingRuntimeLiveSessionTruth({
        record,
        repoPath,
        runtimeKind: runtimeResolution.runtimeKind,
        reason: runtimeResolution.reason,
      });
    }

    return readTruth({
      repoPath,
      runtimeKind: runtimeResolution.runtimeKind,
      externalSessionId: record.externalSessionId,
      workingDirectory: runtimeResolution.workingDirectory,
    });
  };
};

export const isAttachableLiveSessionTruth = (truth: LiveSessionTruth): boolean => {
  return truth.type === "live" && truth.classification !== "idle";
};

export const liveSessionTruthHasPendingInput = (truth: LiveSessionTruth): boolean => {
  return truth.pendingApprovals.length > 0 || truth.pendingQuestions.length > 0;
};

export const applyLiveSessionTruthToSession = (
  current: AgentSessionState,
  truth: LiveSessionTruth,
  options: {
    promptOverrides?: RepoPromptOverrides;
    selectedModel?: AgentSessionState["selectedModel"];
    missingSessionRuntimeId?: string | null;
  } = {},
): AgentSessionState => {
  const promptOverrides = options.promptOverrides ?? current.promptOverrides;
  const selectedModel = options.selectedModel ?? current.selectedModel;
  const promptOverridesPatch = promptOverrides ? { promptOverrides } : {};
  if (truth.type === "live") {
    return {
      ...current,
      runtimeKind: truth.ref.runtimeKind,
      runtimeId: truth.runtimeId,
      workingDirectory: truth.ref.workingDirectory,
      runtimeRecoveryState: "idle",
      status: truth.agentSessionStatus,
      title: truth.title,
      pendingApprovals: truth.pendingApprovals,
      pendingQuestions: truth.pendingQuestions,
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  if (truth.type === "stale") {
    const runtimeId =
      options.missingSessionRuntimeId !== undefined
        ? options.missingSessionRuntimeId
        : truth.runtimeId;
    return {
      ...current,
      status: current.status === "running" ? "idle" : current.status,
      runtimeKind: truth.ref.runtimeKind,
      runtimeId,
      workingDirectory: truth.ref.workingDirectory,
      pendingApprovals: [],
      pendingQuestions: [],
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  return {
    ...current,
    status: current.status === "running" ? "idle" : current.status,
    runtimeKind: truth.ref.runtimeKind,
    runtimeId: null,
    workingDirectory: truth.ref.workingDirectory,
    pendingApprovals: [],
    pendingQuestions: [],
    ...promptOverridesPatch,
    selectedModel,
  };
};
