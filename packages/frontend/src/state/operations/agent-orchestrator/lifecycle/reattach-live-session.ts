import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

const STALE_REPO_ABORT = Symbol("stale-repo-abort");
const normalizeLiveSessionTitle = (title: string): string | undefined => {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

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
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  listLiveAgentSessions: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    directories: string[],
  ) => Promise<LiveAgentSessionSnapshot[]>;
  attachMissingLiveSession?: (input: {
    record: AgentSessionRecord;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  }) => Promise<void>;
  allowAttachMissingSession?: boolean;
  isStaleRepoOperation: () => boolean;
  toLiveSessionState: (status: LiveAgentSessionSnapshot["status"]) => AgentSessionState["status"];
};

export const createReattachLiveSession = ({
  adapter,
  repoPath,
  updateSession,
  attachSessionListener,
  promptOverrides,
  resolveHydrationRuntime,
  listLiveAgentSessions,
  attachMissingLiveSession,
  allowAttachMissingSession = true,
  isStaleRepoOperation,
  toLiveSessionState,
}: CreateReattachLiveSessionArgs) => {
  const isAttachableLiveSnapshot = (snapshot: LiveAgentSessionSnapshot): boolean => {
    if (snapshot.pendingPermissions.length > 0 || snapshot.pendingQuestions.length > 0) {
      return true;
    }

    return snapshot.status.type !== "idle";
  };

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

    const runtimeResolution = await awaitUnlessStale(resolveHydrationRuntime(record));
    if (runtimeResolution === STALE_REPO_ABORT) {
      return false;
    }
    if (!runtimeResolution.ok) {
      return false;
    }

    const externalSessionId = record.externalSessionId;
    const attachedExistingSession = adapter.hasSession(record.externalSessionId);
    const liveAgentSessions = await awaitUnlessStale(
      listLiveAgentSessions(repoPath, runtimeResolution.runtimeKind, record.workingDirectory, [
        record.workingDirectory,
      ]),
    );
    if (liveAgentSessions === STALE_REPO_ABORT) {
      return false;
    }
    const liveSession = liveAgentSessions.find(
      (session) => session.externalSessionId === externalSessionId,
    );
    if (!liveSession || !isAttachableLiveSnapshot(liveSession)) {
      return false;
    }

    const nextStatus = toLiveSessionState(liveSession.status);
    const liveSessionTitle = normalizeLiveSessionTitle(liveSession.title);
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
          runtimeKind: runtimeResolution.runtimeKind,
          workingDirectory: runtimeResolution.workingDirectory,
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
      (current) => ({
        ...current,
        runtimeKind: runtimeResolution.runtimeKind,
        runtimeId: runtimeResolution.runtimeId,
        runtimeRoute: null,
        workingDirectory: runtimeResolution.workingDirectory,
        runtimeRecoveryState: "idle",
        status: nextStatus,
        ...(liveSessionTitle ? { title: liveSessionTitle } : {}),
        pendingPermissions: liveSession.pendingPermissions,
        pendingQuestions: liveSession.pendingQuestions,
        promptOverrides,
        selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
      }),
      { persist: false },
    );
    return true;
  };
};
