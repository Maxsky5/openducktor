import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useChatSessionPreparation } from "@openducktor/frontend-core/sessions/composer/use-chat-session-preparation";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { startWorkspaceSessionRuntime } from "@openducktor/frontend-core/workspace-sessions/create/launch-workspace-session";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { SessionTarget } from "./session-target";

/**
 * Attaches the open session to its live runtime, as desktop does when it selects a session. A
 * task session reattaches; a chat starts or reuses its runtime session. A Read-only Session View
 * sends no command.
 */
export function useSessionPreparation(
  target: SessionTarget,
  enabled: boolean,
): { ready: boolean; error: string | null } {
  const host = useHostClient();
  const store = useAgentSessionsContext();
  const queryClient = useQueryClient();
  const { workspace, repoPath, identity, owner } = target;
  const { workspaceId } = workspace;
  const chatId = owner.kind === "chat" ? owner.record.id : null;
  const chatArchived = owner.kind === "chat" && owner.record.archivedAt !== null;
  const taskId = owner.kind === "task" ? owner.taskId : null;
  const role = owner.kind === "task" ? owner.role : null;
  const prepare = useCallback(async (): Promise<void> => {
    if (chatId !== null) {
      await startWorkspaceSessionRuntime({
        host,
        store,
        queryClient,
        workspace: { workspaceId, repoPath },
        sessionId: chatId,
      });
      return;
    }
    if (taskId === null || role === null) return;
    await host.agentSessionControlResume({
      repoPath,
      runtimeKind: identity.runtimeKind,
      externalSessionId: identity.externalSessionId,
      workingDirectory: identity.workingDirectory,
      sessionScope: { kind: "workflow", taskId, role },
      resumeMode: "reattach",
    });
  }, [chatId, host, identity, queryClient, repoPath, role, store, taskId, workspaceId]);
  return useChatSessionPreparation({
    identity,
    targetKey: JSON.stringify([workspaceId, target.sessionKey, chatId, taskId, role]),
    enabled: enabled && !target.readOnly && !chatArchived && owner.kind !== "none",
    prepare,
  });
}
