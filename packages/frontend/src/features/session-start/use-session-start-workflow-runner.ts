import { useQueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/shared/host";
import { projectWorkflowLaunch } from "@/state/operations/agent-orchestrator/session-read-model/workflow-launch-projection";
import { withWorktreeRefresh } from "./with-worktree-refresh";
import { useMemo } from "react";
import {
  useAgentOperationsContext,
  useAgentSessionsContext,
  useWorkspaceStateContext,
} from "@/state/app-state-contexts";
import { useNotificationContext } from "@/state/notifications/notification-context";
import {
  createSessionStartWorkflowRunner,
  type RunSessionStartWorkflow,
} from "./session-start-orchestration";

export function useSessionStartWorkflowRunner({
  workspaceId,
}: {
  workspaceId: string | null;
}): RunSessionStartWorkflow {
  const store = useAgentSessionsContext();
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceStateContext();
  const { sendAgentMessage } = useAgentOperationsContext();
  const { sessionStartNotifications } = useNotificationContext();
  const repoPath = activeWorkspace?.workspaceId === workspaceId ? activeWorkspace.repoPath : null;
  return useMemo(
    () =>
      createSessionStartWorkflowRunner({
        workspaceId,
        repoPath,
        sendAgentMessage,
        notifications: sessionStartNotifications,
        client: {
          agentSessionWorkflowLaunch: withWorktreeRefresh(queryClient, async (request) => {
            const outcome = await host.agentSessionWorkflowLaunch(request);
            // The host already finished the launch, and the live stream also delivers the session.
            // A local display failure must not report the launch as failed or restore its draft.
            try {
              projectWorkflowLaunch(store, queryClient, outcome);
            } catch (cause) {
              console.error("Cannot project the launched workflow session.", cause);
            }
            return outcome;
          }),
        },
      }),
    [workspaceId, repoPath, sendAgentMessage, sessionStartNotifications, store, queryClient],
  );
}
