import type {
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchSnapshot,
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
import { errorMessage } from "@/lib/errors";
import { workspaceSessionLaunchQueryOptions } from "@/state/queries/workspace-session-launches";

export const launchWorkspaceSession = async (
  request: WorkspaceSessionLaunchRequest,
  record: WorkspaceSession,
  store: AgentSessionsStore,
  queryClient: QueryClient,
): Promise<WorkspaceSessionLaunchSnapshot> => {
  let outcome: WorkspaceSessionLaunchSnapshot;
  try {
    outcome = await host.workspaceSessionLaunch(request);
  } catch (cause) {
    const { launchAttemptId, workspaceId, repoPath, sessionId } = request;
    let retained: WorkspaceSessionLaunchSnapshot | undefined;
    const guidance = `${errorMessage(cause)}. Inspect launch '${launchAttemptId}' after reconnect before sending another instruction.`;
    try {
      [retained] = await queryClient.fetchQuery(
        workspaceSessionLaunchQueryOptions({ launchAttemptId, workspaceId, repoPath, sessionId }),
      );
    } catch (readCause) {
      throw new Error(`${guidance} Read failed: ${errorMessage(readCause)}`, { cause });
    }
    if (!retained || ["queued", "preparing", "sending"].includes(retained.phase))
      throw new Error(guidance, { cause });
    outcome = retained;
  }
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
  outcome: WorkspaceSessionLaunchSnapshot,
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
  if (
    !outcome.ownershipSaved ||
    !record ||
    store.getActivitySnapshot().workspaceRepoPath !== outcome.repoPath
  )
    return;
  store.setSessionCollection((collection) => {
    const current = outcome.session ? getAgentSession(collection, outcome.session) : undefined;
    let next = applyWorkspaceSessionRecords(collection, [record!]);
    if (outcome.acceptedMessage && outcome.session) {
      const current = getAgentSession(next, outcome.session);
      if (current)
        next = replaceAgentSession(next, {
          ...current,
          messages: upsertUserSessionMessage(current, toUserChatMessage(outcome.acceptedMessage)),
        });
    }
    if (outcome.acceptedMessage && outcome.session && current?.livePresence !== "present")
      next = applyAgentSessionLiveDelta({
        current: next,
        envelope: {
          type: "transcript_event",
          event: {
            ...outcome.acceptedMessage,
            sessionRef: {
              repoPath: outcome.repoPath,
              runtimeKind: outcome.session.runtimeKind,
              externalSessionId: outcome.session.externalSessionId,
              workingDirectory: outcome.session.workingDirectory,
            },
          },
        },
      });
    if (outcome.liveSession && current?.livePresence !== "present")
      next = applyAgentSessionLiveDelta({
        current: next,
        envelope: { type: "session_upsert", session: outcome.liveSession },
      });
    return next;
  });
};
