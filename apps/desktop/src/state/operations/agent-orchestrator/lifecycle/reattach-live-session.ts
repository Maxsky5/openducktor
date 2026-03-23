import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";

type CreateReattachLiveSessionArgs = {
  adapter: {
    hasSession?: (sessionId: string) => boolean;
  };
  repoPath: string;
  taskId: string;
  taskRef: { current: TaskCard[] };
  sessionsRef: { current: Record<string, AgentSessionState> };
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

const preferLivePendingInput = <T>(liveValue: T[], currentValue: T[]): T[] => {
  if (liveValue.length > 0) {
    return liveValue;
  }
  return currentValue;
};

export const createReattachLiveSession = ({
  adapter,
  repoPath,
  taskId: _taskId,
  taskRef: _taskRef,
  sessionsRef: _sessionsRef,
  updateSession,
  attachSessionListener,
  promptOverrides,
  resolveHydrationRuntime,
  listLiveAgentSessions,
  resumeMissingLiveSession,
  isStaleRepoOperation: _isStaleRepoOperation,
  toLiveSessionState,
}: CreateReattachLiveSessionArgs) => {
  return async (record: AgentSessionRecord): Promise<void> => {
    if (typeof adapter.hasSession !== "function" || !attachSessionListener) {
      return;
    }

    const runtimeResolution = await resolveHydrationRuntime(record);
    if (!runtimeResolution.ok) {
      return;
    }

    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const attachedExistingSession = adapter.hasSession(record.sessionId);
    const liveAgentSessions = await listLiveAgentSessions(
      runtimeResolution.runtimeKind,
      runtimeResolution.runtimeConnection,
      [record.workingDirectory],
    );
    const liveSession = liveAgentSessions.find(
      (session) => session.externalSessionId === externalSessionId,
    );
    if (!liveSession) {
      return;
    }

    const nextStatus = toLiveSessionState(liveSession.status);
    const selectedModel = normalizePersistedSelection(record.selectedModel);
    if (!attachedExistingSession) {
      if (!resumeMissingLiveSession) {
        throw new Error(
          `Cannot reattach live session ${record.sessionId} without a resumeMissingLiveSession handler.`,
        );
      }
      await resumeMissingLiveSession({
        record,
        runtimeKind: runtimeResolution.runtimeKind,
        runtimeConnection: runtimeResolution.runtimeConnection,
      });
    }

    attachSessionListener(repoPath, record.sessionId);
    updateSession(
      record.sessionId,
      (current) => ({
        ...current,
        runtimeKind: runtimeResolution.runtimeKind,
        runtimeId: runtimeResolution.runtimeId,
        runId: runtimeResolution.runId,
        runtimeEndpoint: runtimeResolution.runtimeEndpoint,
        workingDirectory: runtimeResolution.runtimeConnection.workingDirectory,
        status: nextStatus,
        pendingPermissions: preferLivePendingInput(
          liveSession.pendingPermissions,
          current.pendingPermissions,
        ),
        pendingQuestions: preferLivePendingInput(
          liveSession.pendingQuestions,
          current.pendingQuestions,
        ),
        promptOverrides,
        selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
      }),
      { persist: false },
    );
  };
};
