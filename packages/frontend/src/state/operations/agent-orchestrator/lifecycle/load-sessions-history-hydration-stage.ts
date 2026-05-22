import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeHydratedMessages } from "../support/hydrated-message-merge";
import {
  createSessionMessagesState,
  forEachSessionMessage,
  getSessionMessagesSlice,
} from "../support/messages";
import { normalizePersistedSelection } from "../support/models";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import {
  EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  mergeSubagentPendingApprovalOverlay,
  mergeSubagentPendingQuestionOverlay,
  type SubagentPendingApprovalsByExternalSessionId,
  type SubagentPendingQuestionsByExternalSessionId,
} from "../support/subagent-approval-overlay";
import { isSubagentMessage } from "../support/subagent-messages";
import {
  type ResolvedHydrationRuntime,
  readPlannerAgentSessionPresenceSnapshot,
} from "./load-sessions-runtime-resolution-stage";
import {
  EMPTY_PROMPT_OVERRIDES,
  INITIAL_SESSION_HISTORY_LIMIT,
  SESSION_HISTORY_HYDRATION_CONCURRENCY,
} from "./load-sessions-stage-constants";
import type {
  HistoryHydrationStageInput,
  HydrationRuntimePlanner,
  SessionLifecycleAdapter,
  SubagentPendingInputHydrationMode,
  UpdateSession,
} from "./load-sessions-stages";

type SuccessfulHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: true }>;
type FailedHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: false }>;

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

type HydratedRecordHistoryState = {
  promptOverrides: Awaited<ReturnType<HistoryHydrationStageInput["getRepoPromptOverrides"]>>;
  history: Awaited<ReturnType<SessionLifecycleAdapter["loadSessionHistory"]>>;
  todos: Awaited<ReturnType<AgentEnginePort["loadSessionTodos"]>>;
  runtimeResolution: SuccessfulHydrationRuntime;
  hydratedMessages: AgentSessionState["messages"];
  hydratedSubagentPendingInputByExternalSessionId: HydratedSubagentPendingInputOverlay;
};

type HydratedSubagentPendingInputOverlay = {
  scannedChildExternalSessionIds: string[];
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId;
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId;
  hydrationError: SubagentPendingInputHydrationError | null;
};

class SubagentPendingInputHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentPendingInputHydrationError";
  }
}

const EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY = Object.freeze({
  scannedChildExternalSessionIds: [],
  pendingApprovalsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  pendingQuestionsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  hydrationError: null,
}) satisfies HydratedSubagentPendingInputOverlay;

const readSubagentSessionIds = (
  externalSessionId: string,
  messages: AgentSessionState["messages"],
): string[] => {
  const externalSessionIds = new Set<string>();
  forEachSessionMessage({ externalSessionId, messages }, (message) => {
    if (!isSubagentMessage(message)) {
      return;
    }
    const subagentSessionId = message.meta.externalSessionId?.trim();
    if (subagentSessionId) {
      externalSessionIds.add(subagentSessionId);
    }
  });
  return Array.from(externalSessionIds);
};

const toHydratedSubagentPendingInputOverlay = (
  scannedChildExternalSessionIds: string[],
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId,
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId,
  hydrationError: SubagentPendingInputHydrationError | null = null,
): HydratedSubagentPendingInputOverlay => {
  if (scannedChildExternalSessionIds.length === 0 && hydrationError === null) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  }

  return {
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId:
      Object.keys(pendingApprovalsByChildExternalSessionId).length > 0
        ? pendingApprovalsByChildExternalSessionId
        : EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
    pendingQuestionsByChildExternalSessionId:
      Object.keys(pendingQuestionsByChildExternalSessionId).length > 0
        ? pendingQuestionsByChildExternalSessionId
        : EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
    hydrationError,
  };
};

const loadHydratedSubagentPendingInputOverlay = async ({
  record,
  messages,
  runtimePlanner,
}: {
  record: AgentSessionRecord;
  messages: AgentSessionState["messages"];
  runtimePlanner: HydrationRuntimePlanner;
}): Promise<HydratedSubagentPendingInputOverlay> => {
  const childExternalSessionIds = readSubagentSessionIds(record.externalSessionId, messages);
  if (childExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  }

  const results = await Promise.allSettled(
    childExternalSessionIds.map(async (childExternalSessionId) => {
      try {
        return {
          childExternalSessionId,
          snapshot: await readPlannerAgentSessionPresenceSnapshot(runtimePlanner, {
            ...record,
            externalSessionId: childExternalSessionId,
          }),
        };
      } catch (error) {
        throw new Error(`subagent session '${childExternalSessionId}': ${errorMessage(error)}`);
      }
    }),
  );
  const pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId = {};
  const pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId = {};
  const scannedChildExternalSessionIds: string[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      failures.push(errorMessage(result.reason));
      continue;
    }
    const { childExternalSessionId, snapshot } = result.value;
    scannedChildExternalSessionIds.push(childExternalSessionId);
    if (snapshot.presence === "runtime" && snapshot.pendingApprovals.length > 0) {
      pendingApprovalsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingApprovals;
    }
    if (snapshot.presence === "runtime" && snapshot.pendingQuestions.length > 0) {
      pendingQuestionsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingQuestions;
    }
  }
  const hydrationError =
    failures.length > 0
      ? new SubagentPendingInputHydrationError(
          `Failed to hydrate subagent pending input: ${failures.join("; ")}`,
        )
      : null;

  return toHydratedSubagentPendingInputOverlay(
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId,
    pendingQuestionsByChildExternalSessionId,
    hydrationError,
  );
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

const applyHydratedRecordHistory = (
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
  const shouldHydrateSubagentPendingInput = subagentPendingInputMode === "hydrate";
  const { runtimeRef, workingDirectory } = runtimeResolution;
  const [promptOverrides, history, todos] = await Promise.all([
    getRepoPromptOverrides(),
    adapter.loadSessionHistory({
      repoPath,
      runtimeKind: runtimeRef.runtimeKind,
      workingDirectory,
      externalSessionId: record.externalSessionId,
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    }),
    adapter.loadSessionTodos
      ? adapter.loadSessionTodos({
          repoPath,
          runtimeKind: runtimeRef.runtimeKind,
          workingDirectory,
          externalSessionId: record.externalSessionId,
        })
      : Promise.resolve([]),
  ]);
  const preludeMessages = await promptAssembler.buildHydrationPreludeMessages({
    record,
    promptOverrides,
  });
  const selectedModel = normalizePersistedSelection(record.selectedModel);
  const hydratedMessages = createSessionMessagesState(record.externalSessionId, [
    ...getSessionMessagesSlice(
      {
        externalSessionId: record.externalSessionId,
        messages: preludeMessages,
      },
      0,
    ),
    ...historyToChatMessages(history, {
      role: record.role,
      selectedModel,
    }),
  ]);
  const hydratedSubagentPendingInputByExternalSessionId = shouldHydrateSubagentPendingInput
    ? await loadHydratedSubagentPendingInputOverlay({
        record,
        messages: hydratedMessages,
        runtimePlanner,
      })
    : EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  if (isStaleRepoOperation()) {
    return;
  }

  updateSession(
    record.externalSessionId,
    (current) =>
      applyHydratedRecordHistory(current, {
        promptOverrides,
        history,
        todos,
        runtimeResolution,
        hydratedMessages,
        hydratedSubagentPendingInputByExternalSessionId,
      }),
    { persist: false },
  );

  if (hydratedSubagentPendingInputByExternalSessionId.hydrationError) {
    throw hydratedSubagentPendingInputByExternalSessionId.hydrationError;
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
  if (isStaleRepoOperation()) {
    return;
  }

  if (!runtimeResolution.ok) {
    applyMissingHydrationRuntime({
      record,
      runtimeResolution,
      shouldHydrateHistory,
      failOnRuntimeResolutionError,
      updateSession,
    });
    return;
  }

  if (!shouldHydrateHistory) {
    await hydrateRuntimeOnlyRecord({
      updateSession,
      isStaleRepoOperation,
      record,
      runtimeResolution,
    });
    return;
  }

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
