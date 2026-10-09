import { Effect } from "effect";
import { createSessionSpeedWriter } from "../../application/agent-sessions/agent-session-speed-persistence";
import { createAgentSessionActivityPersistence } from "../../application/agent-sessions/agent-session-activity-persistence";
import type { AgentSessionRepository } from "../../ports/task-repository-ports";
import type { AgentSessionLiveFaultLogger } from "../../application/agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionRuntimePersistence } from "../../application/workspaces/workspace-session-runtime-persistence";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionUpdatedPublisher,
} from "../../application/workspaces/workspace-session-persistence-callbacks";
import {
  HostOperationError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createWorkspaceSessionOperationGate } from "../../application/workspaces/workspace-session-operation-gate";
import { createLiveSessionPublisher } from "./runtime-lifecycle-publisher";

export const createNodeWorkspaceSessionPersistence = ({
  eventBus,
  faultLog,
  taskStore,
  ...dependencies
}: Omit<
  Parameters<typeof createWorkspaceSessionRuntimePersistence>[0],
  "publishUpdated" | "operationGate" | "sessionTitleGate" | "reportRenameFailure"
> & {
  eventBus: HostEventBusPort | undefined;
  faultLog: AgentSessionLiveFaultLogger;
  taskStore: Pick<
    AgentSessionRepository,
    "recordAgentSessionActivity" | "listAgentSessionsForTasks" | "updateAgentSessionModel"
  >;
}) => {
  const operationGate = createWorkspaceSessionOperationGate();
  // Title transitions serialize on their own gate, because an observed message
  // renames the runtime session without an operation. Always acquire the
  // operation gate before the title gate, never the reverse.
  const sessionTitleGate = createWorkspaceSessionOperationGate();
  const publishLiveEnvelope = createLiveSessionPublisher(eventBus);
  const publishUpdated: WorkspaceSessionUpdatedPublisher = (workspaceId, session) =>
    Effect.try({
      try: () => {
        if (!eventBus)
          throw new HostResourceError({
            resource: "host-event-bus",
            operation: "workspaceSession.publish",
            message: "Workspace Session updates require a configured host event bus.",
          });
        eventBus.publish({
          channel: "openducktor://workspace-session-updated",
          payload: { workspaceId, session },
        });
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "workspaceSession.publish",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  const reportRenameFailure: WorkspaceSessionRenameFailureReporter = (ref, message, operation) =>
    Effect.try({
      try: () => {
        publishLiveEnvelope({
          type: "fault",
          repoPath: ref.repoPath,
          ref,
          operation: operation ?? "workspaceSession.accepted-message.rename",
          message,
        });
      },
      catch: (cause) => toHostOperationError(cause, "workspaceSession.rename.report-publish"),
    }).pipe(
      Effect.catch((failure) =>
        faultLog(`Failed to report a Workspace Session rename failure: ${failure.message}`),
      ),
      Effect.ignore,
    );
  const workspacePersistence = createWorkspaceSessionRuntimePersistence({
    ...dependencies,
    publishUpdated,
    operationGate,
    sessionTitleGate,
    reportRenameFailure,
  });
  const persistence = {
    ...workspacePersistence,
    recordSpeedChoice: createSessionSpeedWriter({
      ...dependencies,
      taskStore,
      publishWorkspace: publishUpdated,
      publishTask: (repoPath, taskId) =>
        taskStore.listAgentSessionsForTasks({ repoPath, taskIds: [taskId] }).pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "agent-session.publish-speed")),
          Effect.flatMap((records) =>
            Effect.try({
              try: () => {
                for (const record of records)
                  publishLiveEnvelope({
                    type: "task_session_records_updated",
                    repoPath,
                    ...record,
                  });
              },
              catch: (cause) => toHostOperationError(cause, "agent-session.publish-speed"),
            }),
          ),
        ),
    }),
    ...createAgentSessionActivityPersistence({
      tasks: taskStore,
      workspace: workspacePersistence,
      publishTaskRecords: (repoPath, records) =>
        Effect.try({
          try: () =>
            publishLiveEnvelope({ type: "task_session_records_updated", repoPath, ...records }),
          catch: (cause) => toHostOperationError(cause, "agent-session.persist-activity.publish"),
        }),
    }),
  };
  return {
    persistence,
    publishUpdated,
    operationGate,
    sessionTitleGate,
    isTitleSyncPending: persistence.isTitleSyncPending,
    markTitleSyncPending: persistence.markTitleSyncPending,
  };
};
