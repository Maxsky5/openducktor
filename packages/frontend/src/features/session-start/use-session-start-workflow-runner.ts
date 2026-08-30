import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { StartAgentSession } from "@/types/agent-session-start";
import {
  createSessionStartWorkflowRunner,
  type RunSessionStartWorkflow,
} from "./session-start-orchestration";
import type { SendAgentMessage } from "./session-start-workflow";

type UseSessionStartWorkflowRunnerArgs = {
  workspaceId: string | null;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
};

export function useSessionStartWorkflowRunner({
  workspaceId,
  startAgentSession,
  sendAgentMessage,
}: UseSessionStartWorkflowRunnerArgs): RunSessionStartWorkflow {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const args: Parameters<typeof createSessionStartWorkflowRunner>[0] = {
      queryClient,
      workspaceId,
      startAgentSession,
    };

    if (sendAgentMessage) {
      args.sendAgentMessage = sendAgentMessage;
    }

    return createSessionStartWorkflowRunner(args);
  }, [queryClient, sendAgentMessage, startAgentSession, workspaceId]);
}
