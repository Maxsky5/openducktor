import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback } from "react";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import {
  haveSameRuntimeAttachmentCandidates,
  type RuntimeAttachmentCandidate,
  type RuntimeAttachmentSource,
  selectRuntimeAttachmentCandidates,
  useRuntimeAttachmentRetry,
} from "@/state/operations/shared/runtime-attachment-retry";
import type { AgentSessionHistoryPreludeMode } from "@/types/agent-orchestrator";

export { haveSameRuntimeAttachmentCandidates, selectRuntimeAttachmentCandidates };

export function useAgentChatRuntimeAttachmentRetry({
  activeTaskId,
  activeExternalSessionId,
  shouldWaitForSessionRuntime,
  activeRuntimeAttachmentKey,
  runtimeAttachmentCandidates,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  repoReadinessState,
  historyPreludeMode,
  allowLiveSessionResume,
  persistedRecords,
}: {
  activeTaskId: string;
  activeExternalSessionId: string | null;
  shouldWaitForSessionRuntime: boolean;
  activeRuntimeAttachmentKey: string | null;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  repoReadinessState: SessionRepoReadinessState;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
  allowLiveSessionResume?: boolean;
  persistedRecords?: AgentSessionRecord[];
}): void {
  const buildEnsureInputExtras = useCallback(
    () => ({
      ...(historyPreludeMode ? { historyPreludeMode } : {}),
      ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
      ...(persistedRecords ? { persistedRecords } : {}),
    }),
    [historyPreludeMode, allowLiveSessionResume, persistedRecords],
  );

  useRuntimeAttachmentRetry({
    activeRuntimeAttachmentKey,
    activeExternalSessionId,
    activeTaskId,
    ensureSessionReadyForView,
    repoReadinessState,
    runtimeAttachmentCandidates,
    shouldWaitForSessionRuntime,
    refreshRuntimeAttachmentSources,
    buildEnsureInputExtras,
  });
}

export type { RuntimeAttachmentCandidate, RuntimeAttachmentSource };
