import type { WorkspaceSession } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useInterruptedTurnResume } from "@/components/features/agents/agent-chat/use-interrupted-turn-resume";
import { hasSettledLatestTurn } from "@/lib/agent-session-interrupted-turn";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
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
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { startWorkspaceSession } from "./start-workspace-session";

type DraftSendOptions = Omit<Parameters<typeof resolveAgentStudioSendDraftParts>[0], "draft"> & {
  canSend: boolean;
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
  const [isSending, setSending] = useState(false);
  const [isStarting, setStarting] = useState(false);
  const [isSavingModel, setSavingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraftModel = useCallback(
    (selection: AgentModelSelection | null) => {
      if (savingModel.current || sending.current) return;
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
        .then((saved) => updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, saved))
        .catch((cause: unknown) => {
          setError(errorMessage(cause));
        })
        .finally(() => {
          savingModel.current = false;
          setSavingModel(false);
        });
    },
    [queryClient, record.id, record.runtimeKind, workspace.workspaceId],
  );

  const sendDraft = async (
    draft: AgentChatComposerDraft,
    options: DraftSendOptions,
  ): Promise<boolean> => {
    if (sending.current || savingModel.current || !options.canSend || !isMounted()) return false;
    sending.current = true;
    setSending(true);
    setError(null);
    try {
      const parts = await resolveAgentStudioSendDraftParts({ ...options, draft });
      if (!parts || !isMounted() || !isCurrentWorkspace()) return false;
      let identity = workspaceSessionIdentity(record);
      if (!identity) {
        setStarting(true);
        // Keep an accepted start in the store even if the pane closes while the host works.
        const started = await startWorkspaceSession(
          { workspaceId: workspace.workspaceId, sessionId: record.id },
          store,
          isCurrentWorkspace,
        );
        updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, started.session);
        identity = started.identity;
      }
      if (!isMounted() || !isCurrentWorkspace()) return false;
      await operations.sendAgentMessage(identity, parts);
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      if (isMounted()) setError(message);
      else
        toast.error(`Could not send to "${title}"`, {
          description: message,
        });
      return false;
    } finally {
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
    sendDraft,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    resumeInterruptedTurn,
  };
}
