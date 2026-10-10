import type {
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { applyWorkspaceSessionRecords } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { applyAgentSessionLiveDelta } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import { host } from "@/state/operations/host";
import {
  workspaceSessionQueryKeys,
  updateWorkspaceSessionQueries,
} from "@/state/queries/workspace-sessions";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import { upsertUserSessionMessage } from "@/state/operations/agent-orchestrator/support/messages";
import { toUserChatMessage } from "@/state/operations/agent-orchestrator/support/user-message-event";

export const launchWorkspaceSession = async (
  request: WorkspaceSessionLaunchRequest,
  record: WorkspaceSession,
  store: AgentSessionsStore,
  queryClient: QueryClient,
): Promise<WorkspaceSessionLaunchResult> => {
  const outcome = await host.workspaceSessionLaunch(request);
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
  projectWorkspaceSessionLaunch(outcome, store, queryClient);
  return outcome;
};

export const projectWorkspaceSessionLaunch = (
  outcome: WorkspaceSessionLaunchResult,
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
  if (!session || !record || store.getActivitySnapshot().workspaceRepoPath !== outcome.repoPath)
    return;
  const boundRecord = record;
  store.setSessionCollection((collection) => {
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
