import type { WorkspaceSession } from "@openducktor/contracts";
import { type AgentModelSelection, type AgentUserMessagePart } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useInterruptedTurnResume } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-resume";
import { hasSettledLatestTurn } from "@openducktor/frontend-core/lib/agent-session-interrupted-turn";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { AgentChatSendTarget } from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import { useAsyncActivityTracker } from "@openducktor/frontend-core/lib/use-async-activity-tracker";
import { getAgentSessionResumeFailureNotice } from "@openducktor/frontend-core/sessions/agent-runtime-services";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useAgentOperations } from "@/state/app-state-provider";
import { useAgentSession } from "@openducktor/frontend-core/sessions/session-store-hooks";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { updateWorkspaceSessionQueries } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import type {
  AgentSessionIdentity,
  AgentMessageSendReceipt,
  AgentMessageSendOptions,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { GitConflictRequestCancelled } from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
import { startWorkspaceSessionRuntime } from "@openducktor/frontend-core/workspace-sessions/create/launch-workspace-session";
import { useChatSessionPreparation } from "@openducktor/frontend-core/sessions/composer/use-chat-session-preparation";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

const CHAT_UNAVAILABLE = "The original chat is no longer available. Reopen it to send your draft.";
const CONFLICT_MESSAGE_NOT_ACCEPTED =
  "The agent did not accept a conflict message. Reopen the chat and try again.";

export function useWorkspaceSessionChatActions(
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
  isMounted: () => boolean,
  preparationEnabled = true,
  visitKey = 0,
) {
  const host = useHostClient();
  const store = useAgentSessionsContext();
  const operations = useAgentOperations();
  const queryClient = useQueryClient();
  const recordIdentity = workspaceSessionIdentity(record);
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
  const [isSavingModel, setSavingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRecord = useRef(record);
  const recipientVersion = useRef(0);
  const latestWorkspace = useRef(workspace);
  useLayoutEffect(() => {
    const previous = latestRecord.current;
    if (
      latestWorkspace.current.workspaceId !== workspace.workspaceId ||
      latestWorkspace.current.repoPath !== workspace.repoPath
    )
      recipientVersion.current += 1;
    latestWorkspace.current = workspace;
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
      recipientVersion.current += 1;
    }
    latestRecord.current = record;
  }, [record, workspace]);

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

  const prepare = useCallback(async () => {
    await startWorkspaceSessionRuntime({
      host,
      store,
      queryClient,
      workspace: { workspaceId: workspace.workspaceId, repoPath: workspace.repoPath },
      sessionId: record.id,
    });
  }, [host, queryClient, record.id, store, workspace.repoPath, workspace.workspaceId]);
  const preparation = useChatSessionPreparation({
    identity: recordIdentity,
    targetKey: JSON.stringify([workspace.workspaceId, record.id, visitKey]),
    enabled: preparationEnabled && record.archivedAt === null,
    prepare,
  });
  const isStarting = preparationEnabled && !preparation.ready && preparation.error === null;

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
      if (!preparation.ready || !identity)
        throw new Error("The session is not ready. Reopen the chat before sending.");
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
    [host, queryClient, record.id, record.runtimeKind, workspace.workspaceId],
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
      capture: () => {
        const version = recipientVersion.current;
        return () => isMounted() && isCurrentWorkspace() && recipientVersion.current === version;
      },
      canSend: () =>
        canSend && preparation.ready && !savingModel.current && !resuming.current && isMounted(),
      resolve: async () => {
        setError(null);
        const version = recipientVersion.current;
        const assertCurrentRecipient = () => {
          if (!isMounted() || !isCurrentWorkspace() || recipientVersion.current !== version)
            throw new Error(CHAT_UNAVAILABLE);
        };
        assertCurrentRecipient();
        const identity = workspaceSessionIdentity(record);
        if (!preparation.ready || !identity)
          throw new Error("The session is not ready. Reopen the chat before sending.");
        const session = store.getSessionSnapshot(identity);
        if (!session)
          throw new Error(
            "The session is still loading. Wait for it to load, then send your draft.",
          );
        assertCanSubmit(session);
        assertCurrentRecipient();
        return {
          identity,
          sendOptions: {
            assertCanSubmit: (session) => {
              assertCurrentRecipient();
              if (!matchesAgentSessionIdentity(session, identity))
                throw new Error(
                  "The send recipient changed. Reopen the original chat to send your draft.",
                );
              assertCanSubmit(session);
            },
          },
        };
      },
      onFailure: (cause) => {
        reportSendFailure(cause);
        return false;
      },
    }),
    [
      activity,
      activityKey,
      isCurrentWorkspace,
      isMounted,
      preparation.ready,
      record,
      reportSendFailure,
      store,
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
    error: error ?? preparation.error,
    isPrepared: preparation.ready,
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
