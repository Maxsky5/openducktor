import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import {
  toHostOperationError,
  type HostError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";

type RunBackground = (work: Effect.Effect<void, HostError>) => void;

export const createWorkflowWorkspaceObservation =
  (
    live: Pick<AgentSessionLiveStateService, "refresh">,
    report: (failure: HostOperationErrorAggregate) => Effect.Effect<void>,
    runBackground: RunBackground,
  ) =>
  (repoPath: string) =>
    runBackground(
      live
        .refresh({ repoPath })
        .pipe(
          Effect.catch((cause) =>
            report(toHostOperationError(cause, "workflow.observe-workspace")),
          ),
        ),
    );

type TaskSessions = ReturnType<
  typeof import("./node-task-session-services").createNodeTaskSessionServices
>;
export const createWorkflowLiveObserver =
  (readServices: () => TaskSessions, runBackground: RunBackground) =>
  (envelope: import("@openducktor/contracts").AgentSessionLiveEnvelope) => {
    const services = readServices();
    services.approvalPolicy.observe(envelope);
    if (
      envelope.type === "snapshot" ||
      envelope.type === "session_upsert" ||
      (envelope.type === "transcript_event" && envelope.event.type === "user_message")
    )
      runBackground(services.agentSessionCommandService.observeOperation(envelope));
  };
export const workflowShutdown = (
  launches: Pick<
    import("../../application/agent-sessions/session-launch-types").SessionLaunchControls,
    "shutdown"
  >,
  commands: TaskSessions["agentSessionCommandService"],
  services: TaskSessions,
) =>
  launches
    .shutdown()
    .pipe(
      Effect.ensuring(commands.shutdownOperations()),
      Effect.ensuring(services.approvalPolicy.shutdown()),
      Effect.ensuring(services.shutdownCompletionOperations()),
    );

/** Observe admitted workspaces before native runtimes can publish pending work. */
export const initializeWorkflowObservation = (
  settings: WorkspaceSettingsService,
  live: AgentSessionLiveStateService,
) =>
  settings.getSettingsSnapshot().pipe(
    Effect.flatMap((snapshot) =>
      Effect.forEach(
        Object.values(snapshot.workspaces),
        (config) => live.refresh({ repoPath: config.repoPath }),
        { discard: true },
      ),
    ),
    Effect.mapError((cause) => toHostOperationError(cause, "host.initialize-observation")),
  );
