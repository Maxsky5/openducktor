import { toast } from "sonner";
import {
  type AcceptedAgentInput,
  type AgentEnginePort,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  describeAgentSessionScope,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
  resolveAgentSessionAssociationTransition,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { AgentMessageSendError } from "@/lib/agent-message-send-error";
import { isAgentSessionBlockedOnInput } from "@/lib/agent-session-waiting-input";
import { errorMessage } from "@/lib/errors";
import { getAcceptedMessageAfterSendFailure } from "@/state/agent-runtime-services";
import type { AgentMessageSubmitInput } from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import type { AgentMessageQueuesStore } from "@/state/agent-message-queues-store";
import type {
  AgentChatMessage,
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { now } from "../support/core";
import { closeBackgroundQuestions } from "../support/background-questions";
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

const withSendScope = (
  session: AgentSessionState,
  sessionScope: AgentMessageSendOptions["sessionScope"],
): AgentSessionState => {
  if (!sessionScope) {
    return session;
  }
  const transition = resolveAgentSessionAssociationTransition(
    session.sessionAssociation,
    sessionScope,
  );
  if (transition.kind === "conflict") {
    throw new Error(
      `Cannot send message for session '${session.externalSessionId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match the requested ${describeAgentSessionScope(transition.incoming)}.`,
    );
  }
  return {
    ...session,
    sessionAssociation: transition.association,
  };
};

export type SendAgentMessageDependencies = {
  workspaceRepoPath: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
  adapter: Pick<AgentEnginePort, "submitUserMessage">;
  messageQueues: Pick<AgentMessageQueuesStore, "apply" | "getQueue">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
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
  if (session?.status !== "starting") {
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

export const appendSendFailureNotice = (
  session: AgentSessionIdentity,
  message: string,
  updateSession: UpdateSession,
  removeRunningCompactionNotice: boolean,
  errorAttentionId?: string,
  unresolvedSubmissionId?: string,
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
  if (unresolvedSubmissionId) meta.unresolvedSubmissionId = unresolvedSubmissionId;
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

export const upsertAcceptedUserMessage = (
  session: AgentSessionIdentity,
  acceptedUserMessage: AcceptedAgentInput,
  resolvedQuestionRequestIds: readonly string[] | undefined,
  updateSession: UpdateSession,
): void => {
  if (acceptedUserMessage.type === "command_accepted") return;
  const handledRequestIds =
    acceptedUserMessage.resolvedQuestionRequestIds ?? resolvedQuestionRequestIds ?? [];
  updateSession(session, (current) => ({
    ...current,
    ...closeBackgroundQuestions(current, handledRequestIds),
    messages: upsertUserSessionMessage(current, toUserChatMessage(acceptedUserMessage)),
  }));
};

export const createSendAgentMessage = (dependencies: SendAgentMessageDependencies) => {
  return async (
    identity: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ): Promise<AgentMessageSendReceipt | null> => {
    const normalizedParts = normalizeAgentUserMessageParts(parts, {
      preserveTextWhitespace: options?.preserveTextWhitespace ?? false,
    });
    if (!hasMeaningfulAgentUserMessageParts(normalizedParts)) {
      return null;
    }
    const isManualCompactionSend =
      classifySystemSlashCommandInvocation(normalizedParts).kind === "manual_session_compaction";

    const currentSession = withSendScope(
      requireLoadedSession(dependencies.readSessionSnapshot, identity),
      options?.sessionScope,
    );
    options?.assertCanSubmit?.(currentSession);
    const externalSessionId = currentSession.externalSessionId;
    if (isAgentSessionBlockedOnInput(currentSession)) {
      rejectSendWhileWaitingForInput(currentSession, dependencies);
    }

    const mode = options?.mode ?? "default";
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    const loadedReadySession = dependencies.readSessionSnapshot(currentSession);
    if (!loadedReadySession || isAgentSessionBlockedOnInput(loadedReadySession)) {
      if (!loadedReadySession) {
        settleStartingSession(
          currentSession,
          "idle",
          dependencies.readSessionSnapshot,
          dependencies.updateSession,
        );
        throw new Error(
          `Session '${externalSessionId}' is no longer available. Reopen the chat to send your draft.`,
        );
      }
      rejectSendWhileWaitingForInput(loadedReadySession, dependencies);
    }
    const readySession = withSendScope(loadedReadySession, options?.sessionScope);
    options?.assertCanSubmit?.(readySession);
    const runtimeSessionRef = toBoundRuntimeSessionRef(repoPath, readySession, "send message");

    // The host decides if the message starts a turn or waits in the queue. An idle session shows
    // the send as running until the host answers; a queued answer restores the previous state.
    const sessionIsRunning = readySession.status === "running";
    const sendAttempt = sessionIsRunning
      ? undefined
      : markSessionRunningForSend(readySession, dependencies);
    const resolvedQuestionRequestIds = undefined;

    let sentMessage: AcceptedAgentInput | null = null;
    const submissionId = crypto.randomUUID();
    dependencies.updateSession(readySession, (current) => ({
      ...current,
      pendingSubmissionId: submissionId,
    }));
    const acknowledgeAttempt = () =>
      dependencies.updateSession(readySession, (current) =>
        current.pendingSubmissionId === submissionId
          ? {
              ...current,
              pendingSubmissionId: undefined,
              pendingUserMessageStartedAt: undefined,
            }
          : current,
      );
    /** Returns the session to its state before this send marked it running. */
    const settleOwnAttempt = (): void => {
      let settledOwnAttempt = false;
      dependencies.updateSession(readySession, (current) => {
        if (
          current.pendingSubmissionId !== submissionId ||
          sessionIsRunning ||
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
          pendingSubmissionId: undefined,
        };
      });
      if (settledOwnAttempt) {
        dependencies.clearSessionTurnState(readySession);
      }
    };

    try {
      const submitInput: AgentMessageSubmitInput = {
        ...runtimeSessionRef,
        submissionId,
        mode,
        parts: normalizedParts,
      };
      const result = await dependencies.adapter.submitUserMessage(submitInput);
      if (result.kind === "acknowledged") {
        if (result.outcome === "uncertain")
          return { outcome: "uncertain", recipient: identity, submissionId };
        if (result.outcome === "queued") settleOwnAttempt();
        acknowledgeAttempt();
        return result.outcome === "queued"
          ? { outcome: "queued", recipient: identity }
          : {
              outcome: "acknowledged",
              recipient: identity,
              submissionId,
              postAcceptanceFailure: null,
            };
      }
      if (result.kind === "queued") {
        // The message waits in the queue, so the current turn and transcript stay unchanged.
        dependencies.messageQueues.apply(result.queue);
        settleOwnAttempt();
        acknowledgeAttempt();
        return { outcome: "queued", recipient: identity };
      }
      const acceptedUserMessage = result.acceptedMessage;
      sentMessage = acceptedUserMessage;
      acknowledgeAttempt();
      if (!isManualCompactionSend) {
        upsertAcceptedUserMessage(
          readySession,
          acceptedUserMessage,
          resolvedQuestionRequestIds,
          dependencies.updateSession,
        );
      }
      return {
        outcome: "accepted",
        recipient: identity,
        acceptedMessage: acceptedUserMessage,
        postAcceptanceFailure: null,
      };
    } catch (error) {
      const acceptedMessage =
        sentMessage ??
        (error instanceof HostInvokeError
          ? getAcceptedMessageAfterSendFailure(error, {
              repoPath,
              runtimeKind: readySession.runtimeKind,
              workingDirectory: readySession.workingDirectory,
              externalSessionId,
            })
          : null);
      if (acceptedMessage) {
        try {
          acknowledgeAttempt();
          if (!sentMessage && !isManualCompactionSend) {
            upsertAcceptedUserMessage(
              readySession,
              acceptedMessage,
              resolvedQuestionRequestIds,
              dependencies.updateSession,
            );
          }
          appendSendFailureNotice(
            readySession,
            errorMessage(error),
            dependencies.updateSession,
            false,
            options?.errorAttentionId,
          );
        } catch (updateError) {
          console.error(updateError);
          toast.error(`Message sent to '${externalSessionId}', but the chat update failed`, {
            description: errorMessage(error),
          });
        }
        return {
          outcome: "accepted",
          recipient: identity,
          acceptedMessage,
          postAcceptanceFailure: errorMessage(error),
        };
      }
      if (
        error instanceof HostInvokeError &&
        error.failure?.kind === "session_operation" &&
        error.failure.observation.nativeOutcome === "accepted"
      ) {
        acknowledgeAttempt();
        appendSendFailureNotice(
          readySession,
          errorMessage(error),
          dependencies.updateSession,
          false,
          options?.errorAttentionId,
        );
        return {
          outcome: "acknowledged",
          recipient: identity,
          submissionId,
          postAcceptanceFailure: errorMessage(error),
        };
      }
      const confirmedRejection =
        error instanceof HostInvokeError &&
        (error.failure?.kind === "workflow_intent_rejected" ||
          (error.failure?.kind === "session_operation" &&
            ["not_issued", "refused"].includes(error.failure.observation.nativeOutcome)));
      if (!confirmedRejection) {
        const queued = dependencies.messageQueues
          .getQueue(runtimeSessionRef)
          ?.entries.find((entry) => entry.submissionId === submissionId);
        if (queued?.state === "queued" || queued?.state === "editing") {
          settleOwnAttempt();
          acknowledgeAttempt();
          return { outcome: "queued", recipient: identity };
        }
        appendSendFailureNotice(
          readySession,
          `The host response was lost or delivery remains uncertain. Inspect this submission before sending it again. ${errorMessage(error)}`,
          dependencies.updateSession,
          false,
          options?.errorAttentionId,
          submissionId,
        );
        return { outcome: "uncertain", recipient: identity, submissionId };
      }
      settleOwnAttempt();
      acknowledgeAttempt();
      appendSendFailureNotice(
        readySession,
        `Failed to send message: ${errorMessage(error)}`,
        dependencies.updateSession,
        isManualCompactionSend && !sessionIsRunning,
        options?.errorAttentionId,
      );
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
