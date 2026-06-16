import type { TaskCard } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentUserMessagePart,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { toRuntimeSessionContextRef } from "../support/session-runtime-ref";
import {
  clearSessionTransientState,
  type SessionTransientState,
} from "../support/session-transient-state";
import { isWorkflowAgentSession } from "../support/workflow-session";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "./session-action-guards";

type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => AgentSessionState | null;

export type SendAgentMessageDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "sendUserMessage">;
  readSessionSnapshot: ReadSessionSnapshot;
  taskRef: { current: TaskCard[] };
  updateSession: UpdateSession;
  ensureSessionReady: (session: AgentSessionIdentity) => Promise<AgentSessionIdentity>;
  sessionTransientState: SessionTransientState;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
};

export const settleStartingSession = (
  identity: AgentSessionIdentity,
  status: Extract<AgentSessionState["status"], "idle" | "error">,
  readSessionSnapshot: ReadSessionSnapshot,
  updateSession: UpdateSession,
): void => {
  const session = readSessionSnapshot(identity);
  if (session?.status !== "starting") {
    return;
  }

  updateSession(
    session,
    (current) => ({
      ...current,
      status,
    }),
    { persist: false },
  );
};

const ensureSessionReadyForSend = async ({
  session,
  ensureSessionReady,
  readSessionSnapshot,
  updateSession,
}: {
  session: AgentSessionState;
  ensureSessionReady: (session: AgentSessionIdentity) => Promise<AgentSessionIdentity>;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
}): Promise<AgentSessionIdentity> => {
  try {
    return await ensureSessionReady(session);
  } catch (error) {
    settleStartingSession(session, "error", readSessionSnapshot, updateSession);
    throw error;
  }
};

const markSessionRunningForSend = (
  session: AgentSessionState,
  dependencies: Pick<
    SendAgentMessageDependencies,
    "recordTurnUserMessageTimestamp" | "sessionTransientState" | "updateSession"
  >,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  const selectedModel = session.selectedModel ?? undefined;
  const pendingUserMessageStartedAt = dependencies.recordTurnUserMessageTimestamp(
    sessionKey,
    Date.now(),
  );
  dependencies.sessionTransientState.turnMetadata.recordModel(sessionKey, selectedModel ?? null);
  dependencies.updateSession(
    session,
    (current) => ({
      ...current,
      status: "running",
      pendingUserMessageStartedAt,
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
    }),
    { persist: false },
  );
};

const appendSendFailureNotice = (
  session: AgentSessionState,
  message: string,
  updateSession: UpdateSession,
): void => {
  updateSession(
    session,
    (current) => ({
      ...current,
      messages: appendSessionMessage(current, {
        id: crypto.randomUUID(),
        role: "system",
        content: `Failed to send message: ${message}`,
        timestamp: now(),
        meta: {
          kind: "session_notice",
          tone: "error",
          reason: "session_error",
          title: "Error",
        },
      }),
    }),
    { persist: false },
  );
};

export const createSendAgentMessage = (dependencies: SendAgentMessageDependencies) => {
  return async (identity: AgentSessionIdentity, parts: AgentUserMessagePart[]): Promise<void> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts);
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }

    const currentSession = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    const externalSessionId = currentSession.externalSessionId;
    if (!isWorkflowAgentSession(currentSession)) {
      throw new Error(`Session '${externalSessionId}' is not a workflow session.`);
    }
    const task = dependencies.taskRef.current.find((entry) => entry.id === currentSession.taskId);
    if (task && !isRoleAvailableForTask(task, currentSession.role)) {
      throw new Error(unavailableRoleErrorMessage(task, currentSession.role));
    }
    if (isAgentSessionWaitingInput(currentSession)) {
      settleStartingSession(
        currentSession,
        "idle",
        dependencies.readSessionSnapshot,
        dependencies.updateSession,
      );
      return;
    }

    const readySessionIdentity = await ensureSessionReadyForSend({
      session: currentSession,
      ensureSessionReady: dependencies.ensureSessionReady,
      readSessionSnapshot: dependencies.readSessionSnapshot,
      updateSession: dependencies.updateSession,
    });

    const readySession = dependencies.readSessionSnapshot(readySessionIdentity);
    if (!readySession || isAgentSessionWaitingInput(readySession)) {
      settleStartingSession(
        readySessionIdentity,
        "idle",
        dependencies.readSessionSnapshot,
        dependencies.updateSession,
      );
      return;
    }

    const selectedModel = readySession.selectedModel ?? undefined;
    const isBusyQueuedSend = readySession.status === "running";
    if (!isBusyQueuedSend) {
      markSessionRunningForSend(readySession, dependencies);
    }

    try {
      const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
      await dependencies.adapter.sendUserMessage({
        ...toRuntimeSessionContextRef(repoPath, readySession),
        externalSessionId: readySession.externalSessionId,
        parts: normalizedParts,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
    } catch (error) {
      dependencies.updateSession(
        readySession,
        (current) => ({
          ...current,
          status: isBusyQueuedSend ? current.status : "error",
          pendingUserMessageStartedAt: undefined,
          ...(isBusyQueuedSend
            ? {}
            : {
                draftAssistantText: "",
                draftAssistantMessageId: null,
                draftReasoningText: "",
                draftReasoningMessageId: null,
              }),
        }),
        { persist: false },
      );
      appendSendFailureNotice(readySession, errorMessage(error), dependencies.updateSession);
      if (!isBusyQueuedSend) {
        clearSessionTransientState(dependencies.sessionTransientState, readySession);
      }
    }
  };
};
