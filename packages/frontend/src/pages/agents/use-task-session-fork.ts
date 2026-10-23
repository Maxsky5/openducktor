import type { AgentSessionForkPoint, AgentSessionWorkflowScope } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { AgentChatForkActions } from "@/components/features/agents/agent-chat/agent-chat-fork-context";
import { useForkNavigation } from "@/components/features/agents/agent-chat/use-fork-navigation";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  forkTaskSession,
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

export function useTaskSessionFork({
  repoPath,
  workspaceId,
  identity: inputIdentity,
  scope,
  disabledReason,
}: {
  repoPath: string | null;
  workspaceId: string | null;
  identity: AgentSessionIdentity | null;
  scope: AgentSessionWorkflowScope;
  disabledReason: string | null;
}) {
  const identity = useStableAgentSessionIdentity(inputIdentity);
  const { taskId, role } = scope;
  const queryClient = useQueryClient();
  const store = useAgentSessionsContext();
  const pending = useSessionForkRequests(queryClient);
  const ownerKey = JSON.stringify([
    workspaceId,
    taskId,
    role,
    identity ? agentSessionIdentityKey(identity) : null,
  ]);
  const captureNavigation = useForkNavigation(ownerKey);
  const [failure, setFailure] = useState<{ ownerKey: string; message: string } | null>(null);
  const actions = useMemo<AgentChatForkActions | null>(() => {
    if (!repoPath || !workspaceId || !identity) return null;
    return {
      disabledReason,
      isPending: (point) => pending.has(sessionForkRequestKey(repoPath, identity, point)),
      onFork: (point: AgentSessionForkPoint) => {
        if (disabledReason || pending.has(sessionForkRequestKey(repoPath, identity, point))) return;
        const open = captureNavigation();
        setFailure(null);
        void forkTaskSession(queryClient, store, {
          ...identity,
          repoPath,
          sessionScope: { kind: "workflow", taskId, role },
          forkPoint: point,
        })
          .then((result) => {
            if (result.syncWarning)
              toast.warning("The fork was created", { description: result.syncWarning });
            open(
              {
                kind: "task_session",
                workspaceId,
                taskId,
                role,
                identity: result.runtimeSession,
              },
              repoPath,
            );
          })
          .catch((cause: unknown) => {
            const message = errorMessage(cause);
            setFailure({ ownerKey, message });
            toast.error("Could not fork chat", { description: message });
          });
      },
    };
  }, [
    repoPath,
    workspaceId,
    identity,
    disabledReason,
    pending,
    captureNavigation,
    queryClient,
    store,
    ownerKey,
    taskId,
    role,
  ]);
  return { actions, error: failure?.ownerKey === ownerKey ? failure.message : null };
}
