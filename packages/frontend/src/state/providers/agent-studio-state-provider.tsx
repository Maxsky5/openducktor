import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  type PropsWithChildren,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  loadingAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
} from "@openducktor/frontend-core/types/agent-session-read-model";
import {
  createAgentMessageQueuesStore,
  type AgentMessageQueuesStore,
} from "@openducktor/frontend-core/sessions/agent-message-queues-store";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  useRequiredContext,
  useTaskControlContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { useAgentOrchestratorOperations } from "@openducktor/frontend-core/sessions/agent-orchestrator/use-agent-orchestrator-operations";
import { createAgentOrchestratorDependencies } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/orchestrator-dependencies";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { AgentOrchestratorDependencies } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/orchestrator-ports";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { getSessionHistoryFreshnessTracker } from "@openducktor/frontend-core/queries/agent-session-history-freshness-tracker";
import {
  createWorkspaceAgentSessions,
  type WorkspaceAgentSessions,
} from "../workspace-agent-sessions";
import { WorkspaceSessionLiveSourceContext } from "../workspace-activity/workspace-session-live-source";

const EMPTY_TASKS: TaskCard[] = [];

export function AgentStudioStateProvider({
  agentEngine,
  children,
}: PropsWithChildren<{ agentEngine: AgentEnginePort }>): ReactElement {
  const { activeWorkspace, workspaces } = useRequiredContext(
    WorkspaceStateContext,
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

  return (
    <>
      {workspaces.map((workspace) => (
        <WorkspaceSessionController
          key={JSON.stringify([workspace.workspaceId, workspace.repoPath])}
          workspace={workspace}
          agentEngine={agentEngine}
          registry={registry}
          messageQueues={messageQueues}
          dependencies={dependencies}
        />
      ))}
      <AgentOperationsContext.Provider value={state.operations}>
        <AgentSessionHistoryLoadContext.Provider value={state.historyLoadActions}>
          <AgentSessionReadModelStateContext.Provider value={readModelState}>
            <AgentSessionsContext.Provider value={sessionStore}>
              <AgentMessageQueuesContext.Provider value={messageQueues}>
                {children}
              </AgentMessageQueuesContext.Provider>
            </AgentSessionsContext.Provider>
          </AgentSessionReadModelStateContext.Provider>
        </AgentSessionHistoryLoadContext.Provider>
      </AgentOperationsContext.Provider>
    </>
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
