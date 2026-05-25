import type { AgentSessionRecord } from "@openducktor/contracts";
import { createSessionMessagesState, getSessionMessagesSlice } from "../support/messages";
import { normalizePersistedSelection } from "../support/models";
import { historyToChatMessages } from "../support/persistence";
import type { HydratedRecordHistoryState } from "./load-sessions-hydrated-history-application";
import type { SuccessfulHydrationRuntime } from "./load-sessions-runtime-resolution-stage";
import { INITIAL_SESSION_HISTORY_LIMIT } from "./load-sessions-stage-constants";
import type {
  HistoryHydrationStageInput,
  HydrationRuntimePlanner,
  SessionLifecycleAdapter,
  SubagentPendingInputHydrationMode,
} from "./load-sessions-stages";
import {
  EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY,
  loadHydratedSubagentPendingInputOverlay,
} from "./load-sessions-subagent-pending-input-hydration";

type LoadHydratedRecordHistoryInput = {
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  record: AgentSessionRecord;
  runtimeResolution: SuccessfulHydrationRuntime;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HistoryHydrationStageInput["promptAssembler"];
  getRepoPromptOverrides: HistoryHydrationStageInput["getRepoPromptOverrides"];
  subagentPendingInputMode: SubagentPendingInputHydrationMode;
};

export const loadHydratedRecordHistory = async ({
  repoPath,
  adapter,
  record,
  runtimeResolution,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
  subagentPendingInputMode,
}: LoadHydratedRecordHistoryInput): Promise<HydratedRecordHistoryState> => {
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

  return {
    promptOverrides,
    history,
    todos,
    runtimeResolution,
    hydratedMessages,
    hydratedSubagentPendingInputByExternalSessionId,
  };
};
