import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHostClient } from "../../connection/client-connection-react";
import { projectWorkflowLaunch } from "../agent-orchestrator/session-read-model/workflow-launch-projection";
import { useAgentOperationsContext, useAgentSessionsContext } from "../session-contexts";
import {
  createSessionStartWorkflowRunner,
  type RunSessionStartWorkflow,
  type SessionStartNotificationPublisher,
} from "./session-start-orchestration";
import { withWorktreeRefresh } from "./with-worktree-refresh";

/**
 * Runs workflow launches in one workspace. `repoPath` is the repository of that workspace, or
 * null while the workspace is not selected, which makes each launch fail with a clear message.
 */
export function useSessionStartWorkflowRunner({
  workspaceId,
  repoPath,
  notifications,
}: {
  workspaceId: string | null;
  repoPath: string | null;
  notifications?: SessionStartNotificationPublisher | undefined;
}): RunSessionStartWorkflow {
  const store = useAgentSessionsContext();
  const queryClient = useQueryClient();
  const host = useHostClient();
  const { sendAgentMessage } = useAgentOperationsContext();
  return useMemo(
    () =>
      createSessionStartWorkflowRunner({
        workspaceId,
        repoPath,
        sendAgentMessage,
        notifications,
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
    [host, workspaceId, repoPath, sendAgentMessage, notifications, store, queryClient],
  );
}
