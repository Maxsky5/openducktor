import { Effect } from "effect";
import type { AgentSessionLiveFaultLogger } from "../../application/agent-sessions/agent-session-live-state-service";
import {
  createWorkspaceSessionRuntimePersistence,
  type WorkspaceSessionRenameFailureReporter,
  type WorkspaceSessionUpdatedPublisher,
} from "../../application/workspaces/workspace-session-runtime-persistence";
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
  ...dependencies
}: Omit<
  Parameters<typeof createWorkspaceSessionRuntimePersistence>[0],
  "publishUpdated" | "operationGate" | "sessionTitleGate" | "reportRenameFailure"
> & {
  eventBus: HostEventBusPort | undefined;
  faultLog: AgentSessionLiveFaultLogger;
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
  const reportRenameFailure: WorkspaceSessionRenameFailureReporter = (ref, message) =>
    Effect.try({
      try: () => {
        publishLiveEnvelope({
          type: "fault",
          repoPath: ref.repoPath,
          ref,
          operation: "workspaceSession.accepted-message.rename",
          message,
        });
      },
      catch: (cause) => toHostOperationError(cause, "workspaceSession.rename.report-publish"),
    }).pipe(
      Effect.catchAll((failure) =>
        faultLog(`Failed to report a Workspace Session rename failure: ${failure.message}`),
      ),
      Effect.ignore,
    );
  return {
    persistence: createWorkspaceSessionRuntimePersistence({
      ...dependencies,
      publishUpdated,
      operationGate,
      sessionTitleGate,
      reportRenameFailure,
    }),
    publishUpdated,
    operationGate,
    sessionTitleGate,
  };
};
