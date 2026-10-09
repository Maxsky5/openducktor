import type { WorkspaceSession } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentUserMessagePart,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useInterruptedTurnResume } from "@/components/features/agents/agent-chat/use-interrupted-turn-resume";
import { hasSettledLatestTurn } from "@/lib/agent-session-interrupted-turn";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { resolveAgentStudioSendDraftParts } from "@/pages/agents/session-actions/agent-studio-send-draft";
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
import { presentWorkspaceSessionLaunch } from "./use-workspace-session-launch-recovery";
import { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";

type DraftSendOptions = Omit<Parameters<typeof resolveAgentStudioSendDraftParts>[0], "draft"> & {
  canSend: boolean;
  assertCanSubmit?: AgentMessageSendOptions["assertCanSubmit"];
};

export function useWorkspaceSessionChatActions(
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
  isMounted: () => boolean,
) {
  const store = useAgentSessionsContext();
  const operations = useAgentOperations();
  const queryClient = useQueryClient();
  const title = workspaceSessionTitle(record);
  const isCurrentWorkspace = () =>
    store.getActivitySnapshot().workspaceRepoPath === workspace.repoPath;
  const sending = useRef(false);
  const savingModel = useRef(false);
  const resuming = useRef(false);
  const [isSending, setSending] = useState(false);
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

  const sendStandaloneMessage = async (
    parts: AgentUserMessagePart[],
    options: AgentMessageSendOptions & { assertCurrent: () => void },
  ): Promise<AgentMessageSendReceipt> => {
    if (sending.current || savingModel.current || resuming.current)
      throw new Error("Wait for the current send or model change to finish.");
    if (!isMounted() || record.archivedAt !== null)
      throw new Error("Select or restore the saved workspace chat before asking for assistance.");
    options.assertCurrent();
    const version = recipientVersion.current;
    sending.current = true;
    setSending(true);
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
        setStarting(true);
        ownedStartup.current = true;
        const outcome = await launchWorkspaceSession(
          {
            launchAttemptId: crypto.randomUUID(),
            workspaceId: workspace.workspaceId,
            repoPath: workspace.repoPath,
            sessionId: record.id,
            parts: normalizeAgentUserMessageParts(parts),
          },
          record,
          store,
          queryClient,
        );
        presentWorkspaceSessionLaunch(outcome, title);
        if (outcome.acceptance !== "accepted" || !outcome.session || !outcome.acceptedMessage)
          throw new Error(
            outcome.failure?.message ??
              "The host did not confirm the conflict message. Inspect this launch before sending again.",
          );
        return {
          recipient: toAgentSessionIdentity(outcome.session),
          acceptedMessage: outcome.acceptedMessage,
          postAcceptanceFailure: outcome.failure?.message ?? null,
        };
      }
      const sendOptions: AgentMessageSendOptions = {
        sessionScope: { kind: "repository" },
        assertCanSubmit: (session, ownsStart) => {
          assertCurrent();
          if (!matchesAgentSessionIdentity(session, identity))
            throw new GitConflictRequestCancelled();
          options.assertCanSubmit?.(session, ownsStart);
        },
      };
      const receipt = await operations.sendAgentMessage(identity, parts, sendOptions);
      if (!receipt)
        throw new Error(
          "The agent did not accept a conflict message. Reopen the chat and try again.",
        );
      return receipt;
    } finally {
      ownedStartup.current = false;
      sending.current = false;
      setSending(false);
      setStarting(false);
    }
  };

  const updateDraftModel = useCallback(
    (selection: AgentModelSelection | null) => {
      if (savingModel.current || sending.current || resuming.current) return;
      if (!selection) {
        setError("Select a model before saving the draft model.");
        return;
      }
      savingModel.current = true;
      setSavingModel(true);
      setError(null);
      void host
        .workspaceSessionSetDraftModel({
          workspaceId: workspace.workspaceId,
          sessionId: record.id,
          selectedModel: { ...selection, runtimeKind: record.runtimeKind },
        })
        .then((saved) => {
          updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, saved);
          if (record.speed !== null && record.speed !== "standard" && saved.speed === "standard")
            toast.info(
              "Speed was set to Standard because this model does not support the previous level.",
            );
        })
        .catch((cause: unknown) => {
          setError(errorMessage(cause));
        })
        .finally(() => {
          savingModel.current = false;
          setSavingModel(false);
        });
    },
    [queryClient, record.id, record.runtimeKind, record.speed, workspace.workspaceId],
  );

  const { updateAgentSessionModel } = operations;
  const updateSessionModel = useCallback(
    async (identity: AgentSessionIdentity, selection: AgentModelSelection | null) => {
      if (savingModel.current || sending.current || resuming.current)
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
    [updateAgentSessionModel],
  );

  const sendDraft = async (
    draft: AgentChatComposerDraft,
    options: DraftSendOptions,
  ): Promise<AgentChatSendResult> => {
    if (
      sending.current ||
      savingModel.current ||
      resuming.current ||
      !options.canSend ||
      !isMounted()
    )
      return false;
    sending.current = true;
    setSending(true);
    setError(null);
    let launchSubmitted = false;
    try {
      const parts = await resolveAgentStudioSendDraftParts({ ...options, draft });
      if (!parts) return false;
      if (!isMounted() || !isCurrentWorkspace())
        throw new Error("The original chat is no longer available. Reopen it to send your draft.");
      const identity = workspaceSessionIdentity(record);
      if (!identity) {
        setStarting(true);
        ownedStartup.current = true;
        launchSubmitted = true;
        const outcome = await launchWorkspaceSession(
          {
            launchAttemptId: crypto.randomUUID(),
            workspaceId: workspace.workspaceId,
            repoPath: workspace.repoPath,
            sessionId: record.id,
            parts: normalizeAgentUserMessageParts(parts),
          },
          record,
          store,
          queryClient,
        );
        presentWorkspaceSessionLaunch(outcome, title);
        if (outcome.failure) {
          const message =
            outcome.failure.message +
            (outcome.acceptance === "unknown"
              ? " Inspect the saved session before sending another instruction."
              : "");
          if (isMounted()) setError(message);
        }
        if (outcome.recoveryAllowed) {
          const persistence = createWorkspaceSessionChatDraftPersistence(
            workspace.workspaceId,
            record.id,
          );
          return {
            kind: "recover_draft",
            originKey: persistence.targetKey,
            recoveryKey: persistence.targetKey,
            persistence,
            launchAttemptId: outcome.launchAttemptId,
            error: new Error(outcome.failure?.message ?? "First message failed."),
            inAppFeedbackHandled: true,
          };
        }
        return outcome.acceptance === "accepted" || outcome.acceptance === "unknown";
      }
      if (!isMounted() || !isCurrentWorkspace())
        throw new Error("The original chat is no longer available. Reopen it to send your draft.");
      if (options.assertCanSubmit) {
        const sendOptions: AgentMessageSendOptions = {
          assertCanSubmit: options.assertCanSubmit,
        };
        await operations.sendAgentMessage(identity, parts, sendOptions);
      } else await operations.sendAgentMessage(identity, parts);
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      if (isMounted()) setError(message);
      else
        toast.error(`Could not send to "${title}"`, {
          description: message,
        });
      // An unreadable launch may still send. Keep its instruction out of the composer.
      return launchSubmitted;
    } finally {
      ownedStartup.current = false;
      sending.current = false;
      // Activity stops effects while hidden, but keeps state for the next visit.
      // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
      setSending(false);
      setStarting(false);
    }
  };

  const { continueInterruptedTurn } = operations;
  const resumeTurn = useCallback(
    async (identity: AgentSessionIdentity): Promise<void> => {
      if (sending.current || savingModel.current || resuming.current)
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
    [continueInterruptedTurn, isMounted, title],
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
    isSending,
    isStarting,
    isSavingModel,
    error,
    updateDraftModel,
    updateSessionModel,
    sendDraft,
    sendStandaloneMessage,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    resumeInterruptedTurn,
  };
}
