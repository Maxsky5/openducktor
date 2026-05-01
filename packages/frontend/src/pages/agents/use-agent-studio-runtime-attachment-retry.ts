import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import {
  haveSameRuntimeAttachmentCandidates,
  type RuntimeAttachmentCandidate,
  type RuntimeAttachmentSource,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
  useRuntimeAttachmentRetry,
} from "@/state/operations/shared/runtime-attachment-retry";

export {
  haveSameRuntimeAttachmentCandidates,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
};

export function useAgentStudioRuntimeAttachmentRetry({
  activeTaskId,
  activeExternalSessionId,
  shouldWaitForSessionRuntime,
  activeRuntimeAttachmentKey,
  runtimeAttachmentCandidates,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  repoReadinessState,
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
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  repoReadinessState: SessionRepoReadinessState;
}): void {
  useRuntimeAttachmentRetry({
    activeRuntimeAttachmentKey,
    activeExternalSessionId,
    activeTaskId,
    ensureSessionReadyForView,
    repoReadinessState,
    runtimeAttachmentCandidates,
    shouldWaitForSessionRuntime,
    refreshRuntimeAttachmentSources,
  });
}

export type { RuntimeAttachmentCandidate, RuntimeAttachmentSource };
