import type { WorkspaceRef } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  subscribeHandoffCommit,
  useRuntimeHandoff,
} from "@openducktor/frontend-core/sessions/send/runtime-handoff";
import { useTaskRuntimeHandoff } from "@openducktor/frontend-core/sessions/send/use-task-runtime-handoff";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useEffect, useEffectEvent } from "react";
import {
  toAgentStudioSessionSelection,
  type SelectAgentStudioSelection,
} from "../shell/agent-studio-selection-state";

export function useAgentStudioRuntimeHandoff(
  scope: (WorkspaceRef & { taskId: string; role: string | null }) | null,
  identity: AgentSessionIdentity | null,
  handoffSource: AgentSessionIdentity | undefined,
  select: SelectAgentStudioSelection,
) {
  const role = scope?.role;
  const taskId = scope?.taskId;
  const repoPath = scope?.repoPath;
  const handoff = useTaskRuntimeHandoff(
    scope && taskId && role ? { ...scope, role } : null,
    identity,
  );
  const active = handoff && matchesAgentSessionIdentity(identity, handoff.active);
  const connection = useClientConnection();
  const sessions = useAgentSessionsContext();
  const navigate = useEffectEvent(select);
  const source = handoffSource ?? identity;
  useEffect(() => {
    if (!source || !taskId || !role || !repoPath) return;
    return subscribeHandoffCommit(connection, sessions, repoPath, source, ({ to }) => {
      navigate(toAgentStudioSessionSelection({ ...to, taskId, role }));
    });
  }, [connection, source, repoPath, role, sessions, taskId]);
  return useRuntimeHandoff(active ? (handoff?.chat ?? null) : null, source);
}
