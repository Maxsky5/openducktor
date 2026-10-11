import type { WorkspaceSession } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentUserMessagePart,
  normalizeAgentUserMessageParts,
  sessionLaunchFailureMessage,
} from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useInterruptedTurnResume } from "@/components/features/agents/agent-chat/use-interrupted-turn-resume";
import { hasSettledLatestTurn } from "@/lib/agent-session-interrupted-turn";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import type { AgentChatSendTarget } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import { useAsyncActivityTracker } from "@/lib/use-async-activity-tracker";
import { getAgentSessionResumeFailureNotice } from "@/state/agent-runtime-services";
import { useAgentSessionsContext } from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession } from "@/state/app-state-provider";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { host } from "@/state/operations/host";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import type {
  AgentSessionIdentity,
  AgentMessageSendReceipt,
  AgentMessageSendOptions,
} from "@/types/agent-orchestrator";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { GitConflictRequestCancelled } from "@/features/git-conflict-resolution/conflict-assistance";
import { launchWorkspaceSession } from "./launch-workspace-session";

const CHAT_UNAVAILABLE = "The original chat is no longer available. Reopen it to send your draft.";
const CONFLICT_MESSAGE_NOT_ACCEPTED =
  "The agent did not accept a conflict message. Reopen the chat and try again.";

export function useWorkspaceSessionChatActions(
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
  isMounted: () => boolean,
) {
  const store = useAgentSessionsContext();
  const operations = useAgentOperations();
  const queryClient = useQueryClient();
  const title = workspaceSessionTitle(record);
  const isCurrentWorkspace = useCallback(
    () => store.getActivitySnapshot().workspaceRepoPath === workspace.repoPath,
    [store, workspace.repoPath],
  );
  // An existing session queues later sends in the host, so several sends can run at once.
  const activity = useAsyncActivityTracker();
  const activityKey = record.id;
  const { hasInFlight } = activity;
  const isSendInFlight = useCallback(() => hasInFlight(activityKey), [hasInFlight, activityKey]);
  const savingModel = useRef(false);
  const resuming = useRef(false);
  const [isStarting, setStarting] = useState(false);
  const [isSavingModel, setSavingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRecord = useRef(record);
  const recipientVersion = useRef(0);
  const ownedStartup = useRef(false);
  useLayoutEffect(() => {
    const previous = latestRecord.current;
    if (
      JSON.stringify([
        previous.id,
        previous.runtimeKind,
        previous.externalSessionId,
        previous.executionTarget,
        previous.archivedAt,
      ]) !==
      JSON.stringify([
        record.id,
        record.runtimeKind,
        record.externalSessionId,
        record.executionTarget,
        record.archivedAt,
      ])
    ) {
      const ownBinding =
        ownedStartup.current &&
        previous.externalSessionId === null &&
        previous.id === record.id &&
        previous.runtimeKind === record.runtimeKind &&
        previous.executionTarget.workingDirectory === record.executionTarget.workingDirectory &&
        previous.archivedAt === record.archivedAt;
      if (!ownBinding) recipientVersion.current += 1;
    }
    latestRecord.current = record;
  }, [record]);

  /**
   * Another send can still run, so only the last send ends the startup. Activity stops effects
   * while hidden, but keeps state for the next visit.
   */
  const settleSend = useCallback((): void => {
    ownedStartup.current = false;
    if (isSendInFlight()) return;
    // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
    setStarting(false);
  }, [isSendInFlight]);

  const reportSendFailure = useCallback(
    (cause: unknown): void => {
      const message = errorMessage(cause);
      if (isMounted()) setError(message);
      else
        toast.error(`Could not send to "${title}"`, {
          description: message,
        });
    },
    [isMounted, title],
  );

  /** Starts the saved chat with a first message. The host sends that message. */
  const launchWithMessage = useCallback(
    async (parts: AgentUserMessagePart[]) => {
      setStarting(true);
      ownedStartup.current = true;
      const outcome = await launchWorkspaceSession(
        {
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          sessionId: record.id,
          parts: normalizeAgentUserMessageParts(parts),
        },
        record,
        store,
        queryClient,
      );
      const failureMessage = outcome.failure ? sessionLaunchFailureMessage(outcome.failure) : null;
      return { outcome, failureMessage };
    },
    [queryClient, record, store, workspace.repoPath, workspace.workspaceId],
  );

  const sendStandaloneMessage = async (
    parts: AgentUserMessagePart[],
    options: AgentMessageSendOptions & { assertCurrent: () => void },
  ): Promise<AgentMessageSendReceipt> => {
    if (isSendInFlight() || savingModel.current || resuming.current)
      throw new Error("Wait for the current send or model change to finish.");
    if (!isMounted() || record.archivedAt !== null)
      throw new Error("Select or restore the saved workspace chat before asking for assistance.");
    options.assertCurrent();
    const version = recipientVersion.current;
    const send = activity.begin(activityKey);
    try {
      const identity = workspaceSessionIdentity(record);
      const assertCurrent = () => {
        options.assertCurrent();
        if (recipientVersion.current !== version || !isMounted() || !isCurrentWorkspace())
          throw new GitConflictRequestCancelled();
        const currentIdentity = workspaceSessionIdentity(latestRecord.current);
        if (
          latestRecord.current.archivedAt !== null ||
          (identity && currentIdentity && !matchesAgentSessionIdentity(currentIdentity, identity))
        )
          throw new GitConflictRequestCancelled();
      };
      assertCurrent();
      if (!identity) {
        const { outcome, failureMessage } = await launchWithMessage(parts);
        if (!outcome.session || !outcome.acceptedMessage)
          throw new Error(failureMessage ?? CONFLICT_MESSAGE_NOT_ACCEPTED);
        return {
          outcome: "accepted",
          recipient: toAgentSessionIdentity(outcome.session),
          acceptedMessage: outcome.acceptedMessage,
          postAcceptanceFailure: failureMessage,
        };
      }
      const sendOptions: AgentMessageSendOptions = {
        sessionScope: { kind: "repository" },
        assertCanSubmit: (session) => {
          assertCurrent();
          if (!matchesAgentSessionIdentity(session, identity))
            throw new GitConflictRequestCancelled();
          options.assertCanSubmit?.(session);
        },
      };
      const receipt = await operations.sendAgentMessage(identity, parts, sendOptions);
      if (!receipt) throw new Error(CONFLICT_MESSAGE_NOT_ACCEPTED);
      return receipt;
    } finally {
      send.finish();
      settleSend();
    }
  };

  const saveDraftModel = useCallback(
    (selection: AgentModelSelection) =>
      host
        .workspaceSessionSetDraftModel({
          workspaceId: workspace.workspaceId,
          sessionId: record.id,
          selectedModel: { ...selection, runtimeKind: record.runtimeKind },
        })
        .then((saved) => updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, saved)),
    [queryClient, record.id, record.runtimeKind, workspace.workspaceId],
  );

  const updateDraftModel = useCallback(
    (selection: AgentModelSelection | null) => {
      if (savingModel.current || isSendInFlight() || resuming.current) return;
      if (!selection) {
        setError("Select a model before saving the draft model.");
        return;
      }
      savingModel.current = true;
      setSavingModel(true);
      setError(null);
      void saveDraftModel(selection)
        .catch((cause: unknown) => {
          setError(errorMessage(cause));
        })
        .finally(() => {
          savingModel.current = false;
          setSavingModel(false);
        });
    },
    [saveDraftModel, isSendInFlight],
  );

  const { updateAgentSessionModel } = operations;
  // The speed control shows its own progress and failure, so it skips the model lock state.
  const updateSpeed = useCallback(
    async (identity: AgentSessionIdentity | null, selection: AgentModelSelection) => {
      if (savingModel.current || isSendInFlight() || resuming.current)
        throw new Error("Wait for the current send or session change before changing the speed.");
      savingModel.current = true;
      try {
        await (identity ? updateAgentSessionModel(identity, selection) : saveDraftModel(selection));
      } finally {
        savingModel.current = false;
      }
    },
    [saveDraftModel, updateAgentSessionModel, isSendInFlight],
  );
  const updateSessionModel = useCallback(
    async (identity: AgentSessionIdentity, selection: AgentModelSelection | null) => {
      if (savingModel.current || isSendInFlight() || resuming.current)
        throw new Error("Wait for the current send or session change before changing the model.");
      savingModel.current = true;
      setSavingModel(true);
      try {
        await updateAgentSessionModel(identity, selection);
      } finally {
        savingModel.current = false;
        setSavingModel(false);
      }
    },
    [updateAgentSessionModel, isSendInFlight],
  );

  /**
   * Launches the saved chat with the draft. A launch that did not deliver the message fails, so
   * the composer keeps the draft.
   */
  const launchWithDraft = useCallback(
    async (parts: AgentUserMessagePart[]): Promise<true> => {
      const { outcome, failureMessage } = await launchWithMessage(parts);
      if (!outcome.acceptedMessage)
        throw new Error(failureMessage ?? "The agent did not accept the message.");
      // The runtime accepted the message, so the draft must stay cleared.
      if (failureMessage) reportSendFailure(failureMessage);
      return true;
    },
    [launchWithMessage, reportSendFailure],
  );

  /**
   * Sends to this chat's session, or launches the session with the first message. The target
   * stays the same while its inputs stay the same.
   */
  const sendTarget = useCallback(
    ({
      canSend,
      assertCanSubmit,
    }: {
      canSend: boolean;
      assertCanSubmit: NonNullable<AgentMessageSendOptions["assertCanSubmit"]>;
    }): AgentChatSendTarget => ({
      activity,
      activityKey,
      canSend: () => canSend && !savingModel.current && !resuming.current && isMounted(),
      resolve: async (parts) => {
        setError(null);
        if (!isMounted() || !isCurrentWorkspace()) throw new Error(CHAT_UNAVAILABLE);
        const identity = workspaceSessionIdentity(record);
        if (!identity) return { kind: "launched", result: await launchWithDraft(parts) };
        return { kind: "session", identity, sendOptions: { assertCanSubmit } };
      },
      onFailure: (cause) => {
        reportSendFailure(cause);
        return false;
      },
      onSettled: settleSend,
    }),
    [
      activity,
      activityKey,
      isCurrentWorkspace,
      isMounted,
      launchWithDraft,
      record,
      reportSendFailure,
      settleSend,
    ],
  );

  const { continueInterruptedTurn } = operations;
  const resumeTurn = useCallback(
    async (identity: AgentSessionIdentity): Promise<void> => {
      if (isSendInFlight() || savingModel.current || resuming.current)
        throw new Error("Wait for the current send or session change before resuming.");
      resuming.current = true;
      try {
        await continueInterruptedTurn(identity);
      } catch (cause) {
        if (!isMounted()) {
          const notice =
            cause instanceof HostInvokeError ? getAgentSessionResumeFailureNotice(cause) : null;
          toast.error(`Could not resume "${title}"`, {
            description: notice?.text ?? errorMessage(cause),
          });
        }
        throw cause;
      } finally {
        resuming.current = false;
      }
    },
    [continueInterruptedTurn, isMounted, title, isSendInFlight],
  );

  const recordIdentity = workspaceSessionIdentity(record);
  const session = useAgentSession(recordIdentity);
  const recordSessionKey = recordIdentity === null ? null : agentSessionIdentityKey(recordIdentity);
  const {
    resume: resumeInterruptedTurn,
    isSessionResuming,
    resumeErrorForSession,
    persistentResumeErrorForSession,
  } = useInterruptedTurnResume(resumeTurn, {
    sessionKey: recordSessionKey,
    isLatestTurnSettled: hasSettledLatestTurn(session?.messages.items ?? []),
  });
  const isResumingSession = recordSessionKey !== null && isSessionResuming(recordSessionKey);
  const resumeSessionError =
    recordSessionKey === null ? null : resumeErrorForSession(recordSessionKey);
  const persistentResumeError =
    recordSessionKey === null ? null : persistentResumeErrorForSession(recordSessionKey);

  return {
    isSending: activity.isActive(activityKey),
    isStarting,
    isSavingModel,
    error,
    updateDraftModel,
    updateSessionModel,
    updateSpeed,
    sendTarget,
    sendStandaloneMessage,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    resumeInterruptedTurn,
  };
}
