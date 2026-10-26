import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  createElement,
  Fragment,
  type PropsWithChildren,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { errorMessage } from "../../lib/errors";
import type { ActiveWorkspace } from "../../types/session-slices";
import {
  loadingAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
} from "../../types/agent-session-read-model";
import {
  createAgentMessageQueuesStore,
  type AgentMessageQueuesStore,
} from "../../sessions/agent-message-queues-store";
import { createAgentSessionsStore } from "../../sessions/agent-sessions-store";
import {
  useRequiredContext,
  useTaskControlContext,
  WorkspaceScopeContext,
} from "../app-state-contexts";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "../../sessions/session-contexts";
import { useAgentOrchestratorOperations } from "../../sessions/agent-orchestrator/use-agent-orchestrator-operations";
import { createAgentOrchestratorDependencies } from "../../sessions/agent-orchestrator/support/orchestrator-dependencies";
import { useClientConnection } from "../../connection/client-connection-react";
import type { AgentOrchestratorDependencies } from "../../sessions/agent-orchestrator/support/orchestrator-ports";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
import { getSessionHistoryFreshnessTracker } from "../../queries/agent-session-history-freshness-tracker";
import {
  createWorkspaceAgentSessions,
  type WorkspaceAgentSessions,
} from "../../sessions/workspace-agent-sessions";
import { WorkspaceSessionLiveSourceContext } from "../../workspace-activity/workspace-session-live-source";
import { useActiveSessionHistoryKeeper } from "../../sessions/agent-orchestrator/history/active-session-history-keeper";

const EMPTY_TASKS: TaskCard[] = [];

export function AgentStudioStateProvider({
  agentEngine,
  keepActiveTranscriptsCurrent = false,
  children,
}: PropsWithChildren<{
  agentEngine: AgentEnginePort;
  /**
   * Reads the history of active and recent sessions in each workspace before they open, as a
   * client does that loses its live stream while it sleeps (see `useActiveSessionHistoryKeeper`).
   */
  keepActiveTranscriptsCurrent?: boolean;
}>): ReactElement {
  const { activeWorkspace, workspaces } = useRequiredContext(
    WorkspaceScopeContext,
    "AgentStudioStateProvider",
  );
  const { refreshTaskData } = useTaskControlContext();
  const liveSource = useRequiredContext(
    WorkspaceSessionLiveSourceContext,
    "AgentStudioStateProvider",
  );
  const connection = useClientConnection();
  const [registry] = useState(createWorkspaceAgentSessions);
  const [messageQueues] = useState(createAgentMessageQueuesStore);
  const dependencies = useMemo(() => {
    const defaults = createAgentOrchestratorDependencies(connection);
    return {
      ...defaults,
      liveSessionHostPort: {
        ...defaults.liveSessionHostPort,
        observeAgentSessionLive: liveSource.observeAgentSessionLive,
      },
    };
  }, [connection, liveSource]);
  const unselected = useAgentOrchestratorOperations({
    activeWorkspace: null,
    tasks: EMPTY_TASKS,
    isLoadingTasks: false,
    refreshTaskData,
    agentEngine,
    dependencies,
    messageQueues,
  });
  const repoPath = activeWorkspace?.repoPath ?? null;
  const selected = useSyncExternalStore(
    registry.subscribe,
    () => registry.getController(repoPath),
    () => registry.getController(repoPath),
  );
  const sessionStore = useMemo(() => registry.createView(repoPath), [registry, repoPath]);
  const state = selected ?? unselected;
  const readModelState = useMemo(
    () =>
      !selected && repoPath
        ? {
            ...state.readModelState,
            sessionReadModelLoadState: loadingAgentSessionReadModelLoadState(repoPath),
          }
        : state.readModelState,
    [selected, repoPath, state.readModelState],
  );

  // The controller list stays one child, so a workspace change never remounts the providers.
  return createElement(
    Fragment,
    null,
    workspaces.map((workspace) =>
      createElement(WorkspaceSessionController, {
        key: JSON.stringify([workspace.workspaceId, workspace.repoPath]),
        workspace,
        agentEngine,
        registry,
        messageQueues,
        dependencies,
      }),
    ),
    keepActiveTranscriptsCurrent
      ? workspaces.map((workspace) =>
          createElement(WorkspaceHistoryKeeper, {
            key: JSON.stringify([workspace.workspaceId, workspace.repoPath]),
            repoPath: workspace.repoPath,
            registry,
          }),
        )
      : null,
    createElement(
      AgentOperationsContext.Provider,
      { value: state.operations },
      createElement(
        AgentSessionHistoryLoadContext.Provider,
        { value: state.historyLoadActions },
        createElement(
          AgentSessionReadModelStateContext.Provider,
          { value: readModelState },
          createElement(
            AgentSessionsContext.Provider,
            { value: sessionStore },
            createElement(AgentMessageQueuesContext.Provider, { value: messageQueues }, children),
          ),
        ),
      ),
    ),
  );
}

type WorkspaceControllerProps = {
  workspace: ActiveWorkspace;
  agentEngine: AgentEnginePort;
  registry: WorkspaceAgentSessions;
  messageQueues: AgentMessageQueuesStore;
  dependencies: AgentOrchestratorDependencies;
};

function WorkspaceSessionController({
  workspace,
  agentEngine,
  registry,
  messageQueues,
  dependencies,
}: WorkspaceControllerProps): null {
  const { refreshTaskData } = useTaskControlContext();
  const taskQuery = useQuery(
    repoTaskDataQueryOptions(workspace.repoPath),
    dependencies.queryClient,
  );
  const [sessionStore] = useState(() =>
    createAgentSessionsStore(
      workspace.repoPath,
      getSessionHistoryFreshnessTracker(dependencies.queryClient),
    ),
  );
  const state = useAgentOrchestratorOperations({
    activeWorkspace: workspace,
    tasks: taskQuery.data?.tasks ?? EMPTY_TASKS,
    isLoadingTasks: taskQuery.isPending || taskQuery.isError,
    refreshTaskData,
    agentEngine,
    sessionStore,
    messageQueues,
    dependencies,
  });
  const { refetch } = taskQuery;
  const controller = useMemo(
    () =>
      taskQuery.isError
        ? {
            ...state,
            readModelState: {
              ...state.readModelState,
              sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
                workspace.repoPath,
                `Failed to load workspace tasks: ${errorMessage(taskQuery.error)}`,
                "task-records",
              ),
              reloadSessionReadModel: () => {
                void refetch();
              },
            },
          }
        : state,
    [state, taskQuery.error, taskQuery.isError, refetch, workspace.repoPath],
  );
  useLayoutEffect(() => {
    registry.publish(workspace.repoPath, controller);
  }, [controller, registry, workspace.repoPath]);
  useLayoutEffect(
    () => () => {
      registry.release(workspace.repoPath);
      messageQueues.replaceRepository(workspace.repoPath, []);
    },
    [messageQueues, registry, workspace.repoPath],
  );
  return null;
}

/** Keeps the active transcripts of one workspace current once its controller is ready. */
function WorkspaceHistoryKeeper({
  repoPath,
  registry,
}: {
  repoPath: string;
  registry: WorkspaceAgentSessions;
}): null {
  const controller = useSyncExternalStore(
    registry.subscribe,
    () => registry.getController(repoPath),
    () => registry.getController(repoPath),
  );
  useActiveSessionHistoryKeeper({
    sessionStore: controller?.sessionStore ?? null,
    loadHistory: controller?.historyLoadActions.loadAgentSessionHistory ?? null,
    enabled: controller?.readModelState.sessionReadModelLoadState.kind === "ready",
  });
  return null;
}
