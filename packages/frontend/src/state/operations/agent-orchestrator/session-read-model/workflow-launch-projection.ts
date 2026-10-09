import type { AgentSessionRecord, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { toPersistedSessionRecord, toPersistedSessionView } from "../support/persistence";
import { applyAgentSessionLiveDelta } from "./agent-session-live-projection";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { replaceAgentSession } from "@/state/agent-session-collection";

/** Present saved ownership and native activity without waiting for task-query delivery. */
export const projectWorkflowLaunch = (
  store: AgentSessionsStore,
  queryClient: QueryClient,
  outcome: WorkflowLaunchSnapshot,
): void => {
  if (
    !outcome.ownershipSaved ||
    !outcome.session ||
    store.getActivitySnapshot().workspaceRepoPath !== outcome.repoPath
  )
    return;
  const current = store.getSessionSnapshot(outcome.session) ?? undefined;
  const bound = current?.sessionAssociation.kind === "workflow";
  const key = agentSessionQueryKeys.list(outcome.repoPath, outcome.taskId);
  const saved = queryClient
    .getQueryData<AgentSessionRecord[]>(key)
    ?.find((record) => matchesAgentSessionIdentity(record, outcome.session!));
  const retained = !saved && bound ? toPersistedSessionRecord(current) : undefined;
  // Launch results fill missing ownership. Current bindings own later settings changes.
  const record: AgentSessionRecord = saved ?? {
    externalSessionId: outcome.session.externalSessionId,
    runtimeKind: outcome.session.runtimeKind,
    workingDirectory: outcome.session.workingDirectory,
    startedAt: outcome.session.startedAt,
    role: outcome.role,
    selectedModel: retained ? retained.selectedModel : (outcome.model ?? null),
    speed: retained ? retained.speed : (outcome.liveSession?.speed?.choice ?? null),
  };
  if (!saved)
    queryClient.setQueryData<AgentSessionRecord[]>(key, (records) =>
      records ? [...records, record] : undefined,
    );
  const session = toPersistedSessionView({ taskId: outcome.taskId, record, current });
  if (bound) session.selectedModel = current.selectedModel;
  if (!current && outcome.phase === "completed") {
    session.livePresence = "present";
    session.status = outcome.session.status;
  }
  store.setSessionCollection((collection) => {
    const next = replaceAgentSession(collection, session);
    return outcome.liveSession && current?.livePresence !== "present"
      ? applyAgentSessionLiveDelta({
          current: next,
          envelope: { type: "session_upsert", session: outcome.liveSession },
        })
      : next;
  });
};
