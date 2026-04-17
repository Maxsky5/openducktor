import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { getRuntimeConnectionSupportError } from "../runtime/runtime";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

const STALE_REPO_ABORT = Symbol("stale-repo-abort");

type CreateReattachLiveSessionArgs = {
  adapter: {
    hasSession?: (sessionId: string) => boolean;
  };
  repoPath: string;
  updateSession: (
    sessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
    options?: { persist?: boolean },
  ) => void;
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
  promptOverrides: import("@openducktor/contracts").RepoPromptOverrides;
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  listLiveAgentSessions: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    directories: string[],
  ) => Promise<LiveAgentSessionSnapshot[]>;
  resumeMissingLiveSession?: (input: {
    record: AgentSessionRecord;
    runtimeKind: RuntimeKind;
    runtimeConnection: AgentRuntimeConnection;
  }) => Promise<void>;
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
  resumeMissingLiveSession,
  isStaleRepoOperation,
  toLiveSessionState,
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

    const runtimeResolution = await awaitUnlessStale(resolveHydrationRuntime(record));
    if (runtimeResolution === STALE_REPO_ABORT) {
      return false;
    }
    if (!runtimeResolution.ok) {
      return false;
    }
    if (
      getRuntimeConnectionSupportError(
        runtimeResolution.runtimeKind,
        runtimeResolution.runtimeConnection,
        "live session discovery",
      )
    ) {
      return false;
    }

    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const attachedExistingSession = adapter.hasSession(record.sessionId);
    const liveAgentSessions = await awaitUnlessStale(
      listLiveAgentSessions(runtimeResolution.runtimeKind, runtimeResolution.runtimeConnection, [
        record.workingDirectory,
      ]),
    );
    if (liveAgentSessions === STALE_REPO_ABORT) {
      return false;
    }
    const liveSession = liveAgentSessions.find(
      (session) => session.externalSessionId === externalSessionId,
    );
    if (!liveSession) {
      return false;
    }

    const nextStatus = toLiveSessionState(liveSession.status);
    const selectedModel = normalizePersistedSelection(record.selectedModel);
    if (!attachedExistingSession) {
      if (!resumeMissingLiveSession) {
        throw new Error(
          `Cannot reattach live session ${record.sessionId} without a resumeMissingLiveSession handler.`,
        );
      }
      const resumeResult = await awaitUnlessStale(
        resumeMissingLiveSession({
          record,
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeConnection: runtimeResolution.runtimeConnection,
        }),
      );
      if (resumeResult === STALE_REPO_ABORT) {
        return false;
      }
    }

    if (isStaleRepoOperation()) {
      return false;
    }
    attachSessionListener(repoPath, record.sessionId);
    updateSession(
      record.sessionId,
      (current) => ({
        ...current,
        runtimeKind: runtimeResolution.runtimeKind,
        runtimeId: runtimeResolution.runtimeId,
        runId: runtimeResolution.runId,
        runtimeRoute: runtimeResolution.runtimeRoute,
        workingDirectory: runtimeResolution.runtimeConnection.workingDirectory,
        runtimeRecoveryState: "idle",
        status: nextStatus,
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
