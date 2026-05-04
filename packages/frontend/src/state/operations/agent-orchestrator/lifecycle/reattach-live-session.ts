import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  applyLiveSessionTruthToSession,
  isAttachableLiveSessionTruth,
  type LiveSessionTruth,
} from "./live-session-truth";

const STALE_REPO_ABORT = Symbol("stale-repo-abort");

type CreateReattachLiveSessionArgs = {
  adapter: {
    hasSession?: (externalSessionId: string) => boolean;
  };
  repoPath: string;
  updateSession: (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener?: (repoPath: string, externalSessionId: string) => void;
  promptOverrides: import("@openducktor/contracts").RepoPromptOverrides;
  readLiveSessionTruth: (record: AgentSessionRecord) => Promise<LiveSessionTruth>;
  attachMissingLiveSession?: (input: {
    record: AgentSessionRecord;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  }) => Promise<void>;
  allowAttachMissingSession?: boolean;
  isStaleRepoOperation: () => boolean;
};

export const createReattachLiveSession = ({
  adapter,
  repoPath,
  updateSession,
  attachSessionListener,
  promptOverrides,
  readLiveSessionTruth,
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
    const liveSessionTruth = await awaitUnlessStale(readLiveSessionTruth(record));
    if (liveSessionTruth === STALE_REPO_ABORT) {
      return false;
    }
    if (!isAttachableLiveSessionTruth(liveSessionTruth)) {
      return false;
    }

    const selectedModel = normalizePersistedSelection(record.selectedModel);
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
          runtimeKind: liveSessionTruth.runtimeKind,
          workingDirectory: liveSessionTruth.workingDirectory,
        }),
      );
      if (resumeResult === STALE_REPO_ABORT) {
        return false;
      }
    }

    if (isStaleRepoOperation()) {
      return false;
    }
    attachSessionListener(repoPath, record.externalSessionId);
    updateSession(
      record.externalSessionId,
      (current) =>
        applyLiveSessionTruthToSession(current, liveSessionTruth, {
          promptOverrides,
          selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
        }),
      { persist: false },
    );
    return true;
  };
};
