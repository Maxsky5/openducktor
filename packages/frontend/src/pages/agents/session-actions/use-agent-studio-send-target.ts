import {
  type AgentModelSelection,
  type AgentRole,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
} from "@openducktor/core";
import type { TaskCard } from "@openducktor/contracts";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { useEffect, useMemo, useRef } from "react";
import type { AgentChatSendTarget } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import {
  isSessionStartFailureFeedbackHandled,
  SessionStartWorkflowError,
  type RunSessionStartWorkflow,
  type SessionLaunchActionId,
} from "@/features/session-start";
import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAsyncActivityTracker } from "@/lib/use-async-activity-tracker";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildAgentStudioSessionActivityKey } from "../agent-studio-session-activity-key";
import { agentStudioChatDraftScopeKey } from "../agent-studio-chat-draft";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";

type UseAgentStudioSendTargetArgs = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectionForNewSession: AgentModelSelection | null;
  selectedTask: TaskCard | null;
  canStartSession: boolean;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  scheduleQueryUpdate: (updates: QueryUpdate) => void;
  selectedSessionIdentity: AgentSessionIdentity | null;
  isCatalogLoading: boolean;
  assertCanPrepareSession: (identity: AgentSessionIdentity) => void;
  agentStudioReady: boolean;
  isStarting: boolean;
};

/** The draft's first Send starts a session and sends through the start workflow. */
export function useAgentStudioSendTarget({
  workspaceId,
  taskId,
  role,
  launchActionId,
  selectionForNewSession,
  selectedTask,
  canStartSession,
  runSessionStartWorkflow,
  scheduleQueryUpdate,
  selectedSessionIdentity,
  isCatalogLoading,
  assertCanPrepareSession,
  agentStudioReady,
  isStarting,
}: UseAgentStudioSendTargetArgs): AgentChatSendTarget {
  const activity = useAsyncActivityTracker();
  const activityKey = buildAgentStudioSessionActivityKey({
    workspaceId,
    taskId,
    role,
    session: selectedSessionIdentity,
  });
  const isCurrentContext = useSessionStartContext(activityKey);
  // A lost launch reply can still mean that the host started the session.
  const startedDrafts = useRef(new Set<string>());
  useEffect(() => {
    if (selectedSessionIdentity)
      startedDrafts.current.delete(
        buildAgentStudioSessionActivityKey({ workspaceId, taskId, role, session: null }),
      );
  }, [role, selectedSessionIdentity, taskId, workspaceId]);
  return useMemo((): AgentChatSendTarget => {
    return {
      activity,
      activityKey,
      capture: () => isCurrentContext,
      canSend: () =>
        !isStarting &&
        agentStudioReady &&
        taskId.length > 0 &&
        (selectedSessionIdentity !== null ||
          (canStartSession &&
            selectionForNewSession?.runtimeKind !== undefined &&
            !startedDrafts.current.has(activityKey) &&
            !activity.hasInFlight(activityKey))) &&
        !isCatalogLoading,
      resolve: async (parts) => {
        if (!isCurrentContext()) return null;
        requireCompactionTarget(parts, selectedSessionIdentity);
        if (!selectedSessionIdentity) {
          if (!canStartSession || !selectionForNewSession?.runtimeKind)
            throw new Error("Select an available runtime and model before sending a message.");
          const launch = await runSessionStartWorkflow({
            request: {
              taskId,
              role,
              launchActionId,
              postStartAction: "send_message",
              parts,
              assertBeforeLaunch: () => {
                if (!isCurrentContext())
                  throw new Error(
                    "The original chat is no longer selected. Reopen it to send your draft.",
                  );
              },
            },
            decision: { startMode: "fresh", selectedModel: selectionForNewSession },
            task: selectedTask,
            isCurrent: isCurrentContext,
          }).catch((cause: unknown) => {
            const failure =
              cause instanceof SessionStartWorkflowError ? cause.originalCause : cause;
            if (
              failure instanceof RemoteConnectionError &&
              failure.failure.code === "outcome_unknown"
            )
              startedDrafts.current.add(activityKey);
            throw cause;
          });
          startedDrafts.current.add(activityKey);
          if (isCurrentContext())
            scheduleQueryUpdate(
              buildAgentStudioSelectionQueryUpdate({
                taskId,
                sessionExternalId: launch.externalSessionId,
                role,
              }),
            );
          if (
            !launch.postStartMessageReceipt &&
            launch.postStartActionError &&
            launch.retryPostStartMessage
          )
            return {
              result: {
                kind: "recover_draft",
                originKey: agentStudioChatDraftScopeKey(workspaceId, {
                  taskId,
                  role,
                  session: null,
                }),
                recoveryKey: agentStudioChatDraftScopeKey(workspaceId, {
                  taskId,
                  role,
                  session: launch,
                }),
                error: launch.postStartActionError,
                inAppFeedbackHandled: isSessionStartFailureFeedbackHandled(
                  launch.postStartActionError,
                ),
              },
            };
          // An accepted or uncertain host send must not become another send from this draft.
          return { result: true };
        }
        assertCanPrepareSession(selectedSessionIdentity);
        if (!isCurrentContext()) return null;
        return {
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
      },
    };
  }, [
    activity,
    activityKey,
    assertCanPrepareSession,
    agentStudioReady,
    canStartSession,
    isCurrentContext,
    isCatalogLoading,
    isStarting,
    launchActionId,
    role,
    runSessionStartWorkflow,
    scheduleQueryUpdate,
    selectedTask,
    selectionForNewSession,
    selectedSessionIdentity,
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
