import { Effect } from "effect";
import type { AgentSessionLiveFaultLogger } from "../../application/agent-sessions/agent-session-live-state-service";
import {
  createWorkspaceSessionRuntimePersistence,
  type WorkspaceSessionTitleSyncFailureReporter,
  type WorkspaceSessionUpdatedPublisher,
} from "../../application/workspaces/workspace-session-runtime-persistence";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createWorkspaceSessionOperationGate } from "../../application/workspaces/workspace-session-operation-gate";
import { createLiveSessionPublisher } from "./runtime-lifecycle-publisher";

export const createNodeWorkspaceSessionPersistence = ({
  eventBus,
  faultLog,
  ...dependencies
}: Omit<
  Parameters<typeof createWorkspaceSessionRuntimePersistence>[0],
  "publishUpdated" | "operationGate" | "sessionTitleGate" | "reportTitleSyncFailure"
> & {
  eventBus: HostEventBusPort | undefined;
  faultLog: AgentSessionLiveFaultLogger;
}) => {
  const operationGate = createWorkspaceSessionOperationGate();
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
  const reportTitleSyncFailure: WorkspaceSessionTitleSyncFailureReporter = (ref, message) =>
    Effect.try({
      try: () =>
        publishLiveEnvelope({
          type: "fault",
          repoPath: ref.repoPath,
          ref,
          operation: "workspaceSession.accepted-message.title-sync",
          message,
        }),
      catch: (cause) =>
        new HostOperationError({
          operation: "workspaceSession.title-sync.publish-failure",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.catchAll((failure) =>
        faultLog(`Workspace Session title sync failure report failed: ${failure.message}`).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      ),
    );
  return {
    persistence: createWorkspaceSessionRuntimePersistence({
      ...dependencies,
      publishUpdated,
      operationGate,
      sessionTitleGate,
      reportTitleSyncFailure,
    }),
    publishUpdated,
    operationGate,
    sessionTitleGate,
  };
};
