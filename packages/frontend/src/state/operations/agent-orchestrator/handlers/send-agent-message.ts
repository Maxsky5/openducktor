import {
  type AgentEnginePort,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { now } from "../support/core";
import { appendSessionMessage, upsertUserSessionMessage } from "../support/messages";
import { type ReadSessionSnapshot, requireLoadedSession } from "../support/session-invariants";
import { removeRunningSessionCompactionNotices } from "../support/session-notice-messages";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";
import { toUserChatMessage } from "../support/user-message-event";
import type { PreparedSessionSend } from "./prepare-session-send";

export type SendAgentMessageDependencies = {
  adapter: Pick<AgentEnginePort, "sendUserMessage">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  prepareSessionSend: (
    session: AgentSessionState,
    options: { prepareWorkflowContext: boolean },
  ) => Promise<PreparedSessionSend>;
  turnMetadata: SessionTurnMetadata;
  clearSessionTurnState: (session: AgentSessionIdentity) => void;
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
  if (!session) {
    return;
  }

  settleLoadedStartingSession(session, status, updateSession);
};

export const settleLoadedStartingSession = (
  session: AgentSessionState,
  status: Extract<AgentSessionState["status"], "idle" | "error">,
  updateSession: UpdateSession,
): void => {
  if (session.status !== "starting") {
    return;
  }
  updateSession(session, (current) => ({
    ...current,
    status,
    runtimeStatusMessage: null,
  }));
};

const prepareIdleSessionForSend = async ({
  session,
  prepareSessionSend,
  readSessionSnapshot,
  updateSession,
}: {
  session: AgentSessionState;
  prepareSessionSend: SendAgentMessageDependencies["prepareSessionSend"];
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
}): Promise<PreparedSessionSend> => {
  try {
    return await prepareSessionSend(session, { prepareWorkflowContext: true });
  } catch (error) {
    settleStartingSession(session, "error", readSessionSnapshot, updateSession);
    throw error;
  }
};

const markSessionRunningForSend = (
  session: AgentSessionState,
  dependencies: Pick<
    SendAgentMessageDependencies,
    "recordTurnUserMessageTimestamp" | "turnMetadata" | "updateSession"
  >,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  const selectedModel = session.selectedModel ?? undefined;
  const pendingUserMessageStartedAt = dependencies.recordTurnUserMessageTimestamp(
    sessionKey,
    Date.now(),
  );
  dependencies.turnMetadata.recordModel(sessionKey, selectedModel ?? null);
  dependencies.updateSession(session, (current) => ({
    ...current,
    status: "running",
    runtimeStatusMessage: null,
    pendingUserMessageStartedAt,
  }));
};

const appendSendFailureNotice = (
  session: AgentSessionState,
  message: string,
  updateSession: UpdateSession,
  removeRunningCompactionNotice: boolean,
): void => {
  updateSession(session, (current) => ({
    ...current,
    messages: appendSessionMessage(
      {
        externalSessionId: current.externalSessionId,
        messages: removeRunningCompactionNotice
          ? removeRunningSessionCompactionNotices(current.messages)
          : current.messages,
      },
      {
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
      },
    ),
  }));
};

const upsertAcceptedUserMessage = (
  session: AgentSessionState,
  acceptedUserMessage: Awaited<ReturnType<AgentEnginePort["sendUserMessage"]>>,
  updateSession: UpdateSession,
): void => {
  updateSession(session, (current) => ({
    ...current,
    messages: upsertUserSessionMessage(current, toUserChatMessage(acceptedUserMessage)),
  }));
};

export const createSendAgentMessage = (dependencies: SendAgentMessageDependencies) => {
  return async (identity: AgentSessionIdentity, parts: AgentUserMessagePart[]): Promise<void> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts);
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }
    const isManualCompactionSend =
      classifySystemSlashCommandInvocation(normalizedParts).kind === "manual_session_compaction";

    const currentSession = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    const externalSessionId = currentSession.externalSessionId;
    if (currentSession.status === "stopped") {
      throw new Error(`Cannot send message to stopped session '${externalSessionId}'.`);
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

    const sessionWasBusy = currentSession.status === "running";
    const preparedSend = sessionWasBusy
      ? await dependencies.prepareSessionSend(currentSession, { prepareWorkflowContext: false })
      : await prepareIdleSessionForSend({
          session: currentSession,
          prepareSessionSend: dependencies.prepareSessionSend,
          readSessionSnapshot: dependencies.readSessionSnapshot,
          updateSession: dependencies.updateSession,
        });

    const readySession = dependencies.readSessionSnapshot(currentSession);
    if (!readySession || isAgentSessionWaitingInput(readySession)) {
      settleStartingSession(
        currentSession,
        "idle",
        dependencies.readSessionSnapshot,
        dependencies.updateSession,
      );
      return;
    }

    const isBusyQueuedSend = readySession.status === "running";
    if (!isBusyQueuedSend) {
      markSessionRunningForSend(readySession, dependencies);
    }

    try {
      const runtimeSessionRef = toBoundRuntimeSessionRef(
        preparedSend.repoPath,
        readySession,
        "send message",
      );
      const sendInput: Parameters<typeof dependencies.adapter.sendUserMessage>[0] = {
        ...runtimeSessionRef,
        parts: normalizedParts,
      };
      if (readySession.selectedModel) {
        sendInput.model = readySession.selectedModel;
      }
      if (preparedSend.systemPrompt !== undefined) {
        sendInput.systemPrompt = preparedSend.systemPrompt;
      }
      const acceptedUserMessage = await dependencies.adapter.sendUserMessage(sendInput);
      if (!isManualCompactionSend) {
        upsertAcceptedUserMessage(readySession, acceptedUserMessage, dependencies.updateSession);
      }
    } catch (error) {
      dependencies.updateSession(readySession, (current) => {
        if (isBusyQueuedSend) return { ...current, pendingUserMessageStartedAt: undefined };
        return {
          ...current,
          status: "error",
          runtimeStatusMessage: null,
          pendingUserMessageStartedAt: undefined,
        };
      });
      appendSendFailureNotice(
        readySession,
        errorMessage(error),
        dependencies.updateSession,
        isManualCompactionSend && !isBusyQueuedSend,
      );
      if (!isBusyQueuedSend) {
        dependencies.clearSessionTurnState(readySession);
      }
    }
  };
};
