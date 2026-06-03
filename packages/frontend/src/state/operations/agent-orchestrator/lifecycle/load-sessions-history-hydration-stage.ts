import type { AgentSessionRecord } from "@openducktor/contracts";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { applyHydratedRecordHistory } from "./load-sessions-hydrated-history-application";
import { loadHydratedRecordHistory } from "./load-sessions-record-history-loader";
import type {
  FailedHydrationRuntime,
  SuccessfulHydrationRuntime,
} from "./load-sessions-runtime-resolution-stage";
import {
  EMPTY_PROMPT_OVERRIDES,
  SESSION_HISTORY_HYDRATION_CONCURRENCY,
} from "./load-sessions-stage-constants";
import type {
  HistoryHydrationStageInput,
  HydrationRuntimePlanner,
  SessionLifecycleAdapter,
  SubagentPendingInputHydrationMode,
  UpdateSession,
} from "./load-sessions-stages";
import { SubagentPendingInputHydrationError } from "./load-sessions-subagent-pending-input-hydration";

type HydrateSessionRecordInput = {
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  shouldHydrateHistory: boolean;
  failOnRuntimeResolutionError: boolean;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HistoryHydrationStageInput["promptAssembler"];
  getRepoPromptOverrides: HistoryHydrationStageInput["getRepoPromptOverrides"];
  subagentPendingInputMode: SubagentPendingInputHydrationMode;
};

const markHistoryHydrationFailed = (
  externalSessionId: string,
  updateSession: UpdateSession,
  options?: { preserveSubagentPendingInput?: boolean },
): void => {
  updateSession(
    externalSessionId,
    (current) => ({
      ...current,
      historyHydrationState: "failed",
      subagentPendingApprovalsByExternalSessionId: options?.preserveSubagentPendingInput
        ? current.subagentPendingApprovalsByExternalSessionId
        : undefined,
      subagentPendingQuestionsByExternalSessionId: options?.preserveSubagentPendingInput
        ? current.subagentPendingQuestionsByExternalSessionId
        : undefined,
    }),
    { persist: false },
  );
};

const markRequestedHistoryHydrationInProgress = ({
  historyHydrationSessionIds,
  setSessionsById,
}: Pick<HistoryHydrationStageInput, "historyHydrationSessionIds" | "setSessionsById">): void => {
  if (historyHydrationSessionIds.size > 0) {
    setSessionsById((current) => {
      const next = { ...current };
      for (const externalSessionId of historyHydrationSessionIds) {
        const existingSession = next[externalSessionId];
        if (!existingSession) {
          continue;
        }
        next[externalSessionId] = {
          ...existingSession,
          historyHydrationState: "hydrating",
        };
      }
      return next;
    });
  }
};

const applyMissingHydrationRuntime = ({
  record,
  runtimeResolution,
  shouldHydrateHistory,
  failOnRuntimeResolutionError,
  updateSession,
}: {
  record: AgentSessionRecord;
  runtimeResolution: FailedHydrationRuntime;
  shouldHydrateHistory: boolean;
  failOnRuntimeResolutionError: boolean;
  updateSession: UpdateSession;
}): void => {
  if (shouldHydrateHistory) {
    markHistoryHydrationFailed(record.externalSessionId, updateSession);
    throw new Error(runtimeResolution.reason);
  }
  if (failOnRuntimeResolutionError) {
    throw new Error(runtimeResolution.reason);
  }
  updateSession(
    record.externalSessionId,
    (current) => ({
      ...current,
      runtimeKind: readPersistedRuntimeKind(record),
      runtimeId: null,
      workingDirectory: record.workingDirectory,
      promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
    }),
    { persist: false },
  );
};

const hydrateRuntimeOnlyRecord = async ({
  updateSession,
  isStaleRepoOperation,
  record,
  runtimeResolution,
}: {
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  runtimeResolution: SuccessfulHydrationRuntime;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const { runtimeRef, workingDirectory } = runtimeResolution;
  updateSession(
    record.externalSessionId,
    (current) => ({
      ...current,
      runtimeKind: runtimeRef.runtimeKind,
      workingDirectory,
      promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
    }),
    { persist: false },
  );
};

const hydrateRecordHistory = async ({
  repoPath,
  adapter,
  updateSession,
  isStaleRepoOperation,
  record,
  runtimeResolution,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
  subagentPendingInputMode,
}: Omit<HydrateSessionRecordInput, "shouldHydrateHistory" | "failOnRuntimeResolutionError"> & {
  runtimeResolution: SuccessfulHydrationRuntime;
}): Promise<void> => {
  const hydratedHistory = await loadHydratedRecordHistory({
    repoPath,
    adapter,
    record,
    runtimeResolution,
    runtimePlanner,
    promptAssembler,
    getRepoPromptOverrides,
    subagentPendingInputMode,
  });
  if (!isStaleRepoOperation()) {
    updateSession(
      record.externalSessionId,
      (current) => applyHydratedRecordHistory(current, hydratedHistory),
      { persist: false },
    );

    if (hydratedHistory.hydratedSubagentPendingInputByExternalSessionId.hydrationError) {
      throw hydratedHistory.hydratedSubagentPendingInputByExternalSessionId.hydrationError;
    }
  }
};

const hydrateSessionRecord = async ({
  repoPath,
  adapter,
  updateSession,
  isStaleRepoOperation,
  record,
  shouldHydrateHistory,
  failOnRuntimeResolutionError,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
  subagentPendingInputMode,
}: HydrateSessionRecordInput): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }
  const runtimeResolution = await runtimePlanner.resolveHydrationRuntime(record);
  if (!isStaleRepoOperation()) {
    if (!runtimeResolution.ok) {
      applyMissingHydrationRuntime({
        record,
        runtimeResolution,
        shouldHydrateHistory,
        failOnRuntimeResolutionError,
        updateSession,
      });
    } else if (!shouldHydrateHistory) {
      await hydrateRuntimeOnlyRecord({
        updateSession,
        isStaleRepoOperation,
        record,
        runtimeResolution,
      });
    } else {
      await hydrateRecordHistory({
        repoPath,
        adapter,
        updateSession,
        isStaleRepoOperation,
        record,
        runtimeResolution,
        runtimePlanner,
        promptAssembler,
        getRepoPromptOverrides,
        subagentPendingInputMode,
      });
    }
  }
};

export const hydrateSessionRecordsStage = async ({
  repoPath,
  adapter,
  setSessionsById,
  updateSession,
  isStaleRepoOperation,
  recordsToHydrate,
  historyHydrationSessionIds,
  failOnRuntimeResolutionError = false,
  subagentPendingInputMode = "skip",
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: HistoryHydrationStageInput): Promise<void> => {
  if (recordsToHydrate.length === 0) {
    return;
  }
  if (isStaleRepoOperation()) {
    return;
  }

  markRequestedHistoryHydrationInProgress({
    historyHydrationSessionIds,
    setSessionsById,
  });

  const processHydrationBatch = async (offset: number): Promise<void> => {
    if (offset >= recordsToHydrate.length) {
      return;
    }
    if (isStaleRepoOperation()) {
      return;
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    await Promise.all(
      batch.map((record) =>
        hydrateSessionRecord({
          repoPath,
          adapter,
          updateSession,
          isStaleRepoOperation,
          record,
          shouldHydrateHistory: historyHydrationSessionIds.has(record.externalSessionId),
          failOnRuntimeResolutionError,
          runtimePlanner,
          promptAssembler,
          getRepoPromptOverrides,
          subagentPendingInputMode,
        }).catch((error) => {
          if (historyHydrationSessionIds.has(record.externalSessionId)) {
            markHistoryHydrationFailed(record.externalSessionId, updateSession, {
              preserveSubagentPendingInput: error instanceof SubagentPendingInputHydrationError,
            });
          }
          throw error;
        }),
      ),
    );
    await processHydrationBatch(offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
  };

  await processHydrationBatch(0);
};
