import type { AgentSessionAuthorizedRoot } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { TaskSyncService } from "../../application/tasks/sync/task-sync-service";
import {
  createMovedTaskPublisher,
  createRunningTaskSessionsReader,
} from "../../application/workflow-library/workflow-library-host-effects";
import { createWorkflowLibraryService } from "../../application/workflow-library/workflow-library-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { HostError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createWorkflowLibraryCommandHandlers } from "../../interface/commands/workflow-library-command-handlers";
import type { WorkflowLibraryStorePort } from "../../ports/workflow-library-store-port";

/** The workflow library commands, with live sessions, task events, and the library event. */
export const createNodeWorkflowLibraryCommandHandlers = ({
  store,
  eventBus,
  live,
  readSessionRootRefs,
  settings,
  taskSync,
}: {
  store: WorkflowLibraryStorePort;
  eventBus: HostEventBusPort | undefined;
  live: Pick<AgentSessionLiveStateService, "list">;
  readSessionRootRefs: (repoPath: string) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
  settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  taskSync: Pick<TaskSyncService, "publishTasksUpdated">;
}) =>
  createWorkflowLibraryCommandHandlers(
    createWorkflowLibraryService({
      store,
      runningTaskSessions: createRunningTaskSessionsReader({ live, readSessionRootRefs, settings }),
      publishMovedTasks: createMovedTaskPublisher({ settings, taskSync }),
      publishLibraryChanged: () =>
        eventBus?.publish({ channel: "openducktor://workflow-library-changed", payload: {} }),
    }),
  );
