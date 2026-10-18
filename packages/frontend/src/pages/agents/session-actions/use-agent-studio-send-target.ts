import {
  type AgentRole,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
} from "@openducktor/core";
import { useMemo } from "react";
import type { AgentChatSendTarget } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAsyncActivityTracker } from "@/lib/use-async-activity-tracker";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildAgentStudioSessionActivityKey } from "../agent-studio-session-activity-key";

type UseAgentStudioSendTargetArgs = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  selectedSessionIdentity: AgentSessionIdentity | null;
  isSessionModelCatalogLoading: boolean;
  assertCanPrepareSession: (identity: AgentSessionIdentity) => void;
  agentStudioReady: boolean;
  isStarting: boolean;
};

export function useAgentStudioSendTarget({
  workspaceId,
  taskId,
  role,
  selectedSessionIdentity,
  isSessionModelCatalogLoading,
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
  return useMemo((): AgentChatSendTarget => {
    return {
      activity,
      activityKey,
      capture: () => isCurrentContext,
      canSend: () =>
        !isStarting &&
        agentStudioReady &&
        taskId.length > 0 &&
        selectedSessionIdentity !== null &&
        !isSessionModelCatalogLoading,
      resolve: async (parts) => {
        if (!isCurrentContext()) return null;
        requireCompactionTarget(parts, selectedSessionIdentity);
        if (!selectedSessionIdentity) throw new Error("Start a session before sending a message.");
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
    isCurrentContext,
    isSessionModelCatalogLoading,
    isStarting,
    selectedSessionIdentity,
    taskId,
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
