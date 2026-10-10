import type { AgentSessionRecord, WorkflowLaunchResult } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { toPersistedSessionRecord, toPersistedSessionView } from "../support/persistence";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { replaceAgentSession } from "@/state/agent-session-collection";

/**
 * Shows the saved session before the task query returns it. A new session from a completed launch
 * starts as live. The live stream owns all later activity.
 */
export const projectWorkflowLaunch = (
  store: AgentSessionsStore,
  queryClient: QueryClient,
  outcome: WorkflowLaunchResult,
): void => {
  if (!outcome.session || store.getActivitySnapshot().workspaceRepoPath !== outcome.repoPath)
    return;
  const current = store.getSessionSnapshot(outcome.session) ?? undefined;
  const bound = current?.sessionAssociation.kind === "workflow";
  const key = agentSessionQueryKeys.list(outcome.repoPath, outcome.taskId);
  const saved = queryClient
    .getQueryData<AgentSessionRecord[]>(key)
    ?.find((record) => matchesAgentSessionIdentity(record, outcome.session!));
  // Launch results fill missing ownership. Current bindings own later model changes.
  const record: AgentSessionRecord = saved ?? {
    externalSessionId: outcome.session.externalSessionId,
    runtimeKind: outcome.session.runtimeKind,
    workingDirectory: outcome.session.workingDirectory,
    startedAt: outcome.session.startedAt,
    role: outcome.role,
    selectedModel: bound
      ? toPersistedSessionRecord(current).selectedModel
      : (outcome.model ?? null),
  };
  if (!saved)
    queryClient.setQueryData<AgentSessionRecord[]>(key, (records) =>
      records ? [...records, record] : undefined,
    );
  const session = toPersistedSessionView({ taskId: outcome.taskId, record, current });
  if (bound) session.selectedModel = current.selectedModel;
  if (!current && outcome.status === "completed") {
    session.livePresence = "present";
    session.status = outcome.session.status;
  }
  store.setSessionCollection((collection) => replaceAgentSession(collection, session));
};
