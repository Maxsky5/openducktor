import type { AgentSessionRecord, RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import { hasPendingOutboundSend } from "../support/pending-outbound-send";
import {
  type AgentSessionPresenceSnapshot,
  applyAgentSessionPresenceSnapshotToSession,
  isAttachableAgentSessionPresenceSnapshot,
} from "./session-presence";

const STALE_REPO_ABORT = Symbol("stale-repo-abort");

type CreateReattachLiveSessionArgs = {
  adapter: {
    hasSession?: (externalSessionId: string) => boolean;
  };
  repoPath: string;
  getCurrentSession: (externalSessionId: string) => AgentSessionState | null;
  updateSession: (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener?: (repoPath: string, externalSessionId: string) => void;
  promptOverrides: RepoPromptOverrides;
  readSessionPresence: (record: AgentSessionRecord) => Promise<AgentSessionPresenceSnapshot>;
  attachMissingLiveSession?: (input: {
    record: AgentSessionRecord;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  }) => Promise<void>;
  allowAttachMissingSession?: boolean;
  isStaleRepoOperation: () => boolean;
};

const canAdoptRuntimePresence = (current: AgentSessionState): boolean => {
  if (current.status === "idle" || current.status === "error") {
    return current.pendingApprovals.length > 0 || current.pendingQuestions.length > 0;
  }
  return true;
};

const shouldSettleNonLivePresence = (current: AgentSessionState): boolean =>
  current.status === "running" && !hasPendingOutboundSend(current);

const applyRuntimeIdentityFromPresence = (
  current: AgentSessionState,
  snapshot: Extract<AgentSessionPresenceSnapshot, { presence: "runtime" }>,
  {
    promptOverrides,
    selectedModel,
  }: {
    promptOverrides: RepoPromptOverrides;
    selectedModel: AgentSessionState["selectedModel"];
  },
): AgentSessionState => ({
  ...current,
  runtimeKind: snapshot.ref.runtimeKind,
  runtimeId: snapshot.runtimeId,
  workingDirectory: snapshot.ref.workingDirectory,
  runtimeRecoveryState: "idle",
  promptOverrides,
  selectedModel,
});

const canApplyNonAttachablePresence = (
  current: AgentSessionState,
  snapshot: AgentSessionPresenceSnapshot,
): boolean => {
  if (shouldSettleNonLivePresence(current)) {
    return true;
  }
  return snapshot.presence === "runtime" && canAdoptRuntimePresence(current);
};

export const createReattachLiveSession = ({
  adapter,
  repoPath,
  getCurrentSession,
  updateSession,
  attachSessionListener,
  promptOverrides,
  readSessionPresence,
  attachMissingLiveSession,
  allowAttachMissingSession = true,
  isStaleRepoOperation,
}: CreateReattachLiveSessionArgs) => {
  const awaitUnlessStale = async <T>(
    operation: Promise<T>,
  ): Promise<T | typeof STALE_REPO_ABORT> => {
    const result = await operation;
    return isStaleRepoOperation() ? STALE_REPO_ABORT : result;
  };

  return async (record: AgentSessionRecord): Promise<boolean> => {
    if (typeof adapter.hasSession !== "function" || !attachSessionListener) {
      return false;
    }

    const attachedExistingSession = adapter.hasSession(record.externalSessionId);
    const sessionPresence = await awaitUnlessStale(readSessionPresence(record));
    if (sessionPresence === STALE_REPO_ABORT) {
      return false;
    }
    const selectedModel = normalizePersistedSelection(record.selectedModel);
    if (!isAttachableAgentSessionPresenceSnapshot(sessionPresence)) {
      const currentSession = getCurrentSession(record.externalSessionId);
      if (
        !currentSession ||
        !canApplyNonAttachablePresence(currentSession, sessionPresence) ||
        isStaleRepoOperation()
      ) {
        return false;
      }
      updateSession(
        record.externalSessionId,
        (current) => {
          const mergedSelectedModel = mergeModelSelection(
            current.selectedModel,
            selectedModel ?? undefined,
          );
          if (shouldSettleNonLivePresence(current)) {
            return applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
              promptOverrides,
              selectedModel: mergedSelectedModel,
            });
          }
          if (sessionPresence.presence === "runtime" && canAdoptRuntimePresence(current)) {
            return applyRuntimeIdentityFromPresence(current, sessionPresence, {
              promptOverrides,
              selectedModel: mergedSelectedModel,
            });
          }
          return current;
        },
        { persist: false },
      );
      return false;
    }
    const currentSession = getCurrentSession(record.externalSessionId);
    if (!currentSession || !canAdoptRuntimePresence(currentSession)) {
      return false;
    }

    if (!attachedExistingSession) {
      if (!allowAttachMissingSession) {
        return false;
      }
      if (!attachMissingLiveSession) {
        throw new Error(
          `Cannot reattach live session ${record.externalSessionId} without an attachMissingLiveSession handler.`,
        );
      }
      const resumeResult = await awaitUnlessStale(
        attachMissingLiveSession({
          record,
          runtimeKind: sessionPresence.ref.runtimeKind,
          workingDirectory: sessionPresence.ref.workingDirectory,
        }),
      );
      if (resumeResult === STALE_REPO_ABORT) {
        return false;
      }
    }

    if (isStaleRepoOperation()) {
      return false;
    }
    let adoptedRuntimePresence = false;
    updateSession(
      record.externalSessionId,
      (current) => {
        if (!canAdoptRuntimePresence(current)) {
          return current;
        }
        adoptedRuntimePresence = true;
        return applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
          promptOverrides,
          selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
        });
      },
      { persist: false },
    );
    if (adoptedRuntimePresence) {
      attachSessionListener(repoPath, record.externalSessionId);
    }
    return adoptedRuntimePresence;
  };
};
