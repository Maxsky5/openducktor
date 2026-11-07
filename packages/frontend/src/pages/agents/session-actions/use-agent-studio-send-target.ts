import {
  type AgentModelSelection,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
} from "@openducktor/core";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import {
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
} from "@openducktor/contracts";
import { useEffect, useMemo, useRef } from "react";
import type { AgentChatSendTarget } from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import {
  isSessionStartFailureFeedbackHandled,
  SessionStartWorkflowError,
  type RunSessionStartWorkflow,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import { useSessionStartContext } from "@openducktor/frontend-core/sessions/start/use-session-start-context";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAsyncActivityTracker } from "@openducktor/frontend-core/lib/use-async-activity-tracker";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildAgentStudioSessionActivityKey } from "../agent-studio-session-activity-key";
import { agentStudioChatDraftScopeKey } from "@openducktor/frontend-core/sessions/composer/agent-studio-chat-draft";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";
import type {
  WorkflowLaunchActionId as SessionLaunchActionId,
  WorkflowRoleId as AgentRole,
  ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";

type UseAgentStudioSendTargetArgs = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole | null;
  launchActionId: SessionLaunchActionId | null;
  selectionForNewSession: AgentModelSelection | null;
  selectedTask: TaskCard | null;
  canStartSession: boolean;
  startPreparedSession: (
    input: Parameters<RunSessionStartWorkflow>[0],
  ) => Promise<SessionStartWorkflowResult | undefined>;
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
  startPreparedSession,
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
  const completedContext = useRef<(() => boolean) | null>(null);
  // A lost launch reply can still mean that the host started the session.
  const unknownStarts = useRef(new Set<string>());
  useEffect(() => {
    if (selectedSessionIdentity)
      unknownStarts.current.delete(
        buildAgentStudioSessionActivityKey({ workspaceId, taskId, role, session: null }),
      );
  }, [role, selectedSessionIdentity, taskId, workspaceId]);
  return useMemo(
    (): AgentChatSendTarget => ({
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
            completedContext.current !== isCurrentContext &&
            !unknownStarts.current.has(activityKey) &&
            !activity.hasInFlight(activityKey))) &&
        !isCatalogLoading,
      resolve: async (parts) => {
        if (!isCurrentContext()) return null;
        requireSystemCommandTarget(parts, selectedSessionIdentity);
        if (selectedSessionIdentity) {
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
                    "The original session is no longer selected. Reopen it to send your draft.",
                  );
                assertCanPrepareSession(selectedSessionIdentity);
              },
            },
          };
        }
        if (!role || !launchActionId || !canStartSession || !selectionForNewSession?.runtimeKind)
          throw new Error("Select an available runtime and model before sending a message.");
        const launch = await startPreparedSession({
          request: {
            taskId,
            role,
            launchActionId,
            postStartAction: "send_message",
            parts,
            assertBeforeLaunch: () => {
              if (!isCurrentContext())
                throw new Error(
                  "The original session is no longer selected. Reopen it to send your draft.",
                );
            },
          },
          decision: { startMode: "fresh", selectedModel: selectionForNewSession },
          task: selectedTask,
          isCurrent: isCurrentContext,
        }).catch((cause: unknown) => {
          const failure = cause instanceof SessionStartWorkflowError ? cause.originalCause : cause;
          if (
            failure instanceof RemoteConnectionError &&
            failure.failure.code === "outcome_unknown"
          )
            unknownStarts.current.add(activityKey);
          throw cause;
        });
        if (!launch) return null;
        if (isCurrentContext()) {
          completedContext.current = isCurrentContext;
          scheduleQueryUpdate(
            buildAgentStudioSelectionQueryUpdate({
              taskId,
              sessionExternalId: launch.externalSessionId,
              role,
            }),
          );
        }
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
      },
    }),
    [
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
      startPreparedSession,
      scheduleQueryUpdate,
      selectedTask,
      selectionForNewSession,
      selectedSessionIdentity,
      taskId,
      workspaceId,
    ],
  );
}

/** A system command, such as `/compact` or `/goal`, needs an existing session. */
const requireSystemCommandTarget = (
  parts: AgentUserMessagePart[],
  selectedSessionIdentity: AgentSessionIdentity | null,
): void => {
  const invocation = classifySystemSlashCommandInvocation(parts);
  if (invocation.kind === "not_system" || selectedSessionIdentity) return;
  const trigger =
    invocation.kind === "goal"
      ? GOAL_SLASH_COMMAND.trigger
      : MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger;
  throw new Error(`/${trigger} requires an existing selected session.`);
};
