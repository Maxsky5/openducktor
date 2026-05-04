import type { AgentSessionRecord, RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import {
  classifyLiveAgentSessionSnapshot,
  type LiveAgentSessionClassification,
  type LiveAgentSessionSnapshot,
  toLiveAgentSessionRuntimeStatus,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

export type LiveSessionTruthClassification =
  | LiveAgentSessionClassification
  | "persisted_only"
  | "stale";

export type LiveSessionTruth =
  | {
      type: "live";
      classification: LiveAgentSessionClassification;
      externalSessionId: string;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      workingDirectory: string;
      snapshot: LiveAgentSessionSnapshot;
      title: string | undefined;
      agentSessionStatus: AgentSessionState["status"];
      pendingApprovals: LiveAgentSessionSnapshot["pendingApprovals"];
      pendingQuestions: LiveAgentSessionSnapshot["pendingQuestions"];
    }
  | {
      type: "missing_runtime";
      classification: "persisted_only";
      externalSessionId: string;
      runtimeKind: RuntimeKind;
      runtimeId: null;
      workingDirectory: string;
      reason: string;
      pendingApprovals: [];
      pendingQuestions: [];
    }
  | {
      type: "missing_session";
      classification: "stale";
      externalSessionId: string;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      workingDirectory: string;
      pendingApprovals: [];
      pendingQuestions: [];
    };

type LiveSessionSnapshotReader = (input: {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  externalSessionId: string;
}) => Promise<LiveAgentSessionSnapshot | null>;

const EMPTY_PENDING_INPUT = Object.freeze([]) as [];

export const normalizeLiveSessionTitle = (title: string | undefined): string | undefined => {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const toLiveSessionTruthFromResolvedSnapshot = ({
  externalSessionId,
  runtimeKind,
  runtimeId,
  workingDirectory,
  snapshot,
}: {
  externalSessionId: string;
  runtimeKind: RuntimeKind;
  runtimeId: string | null;
  workingDirectory: string;
  snapshot: LiveAgentSessionSnapshot | null;
}): LiveSessionTruth => {
  if (!snapshot) {
    return {
      type: "missing_session",
      classification: "stale",
      externalSessionId,
      runtimeKind,
      runtimeId,
      workingDirectory,
      pendingApprovals: EMPTY_PENDING_INPUT,
      pendingQuestions: EMPTY_PENDING_INPUT,
    };
  }

  const classification = classifyLiveAgentSessionSnapshot(snapshot);
  return {
    type: "live",
    classification,
    externalSessionId,
    runtimeKind,
    runtimeId,
    workingDirectory,
    snapshot,
    title: normalizeLiveSessionTitle(snapshot.title),
    agentSessionStatus: toLiveAgentSessionRuntimeStatus(classification),
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
  };
};

export const toMissingRuntimeLiveSessionTruth = ({
  record,
  runtimeKind,
  reason,
}: {
  record: AgentSessionRecord;
  runtimeKind: RuntimeKind;
  reason: string;
}): LiveSessionTruth => ({
  type: "missing_runtime",
  classification: "persisted_only",
  externalSessionId: record.externalSessionId,
  runtimeKind,
  runtimeId: null,
  workingDirectory: record.workingDirectory,
  reason,
  pendingApprovals: EMPTY_PENDING_INPUT,
  pendingQuestions: EMPTY_PENDING_INPUT,
});

export const readResolvedLiveSessionTruth = async ({
  repoPath,
  externalSessionId,
  runtimeKind,
  runtimeId,
  workingDirectory,
  readSnapshot,
}: {
  repoPath: string;
  externalSessionId: string;
  runtimeKind: RuntimeKind;
  runtimeId: string | null;
  workingDirectory: string;
  readSnapshot: LiveSessionSnapshotReader;
}): Promise<LiveSessionTruth> => {
  const snapshot = await readSnapshot({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId,
  });
  return toLiveSessionTruthFromResolvedSnapshot({
    externalSessionId,
    runtimeKind,
    runtimeId,
    workingDirectory,
    snapshot,
  });
};

export const createLiveSessionTruthReader = ({
  repoPath,
  resolveHydrationRuntime,
  readSnapshot,
}: {
  repoPath: string;
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  readSnapshot: LiveSessionSnapshotReader;
}): ((record: AgentSessionRecord) => Promise<LiveSessionTruth>) => {
  return async (record) => {
    const runtimeResolution = await resolveHydrationRuntime(record);
    if (!runtimeResolution.ok) {
      return toMissingRuntimeLiveSessionTruth({
        record,
        runtimeKind: runtimeResolution.runtimeKind,
        reason: runtimeResolution.reason,
      });
    }

    return readResolvedLiveSessionTruth({
      repoPath,
      externalSessionId: record.externalSessionId,
      runtimeKind: runtimeResolution.runtimeKind,
      runtimeId: runtimeResolution.runtimeId,
      workingDirectory: runtimeResolution.workingDirectory,
      readSnapshot,
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
      runtimeKind: truth.runtimeKind,
      runtimeId: truth.runtimeId,
      workingDirectory: truth.workingDirectory,
      runtimeRecoveryState: "idle",
      status: truth.agentSessionStatus,
      ...(truth.title ? { title: truth.title } : {}),
      pendingApprovals: truth.pendingApprovals,
      pendingQuestions: truth.pendingQuestions,
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  if (truth.type === "missing_session") {
    return {
      ...current,
      status: current.status === "running" ? "idle" : current.status,
      runtimeKind: truth.runtimeKind,
      runtimeId: options.missingSessionRuntimeId ?? truth.runtimeId,
      workingDirectory: truth.workingDirectory,
      pendingApprovals: [],
      pendingQuestions: [],
      ...promptOverridesPatch,
      selectedModel,
    };
  }

  return {
    ...current,
    runtimeKind: truth.runtimeKind,
    runtimeId: null,
    workingDirectory: truth.workingDirectory,
    pendingApprovals: [],
    pendingQuestions: [],
    ...promptOverridesPatch,
    selectedModel,
  };
};
