import {
  globalConfigSchema,
  type RepoConfig,
  repoConfigSchema,
  workspaceAgentStudioStateSchema,
  type WorkspaceAgentStudioState,
  type WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import type { LoadedGlobalConfig } from "../../config/global-config";
import { requireConfiguredWorkspace } from "./workspace-settings-model";

export const applyAgentStudioStateAction = (
  state: WorkspaceAgentStudioState,
  action: WorkspaceAgentStudioStateAction,
): WorkspaceAgentStudioState => {
  if (action.type === "ensure_tab") {
    return state.openTaskIds.includes(action.taskId)
      ? state
      : { ...state, openTaskIds: [...state.openTaskIds, action.taskId] };
  }
  if (action.type === "set_active_task") {
    const activeTask = action.activeTask ?? undefined;
    const openTaskIds =
      activeTask && !state.openTaskIds.includes(activeTask.taskId)
        ? [...state.openTaskIds, activeTask.taskId]
        : state.openTaskIds;
    const nextState: WorkspaceAgentStudioState = { openTaskIds };
    if (activeTask) {
      nextState.activeTask = activeTask;
    }
    return nextState;
  }

  const baseIds = new Set(action.baseOpenTaskIds);
  const nextIds = new Set(action.openTaskIds);
  const removedIds = new Set([...baseIds].filter((taskId) => !nextIds.has(taskId)));
  const addedIds = new Set([...nextIds].filter((taskId) => !baseIds.has(taskId)));
  const retainedIds = state.openTaskIds.filter((taskId) => !removedIds.has(taskId));
  const availableIds = new Set([...retainedIds, ...addedIds]);
  const openTaskIds = [
    ...action.openTaskIds.filter((taskId) => availableIds.delete(taskId)),
    ...retainedIds.filter((taskId) => availableIds.delete(taskId)),
  ];
  const activeTask =
    action.type === "sync_snapshot"
      ? (action.activeTask ?? undefined)
      : action.activeTaskId
        ? state.activeTask?.taskId === action.activeTaskId
          ? state.activeTask
          : { taskId: action.activeTaskId }
        : undefined;
  const nextState: WorkspaceAgentStudioState = { openTaskIds };
  if (activeTask) {
    nextState.activeTask = activeTask;
  }
  return nextState;
};

export const buildAgentStudioStateUpdate = (
  config: LoadedGlobalConfig,
  workspaceId: string,
  state: RepoConfig["agentStudioState"],
) => {
  const repoConfig = repoConfigSchema.parse({
    ...requireConfiguredWorkspace(config, workspaceId),
    agentStudioState: workspaceAgentStudioStateSchema.parse(state),
  });
  const nextConfig = globalConfigSchema.parse({
    ...config,
    workspaces: {
      ...config.workspaces,
      [workspaceId]: repoConfig,
    },
  });

  return { config: nextConfig, repoConfig };
};
