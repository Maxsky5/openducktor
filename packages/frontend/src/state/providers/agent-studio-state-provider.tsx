import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PropsWithChildren,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { errorMessage } from "@/lib/errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  loadingAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import {
  createAgentMessageQueuesStore,
  type AgentMessageQueuesStore,
} from "../agent-message-queues-store";
import { createAgentSessionsStore } from "../agent-sessions-store";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  useRequiredContext,
  useTaskControlContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAgentOrchestratorOperations } from "../operations/agent-orchestrator/use-agent-orchestrator-operations";
import { createDefaultAgentOrchestratorDependencies } from "../operations/agent-orchestrator/support/orchestrator-dependency-defaults";
import type { AgentOrchestratorDependencies } from "../operations/agent-orchestrator/support/orchestrator-ports";
import { repoTaskDataQueryOptions } from "../queries/tasks";
import { getSessionHistoryFreshnessTracker } from "../queries/agent-session-history-freshness-tracker";
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
  const queryClient = useQueryClient();
  const [registry] = useState(createWorkspaceAgentSessions);
  const [messageQueues] = useState(createAgentMessageQueuesStore);
  const dependencies = useMemo(() => {
    const defaults = createDefaultAgentOrchestratorDependencies();
    return {
      ...defaults,
      queryClient,
      liveSessionHostPort: {
        ...defaults.liveSessionHostPort,
        observeAgentSessionLive: liveSource.observeAgentSessionLive,
      },
    };
  }, [liveSource, queryClient]);
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
