import { Effect } from "effect";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { createAgentSessionTurnRecorder } from "../../application/agent-sessions/agent-session-turn-recorder";
import type { AgentSessionTurnStorePort } from "../../ports/agent-session-turn-store-port";
import { normalizePathForComparison } from "../../domain/path-comparison";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";
import { createAgentSessionActivityPersistence } from "../../application/agent-sessions/agent-session-activity-persistence";
import type { TaskStorePort } from "../../ports/task-repository-ports";
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
import type { NamingService } from "../../application/naming/naming-service";

// Resolve live state in the title callback at call time. Composition creates persistence first.
export const createNodeWorkspaceSessionPersistence = ({
  eventBus,
  faultLog,
  taskStore,
  stores: { workspaceSessionStore: store, agentSessionTurnStore: sessionTurns },
  naming,
  ...dependencies
}: Omit<
  Parameters<typeof createWorkspaceSessionRuntimePersistence>[0],
  | "publishUpdated"
  | "operationGate"
  | "sessionTitleGate"
  | "reportRenameFailure"
  | "naming"
  | "store"
> & {
  naming: NamingService;
  eventBus: HostEventBusPort | undefined;
  faultLog: AgentSessionLiveFaultLogger;
  taskStore: Pick<TaskStorePort, "recordAgentSessionActivity">;
  /** The saved Workspace Sessions and the turns of every runtime session. */
  stores: {
    workspaceSessionStore: WorkspaceSessionStorePort;
    agentSessionTurnStore: AgentSessionTurnStorePort;
  };
  settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog" | "getRepoConfig">;
}) => {
  const readSessionRootRefs = createLiveSessionRootRefsReader({
    store,
    settings: dependencies.settings,
  });
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
        // Callers can pass a send input. The fault names only the session.
        publishLiveEnvelope({
          type: "fault",
          repoPath: ref.repoPath,
          ref: {
            repoPath: ref.repoPath,
            runtimeKind: ref.runtimeKind,
            workingDirectory: ref.workingDirectory,
            externalSessionId: ref.externalSessionId,
          },
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
    store,
    publishUpdated,
    operationGate,
    sessionTitleGate,
    reportRenameFailure,
    naming: {
      service: naming,
      settings: dependencies.settings,
    },
  });
  // Saved sessions can receive activity after their task closes.
  const readOpenWorkspace = (ref: AgentSessionLiveRef) =>
    dependencies.settings.getWorkspaceCatalog().pipe(
      Effect.map((catalog) => {
        const workspace = catalog.openWorkspaces.find(
          (candidate) =>
            normalizePathForComparison(candidate.repoPath) ===
            normalizePathForComparison(ref.repoPath),
        );
        return workspace ? { workspaceId: workspace.workspaceId, repoPath: ref.repoPath } : null;
      }),
    );
  const activityPersistence = createAgentSessionActivityPersistence({
    tasks: taskStore,
    readTaskWorkspace: readOpenWorkspace,
    workspace: workspacePersistence,
    turns: createAgentSessionTurnRecorder(sessionTurns),
    publishTaskRecords: (scope, records) =>
      Effect.try({
        try: () =>
          publishLiveEnvelope({ type: "task_session_records_updated", ...scope, ...records }),
        catch: (cause) => toHostOperationError(cause, "agent-session.persist-activity.publish"),
      }),
  });
  const persistence = { ...workspacePersistence, ...activityPersistence };
  return {
    persistence,
    store,
    readSessionRootRefs,
    publishUpdated,
    operationGate,
    sessionTitleGate,
    chatNaming: {
      registerCreated: workspacePersistence.registerCreated,
    },
    isTitleSyncPending: persistence.isTitleSyncPending,
    markTitleSyncPending: persistence.markTitleSyncPending,
  };
};
