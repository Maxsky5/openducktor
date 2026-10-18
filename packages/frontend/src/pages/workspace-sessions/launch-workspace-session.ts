import type {
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { applyWorkspaceSessionRecords } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { applyAgentSessionLiveDelta } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/agent-session-live-projection";
import {
  workspaceSessionQueryKeys,
  updateWorkspaceSessionQueries,
} from "@openducktor/frontend-core/queries/workspace-sessions";
import {
  getAgentSession,
  replaceAgentSession,
} from "@openducktor/frontend-core/sessions/agent-session-collection";
import { upsertUserSessionMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { toUserChatMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/user-message-event";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";

export const launchWorkspaceSession = async (
  request: WorkspaceSessionLaunchRequest,
  record: WorkspaceSession,
  store: AgentSessionsStore,
  queryClient: QueryClient,
): Promise<WorkspaceSessionLaunchResult> => {
  const outcome = await connectionHost(queryClient).workspaceSessionLaunch(request);
  if (
    outcome.record &&
    (outcome.record.id !== record.id ||
      outcome.record.runtimeKind !== record.runtimeKind ||
      outcome.record.executionTarget.kind !== record.executionTarget.kind ||
      outcome.record.executionTarget.workingDirectory !== record.executionTarget.workingDirectory)
  )
    throw new Error(
      "The host started a different chat target. Reopen this chat before sending your draft.",
    );
  projectWorkspaceSessionResult(outcome, store, queryClient);
  return outcome;
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
