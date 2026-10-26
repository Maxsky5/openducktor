import type {
  WorkspaceSession,
  WorkspaceSessionLaunchResult,
  WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionsStore } from "../../sessions/agent-sessions-store";
import { applyWorkspaceSessionRecords } from "../../sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { applyAgentSessionLiveDelta } from "../../sessions/agent-orchestrator/session-read-model/agent-session-live-projection";
import {
  workspaceSessionQueryKeys,
  updateWorkspaceSessionQueries,
} from "../../queries/workspace-sessions";
import { getAgentSession, replaceAgentSession } from "../../sessions/agent-session-collection";
import { upsertUserSessionMessage } from "../../sessions/agent-orchestrator/support/messages";
import { toUserChatMessage } from "../../sessions/agent-orchestrator/support/user-message-event";

/**
 * Starts or reuses the runtime session of a saved chat. The result goes into the chat reads and
 * the session store before it returns, so the chat shows its runtime session at once.
 */
export const startWorkspaceSessionRuntime = async ({
  host,
  store,
  queryClient,
  workspace,
  sessionId,
}: {
  host: Pick<HostClient, "workspaceSessionStart">;
  store: AgentSessionsStore;
  queryClient: QueryClient;
  workspace: { workspaceId: string; repoPath: string };
  sessionId: string;
}): Promise<WorkspaceSessionStartResult> => {
  const result = await host.workspaceSessionStart({
    workspaceId: workspace.workspaceId,
    sessionId,
  });
  projectWorkspaceSessionResult(
    {
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
      record: result.session,
      session: result.runtimeSession ?? undefined,
    },
    store,
    queryClient,
  );
  return result;
};

export const projectWorkspaceSessionResult = (
  outcome: Pick<
    WorkspaceSessionLaunchResult,
    "record" | "workspaceId" | "repoPath" | "session" | "acceptedMessage"
  >,
  store: AgentSessionsStore,
  queryClient: QueryClient,
) => {
  let record = outcome.record;
  if (record) {
    for (const archived of [false, true]) {
      const cached = queryClient
        .getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list(outcome.workspaceId, archived),
        )
        ?.find((entry) => entry.id === record!.id);
      // Metadata events own bound records. updatedAt measures message activity, not edits.
      if (cached?.externalSessionId) record = cached;
    }
    updateWorkspaceSessionQueries(queryClient, outcome.workspaceId, record);
  }
  const { session } = outcome;
  const workspaceStore = store.getWorkspaceStore(outcome.repoPath);
  if (!session || !record || !workspaceStore) return;
  const boundRecord = record;
  workspaceStore.setSessionCollection((collection) => {
    const current = getAgentSession(collection, session);
    let next = applyWorkspaceSessionRecords(collection, [boundRecord]);
    if (outcome.acceptedMessage?.type === "user_message") {
      const withRecords = getAgentSession(next, session);
      if (withRecords)
        next = replaceAgentSession(next, {
          ...withRecords,
          messages: upsertUserSessionMessage(
            withRecords,
            toUserChatMessage(outcome.acceptedMessage),
          ),
        });
    }
    if (outcome.acceptedMessage?.type === "user_message" && current?.livePresence !== "present")
      next = applyAgentSessionLiveDelta({
        current: next,
        envelope: {
          type: "transcript_event",
          event: {
            ...outcome.acceptedMessage,
            sessionRef: {
              repoPath: outcome.repoPath,
              runtimeKind: session.runtimeKind,
              externalSessionId: session.externalSessionId,
              workingDirectory: session.workingDirectory,
            },
          },
        },
      });
    return next;
  });
};
