import { useQueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/shared/host";
import { projectWorkflowLaunch } from "@/state/operations/agent-orchestrator/session-read-model/workflow-launch-projection";
import { withWorktreeRefresh } from "./with-worktree-refresh";
import { useMemo } from "react";
import { useWorkspaceStateContext, useAgentSessionsContext } from "@/state/app-state-contexts";
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
  const { sessionStartNotifications } = useNotificationContext();
  const repoPath = activeWorkspace?.workspaceId === workspaceId ? activeWorkspace.repoPath : null;
  return useMemo(
    () =>
      createSessionStartWorkflowRunner({
        workspaceId,
        repoPath,
        readSessionSnapshot: (identity) => store.getSessionSnapshot(identity) ?? null,
        notifications: sessionStartNotifications,
        client: {
          agentSessionWorkflowLaunch: withWorktreeRefresh(queryClient, async (request) => {
            const outcome = await host.agentSessionWorkflowLaunch(request);
            try {
              projectWorkflowLaunch(store, queryClient, outcome);
            } catch (cause) {
              console.error("Cannot project the prepared workflow session.", cause);
            }
            return outcome;
          }),
          agentSessionWorkflowLaunchRead: host.agentSessionWorkflowLaunchRead,
          agentSessionWorkflowLaunchRecover: host.agentSessionWorkflowLaunchRecover,
        },
      }),
    [workspaceId, repoPath, sessionStartNotifications, store, queryClient],
  );
}
