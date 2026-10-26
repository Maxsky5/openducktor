import type { AgentSessionForkPoint, AgentSessionWorkflowScope } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
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
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

type TaskForkOwner = { active: boolean; attempts: Map<string, () => void> };

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
  const connection = useClientConnection();
  const location = useLocation();
  const active = useSessionViewActive();
  const store = useAgentSessionsContext();
  const pending = useSessionForkRequests(queryClient);
  const ownerKey = JSON.stringify([
    workspaceId,
    taskId,
    role,
    identity ? agentSessionIdentityKey(identity) : null,
  ]);
  const captureNavigation = useForkNavigation(ownerKey);
  const forkOwner = useRef<TaskForkOwner>({ active: false, attempts: new Map() });
  useLayoutEffect(() => {
    const owner: TaskForkOwner = { active, attempts: new Map() };
    forkOwner.current = owner;
    return () => {
      owner.active = false;
      transferTaskForks(connection, owner);
    };
  }, [active, connection, location.key, ownerKey]);
  const [failure, setFailure] = useState<{ ownerKey: string; message: string } | null>(null);
  const actions = useMemo<AgentChatForkActions | null>(() => {
    if (!repoPath || !workspaceId || !identity) return null;
    return {
      disabledReason,
      isPending: (point) => pending.has(sessionForkRequestKey(repoPath, identity, point)),
      onFork: (point: AgentSessionForkPoint) => {
        if (disabledReason || pending.has(sessionForkRequestKey(repoPath, identity, point))) return;
        const open = captureNavigation();
        const owner = forkOwner.current;
        let registered = false;
        setFailure(null);
        void forkTaskSession(
          queryClient,
          store,
          {
            ...identity,
            repoPath,
            sessionScope: { kind: "workflow", taskId, role },
            forkPoint: point,
          },
          {
            workspaceId,
            presentation: "inline",
            onAttempt: (id) => {
              registered = true;
              observeTaskFork(connection, owner, id, open);
            },
          },
        ).catch((cause: unknown) => {
          if (!registered) setFailure({ ownerKey, message: errorMessage(cause) });
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
    connection,
  ]);
  return { actions, error: failure?.ownerKey === ownerKey ? failure.message : null };
}

function transferTaskForks(connection: ClientConnection, owner: TaskForkOwner): void {
  for (const [id, stop] of owner.attempts) {
    stop();
    connection.startupAttempts.continueInBackground(id);
  }
  owner.attempts.clear();
}

function observeTaskFork(
  connection: ClientConnection,
  owner: TaskForkOwner,
  id: string,
  open: ReturnType<ReturnType<typeof useForkNavigation>>,
): void {
  if (!owner.active) {
    connection.startupAttempts.continueInBackground(id);
    return;
  }
  const stop = connection.startupAttempts.subscribe(() => {
    const attempt = connection.startupAttempts.getAttempt(id);
    if (!attempt) {
      stop();
      owner.attempts.delete(id);
      return;
    }
    if (!connection.startupAttempts.isReadyForHandoff(id) || attempt.presentation !== "inline")
      return;
    const target = attempt.navigationTarget;
    if (target?.kind !== "task_session") return;
    stop();
    owner.attempts.delete(id);
    if (owner.active && open(target, attempt.origin.repoPath))
      connection.startupAttempts.handoff(id);
    else connection.startupAttempts.continueInBackground(id);
  });
  owner.attempts.set(id, stop);
}
