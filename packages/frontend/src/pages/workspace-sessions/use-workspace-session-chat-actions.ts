import type { WorkspaceSession } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useInterruptedTurnResume } from "@/components/features/agents/agent-chat/use-interrupted-turn-resume";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { resolveAgentStudioSendDraftParts } from "@/pages/agents/session-actions/agent-studio-send-draft";
import { useAgentSessionsContext } from "@/state/app-state-contexts";
import { useAgentOperations } from "@/state/app-state-provider";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { host } from "@/state/operations/host";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import { startWorkspaceSession } from "./start-workspace-session";
import { useMountedRef } from "./use-mounted-ref";

type DraftSendOptions = Omit<Parameters<typeof resolveAgentStudioSendDraftParts>[0], "draft"> & {
  canSend: boolean;
};

export function useWorkspaceSessionChatActions(
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
) {
  const store = useAgentSessionsContext();
  const operations = useAgentOperations();
  const queryClient = useQueryClient();
  const mounted = useMountedRef();
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
          if (mounted.current) setError(errorMessage(cause));
        })
        .finally(() => {
          savingModel.current = false;
          if (mounted.current) setSavingModel(false);
        });
    },
    [mounted, queryClient, record.id, record.runtimeKind, workspace.workspaceId],
  );

  const sendDraft = async (
    draft: AgentChatComposerDraft,
    options: DraftSendOptions,
  ): Promise<boolean> => {
    if (sending.current || savingModel.current || !options.canSend) return false;
    sending.current = true;
    setSending(true);
    setError(null);
    try {
      const parts = await resolveAgentStudioSendDraftParts({ ...options, draft });
      if (!parts || !mounted.current) return false;
      let identity = workspaceSessionIdentity(record);
      if (!identity) {
        setStarting(true);
        const started = await startWorkspaceSession(
          { workspaceId: workspace.workspaceId, sessionId: record.id },
          store,
          () => mounted.current,
        );
        updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, started.session);
        identity = started.identity;
      }
      await operations.sendAgentMessage(identity, parts);
      return true;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
      return false;
    } finally {
      sending.current = false;
      if (mounted.current) {
        // Both flags reset in finally after acceptance, rejection, and early return.
        // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
        setSending(false);
        setStarting(false);
      }
    }
  };

  const {
    resume: resumeInterruptedTurn,
    isSessionResuming,
    resumeErrorForSession,
    persistentResumeErrorForSession,
  } = useInterruptedTurnResume(operations.continueInterruptedTurn);
  const recordIdentity = workspaceSessionIdentity(record);
  const recordSessionKey = recordIdentity === null ? null : agentSessionIdentityKey(recordIdentity);
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
