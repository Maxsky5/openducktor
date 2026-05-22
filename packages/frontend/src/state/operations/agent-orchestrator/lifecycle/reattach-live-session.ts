import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
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
  updateSession: (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener?: (repoPath: string, externalSessionId: string) => void;
  promptOverrides: import("@openducktor/contracts").RepoPromptOverrides;
  readSessionPresence: (record: AgentSessionRecord) => Promise<AgentSessionPresenceSnapshot>;
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
      if (sessionPresence.presence === "runtime") {
        if (isStaleRepoOperation()) {
          return false;
        }
        updateSession(
          record.externalSessionId,
          (current) =>
            applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
              promptOverrides,
              selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
            }),
          { persist: false },
        );
      }
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
    attachSessionListener(repoPath, record.externalSessionId);
    updateSession(
      record.externalSessionId,
      (current) =>
        applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
          promptOverrides,
          selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
        }),
      { persist: false },
    );
    return true;
  };
};
