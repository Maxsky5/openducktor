import {
  type AgentEnginePort,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { agentSessionIdentityKey, matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { AgentMessageSendError } from "@/lib/agent-message-send-error";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { getAcceptedMessageAfterSendFailure } from "@/state/agent-runtime-services";
import { HostInvokeError } from "@openducktor/host-client";
import type {
  AgentChatMessage,
  AgentMessageSendOptions,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createRepoStaleGuard, now, throwIfRepoStale } from "../support/core";
import {
  appendSessionMessage,
  someSessionMessage,
  upsertUserSessionMessage,
} from "../support/messages";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "../support/session-invariants";
import { removeRunningSessionCompactionNotices } from "../support/session-notice-messages";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";
import { toUserChatMessage } from "../support/user-message-event";
import { applyAsyncQuestionUserMessage } from "../support/async-questions";
import type { PreparedSessionSend } from "./prepare-session-send";

export type SendAgentMessageDependencies = {
  workspaceRepoPath: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  adapter: Pick<AgentEnginePort, "sendUserMessage" | "resumeSession">;
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
  updateSession(session, (current) =>
    current.status === "starting" && current.executionEpisodeId === session.executionEpisodeId
      ? {
          ...current,
          status,
          runtimeStatusMessage: null,
        }
      : current,
  );
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

const rejectSendWhileWaitingForInput = (
  session: AgentSessionState,
  dependencies: Pick<SendAgentMessageDependencies, "readSessionSnapshot" | "updateSession">,
): never => {
  settleStartingSession(
    session,
    "idle",
    dependencies.readSessionSnapshot,
    dependencies.updateSession,
  );
  throw new Error(
    "Cannot send a message while the session is waiting for a blocking request. Answer or reject the blocking request first.",
  );
};

const markSessionRunningForSend = (
  session: AgentSessionState,
  dependencies: Pick<
    SendAgentMessageDependencies,
    "recordTurnUserMessageTimestamp" | "turnMetadata" | "updateSession"
  >,
): number => {
  const sessionKey = agentSessionIdentityKey(session);
  const selectedModel = session.selectedModel ?? undefined;
  const pendingUserMessageStartedAt = Date.now();
  dependencies.recordTurnUserMessageTimestamp(sessionKey, pendingUserMessageStartedAt);
  dependencies.turnMetadata.recordModel(sessionKey, selectedModel ?? null);
  dependencies.updateSession(session, (current) => ({
    ...current,
    status: "running",
    runtimeStatusMessage: null,
    pendingUserMessageStartedAt,
  }));
  return pendingUserMessageStartedAt;
};

const appendSendFailureNotice = (
  session: AgentSessionState,
  message: string,
  updateSession: UpdateSession,
  removeRunningCompactionNotice: boolean,
  errorAttentionId?: string,
): void => {
  const meta: Extract<
    NonNullable<AgentChatMessage["meta"]>,
    { kind: "session_notice"; reason: "session_error" }
  > = {
    kind: "session_notice",
    tone: "error",
    reason: "session_error",
    title: "Error",
  };
  if (errorAttentionId) {
    meta.attentionId = errorAttentionId;
  }
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
        content: message,
        timestamp: now(),
        meta,
      },
    ),
  }));
};

const upsertAcceptedUserMessage = (
  session: AgentSessionState,
  acceptedUserMessage: Awaited<ReturnType<AgentEnginePort["sendUserMessage"]>>,
  updateSession: UpdateSession,
): void => {
  updateSession(session, (current) => {
    const asyncState = applyAsyncQuestionUserMessage(
      {
        pendingAsyncQuestions: current.pendingAsyncQuestions ?? [],
        handledAsyncQuestionIds: current.handledAsyncQuestionIds ?? new Set(),
      },
      acceptedUserMessage.asyncQuestionReplies,
    );
    return {
      ...current,
      ...asyncState,
      messages: upsertUserSessionMessage(current, toUserChatMessage(acceptedUserMessage)),
    };
  });
};

export const createSendAgentMessage = (dependencies: SendAgentMessageDependencies) => {
  return async (
    identity: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ): Promise<void> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts, {
      preserveTextWhitespace: options?.preserveTextWhitespace ?? false,
    });
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return;
    }
    const isManualCompactionSend =
      classifySystemSlashCommandInvocation(normalizedParts).kind === "manual_session_compaction";

    let currentSession = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    const externalSessionId = currentSession.externalSessionId;
    if (currentSession.status === "stopped") {
      const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
      const isRepoStale = createRepoStaleGuard({
        repoPath,
        repoEpochRef: dependencies.repoEpochRef,
        currentWorkspaceRepoPathRef: dependencies.currentWorkspaceRepoPathRef,
      });
      const staleError = "Workspace changed while resuming the session.";
      throwIfRepoStale(isRepoStale, staleError);
      const stoppedSession = currentSession;
      const resumeInput: Parameters<typeof dependencies.adapter.resumeSession>[0] = {
        ...toBoundRuntimeSessionRef(repoPath, stoppedSession, "resume session"),
        resumeMode: "reattach",
      };
      const resumed = await dependencies.adapter.resumeSession(resumeInput);
      throwIfRepoStale(isRepoStale, staleError);
      if (!matchesAgentSessionIdentity(resumed, stoppedSession)) {
        throw new Error(`The runtime resumed a different session than '${externalSessionId}'.`);
      }
      dependencies.updateSession(stoppedSession, (current) =>
        current.status === "stopped" &&
        current.executionEpisodeId === stoppedSession.executionEpisodeId
          ? { ...current, status: resumed.status, runtimeStatusMessage: null }
          : current,
      );
      currentSession = requireLoadedSession(dependencies.readSessionSnapshot, identity);
      if (currentSession.status === "stopped") {
        throw new Error(`Session '${externalSessionId}' is still stopped after resume.`);
      }
    }
    if (isAgentSessionWaitingInput(currentSession)) {
      rejectSendWhileWaitingForInput(currentSession, dependencies);
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
      if (!readySession) {
        settleStartingSession(
          currentSession,
          "idle",
          dependencies.readSessionSnapshot,
          dependencies.updateSession,
        );
        return;
      }
      rejectSendWhileWaitingForInput(readySession, dependencies);
    }

    const isBusyQueuedSend = readySession.status === "running";
    const sendAttempt = isBusyQueuedSend
      ? undefined
      : markSessionRunningForSend(readySession, dependencies);

    try {
      const runtimeSessionRef = toBoundRuntimeSessionRef(
        requireWorkspaceRepoPath(dependencies.workspaceRepoPath),
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
      const acceptedMessage =
        error instanceof HostInvokeError
          ? getAcceptedMessageAfterSendFailure(error, {
              repoPath: requireWorkspaceRepoPath(dependencies.workspaceRepoPath),
              runtimeKind: readySession.runtimeKind,
              workingDirectory: readySession.workingDirectory,
              externalSessionId,
            })
          : null;
      if (acceptedMessage) {
        if (!isManualCompactionSend) {
          upsertAcceptedUserMessage(readySession, acceptedMessage, dependencies.updateSession);
        }
        appendSendFailureNotice(
          readySession,
          errorMessage(error),
          dependencies.updateSession,
          false,
          options?.errorAttentionId,
        );
        return;
      }
      let settledOwnAttempt = false;
      dependencies.updateSession(readySession, (current) => {
        if (
          isBusyQueuedSend ||
          current.executionEpisodeId !== readySession.executionEpisodeId ||
          current.pendingUserMessageStartedAt !== sendAttempt
        )
          return current;
        settledOwnAttempt = true;
        return {
          ...current,
          status: readySession.status === "starting" ? "idle" : readySession.status,
          runtimeStatusMessage: null,
          pendingUserMessageStartedAt: undefined,
        };
      });
      appendSendFailureNotice(
        readySession,
        `Failed to send message: ${errorMessage(error)}`,
        dependencies.updateSession,
        isManualCompactionSend && !isBusyQueuedSend,
        options?.errorAttentionId,
      );
      if (settledOwnAttempt) {
        dependencies.clearSessionTurnState(readySession);
      }
      const errorAttentionId = options?.errorAttentionId;
      const failedSession = dependencies.readSessionSnapshot(readySession);
      if (
        errorAttentionId &&
        failedSession &&
        someSessionMessage(
          failedSession,
          (message) =>
            message.meta?.kind === "session_notice" &&
            message.meta.reason === "session_error" &&
            message.meta.attentionId === errorAttentionId,
        )
      ) {
        throw new AgentMessageSendError(error, errorAttentionId);
      }
      throw error;
    }
  };
};
