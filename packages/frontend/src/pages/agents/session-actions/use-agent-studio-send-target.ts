import {
  type AgentRole,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { useMemo } from "react";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import type { AgentChatSendTarget } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import { isSessionStartFailureFeedbackHandled } from "@/features/session-start/session-start-orchestration";
import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
import {
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAsyncActivityTracker } from "@/lib/use-async-activity-tracker";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { agentStudioChatDraftScopeKey } from "../agent-studio-chat-draft";
import { buildAgentStudioSessionActivityKey } from "../agent-studio-session-activity-key";
import {
  canResolveAgentStudioSendTargetSession,
  type StartSessionForMessage,
} from "./agent-studio-send-target";

type UseAgentStudioSendTargetArgs = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  selectedSessionIdentity: AgentSessionIdentity | null;
  isSessionModelCatalogLoading: boolean;
  assertCanPrepareSession: (identity: AgentSessionIdentity) => void;
  agentStudioReady: boolean;
  canStartNewSession: boolean;
  isStarting: boolean;
  startSession: StartSessionForMessage;
};

/**
 * Sends to the selected task session, or launches a session for the role with the message as its
 * first instruction. A failed launch that did not deliver the message moves the draft to the new
 * session.
 */
export function useAgentStudioSendTarget({
  workspaceId,
  taskId,
  role,
  selectedSessionIdentity,
  isSessionModelCatalogLoading,
  assertCanPrepareSession,
  agentStudioReady,
  canStartNewSession,
  isStarting,
  startSession,
}: UseAgentStudioSendTargetArgs): AgentChatSendTarget {
  const activity = useAsyncActivityTracker();
  const activityKey = buildAgentStudioSessionActivityKey({
    workspaceId,
    taskId,
    role,
    session: selectedSessionIdentity,
  });
  const isCurrentContext = useSessionStartContext(activityKey);
  return useMemo((): AgentChatSendTarget => {
    /** Moves the draft to the new session. */
    const recoverDraft = (cause: Error, session: AgentSessionIdentity): AgentChatSendResult => ({
      kind: "recover_draft",
      originKey: agentStudioChatDraftScopeKey(workspaceId, { taskId, role, session: null }),
      recoveryKey: agentStudioChatDraftScopeKey(workspaceId, { taskId, role, session }),
      error: cause,
      inAppFeedbackHandled: isSessionStartFailureFeedbackHandled(cause),
    });

    return {
      activity,
      activityKey,
      capture: () => isCurrentContext,
      canSend: () =>
        !isStarting &&
        agentStudioReady &&
        taskId.length > 0 &&
        canResolveAgentStudioSendTargetSession({ selectedSessionIdentity, canStartNewSession }) &&
        !isSessionModelCatalogLoading,
      resolve: async (parts) => {
        if (!isCurrentContext()) return null;
        requireCompactionTarget(parts, selectedSessionIdentity);
        if (selectedSessionIdentity) assertCanPrepareSession(selectedSessionIdentity);
        if (!isCurrentContext()) return null;
        if (selectedSessionIdentity)
          return {
            kind: "session",
            identity: selectedSessionIdentity,
            sendOptions: {
              assertCanSubmit: (session) => {
                if (
                  !isCurrentContext() ||
                  !matchesAgentSessionIdentity(session, selectedSessionIdentity)
                )
                  throw new Error(
                    "The original chat is no longer selected. Reopen it to send your draft.",
                  );
                assertCanPrepareSession(selectedSessionIdentity);
              },
            },
          };
        const started = await startSession(normalizeAgentUserMessageParts(parts));
        if (!started) return null;
        const identity = toAgentSessionIdentity(started);
        const failure = started.postStartActionError;
        return {
          kind: "launched",
          // The runtime accepted the first message, so the composer must not restore it.
          result:
            failure && !started.postStartMessageReceipt ? recoverDraft(failure, identity) : true,
        };
      },
    };
  }, [
    activity,
    activityKey,
    assertCanPrepareSession,
    agentStudioReady,
    canStartNewSession,
    isCurrentContext,
    isSessionModelCatalogLoading,
    isStarting,
    role,
    selectedSessionIdentity,
    startSession,
    taskId,
    workspaceId,
  ]);
}

/** A compaction needs an existing session of a runtime that can compact it. */
const requireCompactionTarget = (
  parts: AgentUserMessagePart[],
  selectedSessionIdentity: AgentSessionIdentity | null,
): void => {
  if (classifySystemSlashCommandInvocation(parts).kind !== "manual_session_compaction") return;
  if (!selectedSessionIdentity) {
    throw new Error("/compact requires an existing selected session.");
  }
  const { runtimeKind } = selectedSessionIdentity;
  if (runtimeKind !== "opencode" && runtimeKind !== "codex" && runtimeKind !== "claude") {
    throw new Error(`/compact is unavailable for ${runtimeKind} sessions.`);
  }
};
