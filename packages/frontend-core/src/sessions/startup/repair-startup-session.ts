import type { WorkspaceSessionStartResult } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { connectionOf } from "../../connection/client-connection";
import { errorMessage } from "../../lib/errors";
import { updateWorkspaceSessionQueries } from "../../queries/workspace-sessions";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { projectWorkspaceSessionResult } from "../../workspace-sessions/create/launch-workspace-session";
import {
  observeStartupPreparation,
  releaseStartupPreparationAttempt,
} from "./startup-prepared-handoff";

async function executeWorkspaceStartupRepair({
  queryClient,
  sessions,
  attemptId,
  workspaceId,
  repoPath,
  sessionId,
}: {
  queryClient: QueryClient;
  sessions: AgentSessionsStore;
  attemptId: string;
  workspaceId: string;
  repoPath: string;
  sessionId: string;
}): Promise<WorkspaceSessionStartResult> {
  const connection = connectionOf(queryClient);
  const attempts = connection.startupAttempts;
  releaseStartupPreparationAttempt(queryClient, attemptId);
  const result = await attempts.operation(
    attemptId,
    (startup) =>
      connection.host.client.workspaceSessionStart({
        workspaceId,
        sessionId,
        startup,
      }),
    {
      beforeDispatch: () => observeStartupPreparation(queryClient, repoPath, attemptId),
    },
  );
  attempts.setSaved(attemptId, {
    state: "saved",
    target: {
      kind: "workspace",
      record: result.session,
      ...(result.runtimeSession && { runtimeSession: result.runtimeSession }),
    },
  });
  updateWorkspaceSessionQueries(queryClient, workspaceId, result.session);
  try {
    projectWorkspaceSessionResult(
      {
        workspaceId,
        repoPath,
        record: result.session,
        session: result.runtimeSession ?? undefined,
      },
      sessions,
      queryClient,
    );
  } catch (cause) {
    console.error("Cannot show the repaired workspace session.", cause);
  }
  return result;
}

/** Repair prepares the retained record. It never repeats a create or fork command. */
export function installStartupSessionRepair(
  queryClient: QueryClient,
  sessions: AgentSessionsStore,
  id: string,
): void {
  const connection = connectionOf(queryClient);
  const attempts = connection.startupAttempts;
  const attempt = attempts.getAttempt(id);
  if (
    attempt?.ownership.state !== "saved" ||
    attempt.status.phase !== "failed" ||
    attempt.status.confirmation !== "current" ||
    attempt.prepared
  )
    return;
  attempts.setRecoveryActions(id, [
    {
      kind: "repair",
      label: "Retry session preparation",
      run: async () => {
        const current = attempts.getAttempt(id);
        if (
          current?.ownership.state !== "saved" ||
          current.status.phase !== "failed" ||
          current.status.confirmation !== "current"
        )
          return;
        const target = current.ownership.target;
        try {
          if (target.kind === "workspace") {
            const result = await executeWorkspaceStartupRepair({
              queryClient,
              sessions,
              attemptId: id,
              workspaceId: current.origin.workspaceId,
              repoPath: current.origin.repoPath,
              sessionId: target.record.id,
            });
            if (!result.startupProgress?.prepared)
              throw new Error("Session preparation is unconfirmed. Inspect the saved session.");
          } else {
            const scope = current.origin.scope;
            if (scope.kind !== "task") return;
            releaseStartupPreparationAttempt(queryClient, id);
            const result = await attempts.operation(
              id,
              (startup) =>
                connection.host.client.agentSessionControlResume({
                  repoPath: current.origin.repoPath,
                  runtimeKind: target.record.runtimeKind,
                  externalSessionId: target.record.externalSessionId,
                  workingDirectory: target.record.workingDirectory,
                  sessionScope: {
                    kind: "workflow",
                    workspaceId: current.origin.workspaceId,
                    taskId: scope.taskId,
                    role: target.record.role,
                  },
                  resumeMode: "reattach",
                  startup,
                }),
              {
                beforeDispatch: () =>
                  observeStartupPreparation(queryClient, current.origin.repoPath, id),
              },
            );
            if (!result.startupProgress?.prepared)
              throw new Error("Session preparation is unconfirmed. Inspect the saved session.");
          }
          await attempts.complete(id, { preparedOnly: target.kind === "workspace" });
        } catch (cause) {
          const latest = attempts.getAttempt(id);
          if (latest && !["failed", "canceled"].includes(latest.status.phase))
            attempts.fail(id, errorMessage(cause), false);
          installStartupSessionRepair(queryClient, sessions, id);
        }
      },
    },
  ]);
}
