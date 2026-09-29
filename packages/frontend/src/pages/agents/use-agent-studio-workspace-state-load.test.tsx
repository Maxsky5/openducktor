import { describe, expect, mock, test } from "bun:test";
import type {
  RepoConfig,
  WorkspaceAgentStudioState,
  WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import { createQueryClient } from "@/lib/query-client";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import {
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import {
  createAgentSessionSummaryFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioQuerySync } from "./query-sync/use-agent-studio-query-sync";
import type { AgentStudioQueryUpdate } from "./query-sync/agent-studio-navigation";
import { toAgentStudioSessionSelection } from "./shell/agent-studio-selection-state";
import { useAgentStudioSelectionState } from "./shell/use-agent-studio-selection-state";
import { buildAgentStudioStateLoad } from "./agent-studio-workspace-state-load-model";
import { addTaskToWorkspaceAgentStudioState } from "./agent-studio-state-host";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";
import { useTaskTabState } from "./use-agent-studio-task-tabs-state";
import { useAgentStudioWorkspaceStateLoad } from "./use-agent-studio-workspace-state-load";
import { useAgentStudioWorkspaceStateSave } from "./use-agent-studio-workspace-state-save";
import { useAgentStudioTabStateChange } from "./use-agent-studio-tab-state-change";

enableReactActEnvironment();

type LoadHookArgs = Parameters<typeof useAgentStudioWorkspaceStateLoad>[0];

const createRepoConfig = (agentStudioState: WorkspaceAgentStudioState): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState,
});

const tasks = [
  createTaskCardFixture({ id: "task-1", title: "Task 1" }),
  createTaskCardFixture({ id: "task-2", title: "Task 2" }),
];
const emptySearchParams = new URLSearchParams();

const useWorkspaceRestore = (args: LoadHookArgs) => {
  const load = useAgentStudioWorkspaceStateLoad(args);
  const navigation = useAgentStudioQuerySync({
    activeWorkspaceId: args.activeWorkspaceId,
    agentStudioState: load.agentStudioState,
    isLoadingAgentStudioState: load.isLoading,
    agentStudioStateError: load.error,
    retryAgentStudioStateLoad: load.retry,
    locationKey: "location-1",
    navigationType: "REPLACE",
    searchParams: emptySearchParams,
    setSearchParams: () => {},
  });
  const selectedTask = args.tasks.find((task) => task.id === navigation.taskIdParam) ?? null;
  const tabs = useAgentStudioTaskTabs({
    activeWorkspaceId: args.activeWorkspaceId,
    loadedAgentStudioState: load.loadedAgentStudioState,
    agentStudioStateLoadKey: load.agentStudioStateLoadKey,
    agentStudioState: load.agentStudioState,
    isWorkspaceRestorePending: navigation.isWorkspaceRestorePending,
    taskId: navigation.taskIdParam,
    routeTaskId: navigation.taskIdParam,
    selectedTask,
    tasks: args.tasks,
    tasksAreCurrent: args.tasksAreCurrent,
    latestSessionByTaskId: new Map(),
    selectAgentStudioSelection: () => {},
  });
  return { load, navigation, tabs };
};

const useWorkspaceRestoreWithSelection = (
  args: LoadHookArgs & { onQueryUpdate: (update: AgentStudioQueryUpdate) => void },
) => {
  const load = useAgentStudioWorkspaceStateLoad(args);
  const navigation = useAgentStudioQuerySync({
    activeWorkspaceId: args.activeWorkspaceId,
    agentStudioState: load.agentStudioState,
    isLoadingAgentStudioState: load.isLoading,
    agentStudioStateError: load.error,
    retryAgentStudioStateLoad: load.retry,
    locationKey: "location-1",
    navigationType: "REPLACE",
    searchParams: emptySearchParams,
    setSearchParams: () => {},
  });
  const selection = useAgentStudioSelectionState({
    activeWorkspaceId: args.activeWorkspaceId,
    isWorkspaceRestorePending: navigation.isWorkspaceRestorePending,
    taskIdParam: navigation.taskIdParam,
    sessionExternalIdParam: navigation.sessionExternalIdParam,
    hasExplicitRoleParam: navigation.hasExplicitRoleParam,
    roleFromQuery: navigation.roleFromQuery,
    scheduleQueryUpdate: args.onQueryUpdate,
    requestContextTransition: (applyTransition) => applyTransition(),
  });
  const selectedTask = args.tasks.find((task) => task.id === selection.selection.taskId) ?? null;
  const tabs = useAgentStudioTaskTabs({
    activeWorkspaceId: args.activeWorkspaceId,
    loadedAgentStudioState: load.loadedAgentStudioState,
    agentStudioStateLoadKey: load.agentStudioStateLoadKey,
    agentStudioState: load.agentStudioState,
    isWorkspaceRestorePending: navigation.isWorkspaceRestorePending,
    taskId: selection.selection.taskId,
    routeTaskId: navigation.taskIdParam,
    selectedTask,
    tasks: args.tasks,
    tasksAreCurrent: args.tasksAreCurrent,
    latestSessionByTaskId: new Map(),
    selectAgentStudioSelection: selection.selectAgentStudioSelection,
  });
  return { load, navigation, selection, tabs };
};

type WorkspaceStateHost = {
  workspaceGetRepoConfig: (workspaceId: string) => Promise<RepoConfig>;
  workspaceApplyAgentStudioStateAction: (
    workspaceId: string,
    action: WorkspaceAgentStudioStateAction,
  ) => Promise<RepoConfig>;
};

type PersistenceHookArgs = Omit<LoadHookArgs, "hostClient"> & {
  hostClient: WorkspaceStateHost;
};

const useWorkspaceStatePersistence = (args: PersistenceHookArgs) => {
  const load = useAgentStudioWorkspaceStateLoad(args);
  const tabChange = useAgentStudioTabStateChange({
    workspaceId: args.activeWorkspaceId,
    hostClient: args.hostClient,
  });
  const tabs = useTaskTabState({
    activeWorkspaceId: args.activeWorkspaceId,
    loadedAgentStudioState: load.loadedAgentStudioState,
    agentStudioStateLoadKey: load.agentStudioStateLoadKey,
    agentStudioState: load.agentStudioState,
    taskId: "task-1",
    selectedTask: args.tasks[0] ?? null,
    tasks: args.tasks,
    tasksAreCurrent: args.tasksAreCurrent,
    onTabChange: tabChange.onTabChange,
  });
  const state: WorkspaceAgentStudioState = tabs.persistedActiveTaskId
    ? {
        openTaskIds: tabs.openTaskIds,
        activeTask: { taskId: tabs.persistedActiveTaskId },
      }
    : { openTaskIds: tabs.openTaskIds };
  useAgentStudioWorkspaceStateSave({
    workspaceId: args.activeWorkspaceId,
    loadedState: load.loadedAgentStudioState,
    state,
    hasPendingTabChange: tabs.hasPendingTabChange,
    enabled: load.canSave,
    hostClient: args.hostClient,
  });
  return { load, tabs, tabChange };
};

describe("useAgentStudioWorkspaceStateLoad", () => {
  test("restores one saved selection without a task-only query write", async () => {
    const savedSession = createAgentSessionSummaryFixture({
      externalSessionId: "session-saved",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
    });
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: {
        taskId: "task-1",
        role: "planner",
        externalSessionId: "session-saved",
      },
    };
    const queryUpdates: AgentStudioQueryUpdate[] = [];
    const harness = createSharedHookHarness(useWorkspaceRestoreWithSelection, {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [savedSession],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig: mock(async () => createRepoConfig(savedState)) },
      onQueryUpdate: (update) => queryUpdates.push(update),
    });

    await harness.mount();
    await harness.waitFor((result) => result.navigation.isWorkspaceStateLoaded);
    await harness.waitFor((result) => result.selection.selection.taskId === "task-1");

    expect(queryUpdates).toEqual([]);
    expect(harness.getLatest().selection.selection).toMatchObject({
      taskId: "task-1",
      sessionExternalId: "session-saved",
      role: "planner",
      hasExplicitRoleSelection: true,
    });
    await harness.unmount();
  });

  test("keeps the load key when the same workspace cache reloads", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    const reloadedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-1" },
    };
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(savedState));
    const hookArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig },
    };
    const queryClient = createQueryClient();
    const queryKey = repoConfigQueryOptions("repo-a").queryKey;
    const harness = createSharedHookHarness(useAgentStudioWorkspaceStateLoad, hookArgs, {
      queryClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.agentStudioStateLoadKey !== null);
    const firstLoadKey = harness.getLatest().agentStudioStateLoadKey;

    await harness.run(() => {
      queryClient.setQueryData(
        queryKey,
        { ...createRepoConfig(reloadedState), workspaceName: "Repo A renamed" },
        { updatedAt: Date.now() + 1_000 },
      );
    });
    await harness.waitFor((result) => result.loadedAgentStudioState?.openTaskIds.length === 2);

    const result = harness.getLatest();
    await harness.unmount();

    expect(result.agentStudioStateLoadKey).toBe(firstLoadKey);
    expect(result.loadedAgentStudioState).toEqual(reloadedState);
  });

  test("does not overwrite a local tab change after a stale cache reload", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    const nextState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-1" },
    };
    const firstSave = createDeferred<RepoConfig>();
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(savedState));
    const workspaceApplyAgentStudioStateAction = mock(
      async (_workspaceId: string, action: WorkspaceAgentStudioStateAction) => {
        if (action.type !== "change_tabs") {
          throw new Error(`Unexpected action: ${action.type}`);
        }
        return firstSave.promise;
      },
    );
    const queryClient = createQueryClient();
    const queryKey = repoConfigQueryOptions("repo-a").queryKey;
    const hookArgs: PersistenceHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig, workspaceApplyAgentStudioStateAction },
    };
    const harness = createSharedHookHarness(useWorkspaceStatePersistence, hookArgs, {
      queryClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.load.agentStudioStateLoadKey !== null);
    const loadKey = harness.getLatest().load.agentStudioStateLoadKey;
    await harness.run((result) =>
      result.tabs.setTabState({
        openTaskIds: nextState.openTaskIds,
        activeTaskId: nextState.activeTask?.taskId ?? null,
      }),
    );
    await harness.waitFor(() => workspaceApplyAgentStudioStateAction.mock.calls.length === 1);

    await harness.run(() => {
      queryClient.setQueryData(
        queryKey,
        { ...createRepoConfig(savedState), workspaceName: "Repo A renamed" },
        { updatedAt: Date.now() + 1_000 },
      );
    });
    expect(harness.getLatest().load.agentStudioStateLoadKey).toBe(loadKey);
    expect(harness.getLatest().tabs.openTaskIds).toEqual(nextState.openTaskIds);

    await harness.run(async () => {
      firstSave.resolve(createRepoConfig(nextState));
      await firstSave.promise;
    });
    await harness.waitFor(
      () =>
        queryClient.getQueryData<RepoConfig>(queryKey)?.agentStudioState.openTaskIds.length === 2,
    );

    expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  test("saves a background-start tab alongside a pending local tab change", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    const localState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-1" },
    };
    const firstSave = createDeferred<void>();
    const workspaceApplyAgentStudioStateAction = mock(
      async (_workspaceId: string, action: WorkspaceAgentStudioStateAction) => {
        if (action.type === "change_tabs") {
          await firstSave.promise;
          return createRepoConfig(localState);
        }
        if (action.type === "ensure_tab") {
          return createRepoConfig({ ...localState, openTaskIds: ["task-1", "task-2", "task-3"] });
        }
        throw new Error(`Unexpected action: ${action.type}`);
      },
    );
    const hostClient = {
      workspaceGetRepoConfig: async () => createRepoConfig(savedState),
      workspaceApplyAgentStudioStateAction,
    };
    const queryClient = createQueryClient();
    const queryKey = repoConfigQueryOptions("repo-a").queryKey;
    const allTasks = [...tasks, createTaskCardFixture({ id: "task-3" })];
    const harness = createSharedHookHarness(
      useWorkspaceStatePersistence,
      {
        activeWorkspaceId: "repo-a",
        tasks: allTasks,
        isLoadingTasks: false,
        tasksAreCurrent: true,
        sessions: [],
        sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
        hostClient,
      },
      { queryClient },
    );

    await harness.mount();
    await harness.waitFor((result) => result.load.agentStudioStateLoadKey !== null);
    await harness.run((result) =>
      result.tabs.setTabState({ openTaskIds: localState.openTaskIds, activeTaskId: "task-1" }),
    );
    await harness.waitFor(() => workspaceApplyAgentStudioStateAction.mock.calls.length === 1);

    const started = addTaskToWorkspaceAgentStudioState({
      queryClient,
      workspaceId: "repo-a",
      taskId: "task-3",
      tasks: allTasks,
      hostClient,
    });
    expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().tabs.openTaskIds).toEqual(["task-1", "task-2"]);

    await harness.run(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });
    await started;
    expect(workspaceApplyAgentStudioStateAction.mock.calls.map((call) => call[1].type)).toEqual([
      "change_tabs",
      "ensure_tab",
    ]);
    await harness.waitFor(
      () =>
        queryClient.getQueryData<RepoConfig>(queryKey)?.agentStudioState.openTaskIds.length === 3,
    );
    await harness.unmount();
  });

  test("reopens a task started while its tab close is still saving", async () => {
    let savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-1" },
    };
    const closeSave = createDeferred<void>();
    const hostClient = {
      workspaceGetRepoConfig: async () => createRepoConfig(savedState),
      workspaceApplyAgentStudioStateAction: mock(
        async (_workspaceId: string, action: WorkspaceAgentStudioStateAction) => {
          if (action.type === "change_tabs") {
            await closeSave.promise;
            savedState = { openTaskIds: ["task-1"], activeTask: { taskId: "task-1" } };
          } else if (action.type === "ensure_tab") {
            savedState = { ...savedState, openTaskIds: [...savedState.openTaskIds, action.taskId] };
          }
          return createRepoConfig(savedState);
        },
      ),
    };
    const queryClient = createQueryClient();
    const harness = createSharedHookHarness(
      useWorkspaceStatePersistence,
      {
        activeWorkspaceId: "repo-a",
        tasks,
        isLoadingTasks: false,
        tasksAreCurrent: true,
        sessions: [],
        sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
        hostClient,
      },
      { queryClient },
    );

    await harness.mount();
    await harness.waitFor((result) => result.load.agentStudioStateLoadKey !== null);
    await harness.run((result) =>
      result.tabs.setTabState({ openTaskIds: ["task-1"], activeTaskId: "task-1" }),
    );
    await harness.waitFor(
      () => hostClient.workspaceApplyAgentStudioStateAction.mock.calls.length === 1,
    );

    const started = addTaskToWorkspaceAgentStudioState({
      queryClient,
      workspaceId: "repo-a",
      taskId: "task-2",
      tasks,
      hostClient,
    });
    await harness.run(async () => {
      closeSave.resolve();
      await closeSave.promise;
    });
    await started;

    await harness.waitFor(() => savedState.openTaskIds.includes("task-2"));
    expect(
      hostClient.workspaceApplyAgentStudioStateAction.mock.calls.map((call) => call[1].type),
    ).toEqual(["change_tabs", "ensure_tab"]);
    expect(harness.getLatest().tabs.openTaskIds).toContain("task-2");
    await harness.unmount();
  });

  test("shows a failed tab change and saves it after retry", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-1" },
    };
    const closedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    let attempts = 0;
    const hostClient = {
      workspaceGetRepoConfig: async () => createRepoConfig(savedState),
      workspaceApplyAgentStudioStateAction: mock(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Could not save tabs");
        }
        return createRepoConfig(closedState);
      }),
    };
    const queryClient = createQueryClient();
    const harness = createSharedHookHarness(
      useWorkspaceStatePersistence,
      {
        activeWorkspaceId: "repo-a",
        tasks,
        isLoadingTasks: false,
        tasksAreCurrent: true,
        sessions: [],
        sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
        hostClient,
      },
      { queryClient },
    );

    await harness.mount();
    await harness.waitFor((result) => result.load.agentStudioStateLoadKey !== null);
    await harness.run((result) =>
      result.tabs.setTabState({ openTaskIds: ["task-1"], activeTaskId: "task-1" }),
    );
    await harness.waitFor(
      (result) => result.tabChange.saveError?.message === "Could not save tabs",
    );
    expect(harness.getLatest().tabs.openTaskIds).toEqual(["task-1"]);
    expect(harness.getLatest().tabs.hasPendingTabChange).toBe(true);

    await harness.run((result) => result.tabChange.retry());
    await harness.waitFor((result) => result.tabChange.saveError === null);
    await harness.waitFor((result) => result.load.loadedAgentStudioState?.openTaskIds.length === 1);
    expect(hostClient.workspaceApplyAgentStudioStateAction).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test("restores a cached workspace snapshot without a route refetch", async () => {
    const cachedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "spec", externalSessionId: "session-old" },
    };
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(cachedState));
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      repoConfigQueryOptions("repo-a").queryKey,
      createRepoConfig(cachedState),
    );
    const hookArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo-a",
        "Session list unavailable",
        "live-stream",
      ),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useWorkspaceRestore, hookArgs, { queryClient });

    await harness.mount();
    await harness.waitFor((result) => result.navigation.isWorkspaceStateLoaded);

    expect(workspaceGetRepoConfig).not.toHaveBeenCalled();
    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-1"]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("task-1");
    expect(harness.getLatest().navigation.taskIdParam).toBe("task-1");
    expect(harness.getLatest().navigation.roleFromQuery).toBe("spec");
    expect(harness.getLatest().navigation.sessionExternalIdParam).toBe("session-old");
    await harness.unmount();
  });

  test("keeps a cached workspace snapshot visible during a background refetch", () => {
    const cachedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "spec" },
    };

    const load = buildAgentStudioStateLoad({
      activeWorkspaceId: "repo-a",
      repoConfig: createRepoConfig(cachedState),
      queryError: null,
      isQueryPending: false,
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
    });

    expect(load.isLoading).toBe(false);
    expect(load.loadedAgentStudioState).toEqual(cachedState);
    expect(load.agentStudioState?.openTaskIds).toEqual(["task-1"]);
  });

  test("hides prior workspace tabs until the next workspace snapshot loads", async () => {
    const repoAState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "build" },
    };
    const repoBState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-2", "task-1"],
      activeTask: { taskId: "task-2", role: "qa" },
    };
    const repoBRead = createDeferred<RepoConfig>();
    const workspaceGetRepoConfig = mock(async (workspaceId: string) => {
      if (workspaceId === "repo-a") {
        return createRepoConfig(repoAState);
      }
      return repoBRead.promise;
    });
    const queryClient = createQueryClient();
    const repoAArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo-a",
        "Session list unavailable",
        "live-stream",
      ),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useWorkspaceRestore, repoAArgs, { queryClient });

    await harness.mount();
    await harness.waitFor((result) => result.tabs.loadedStateWorkspaceId === "repo-a");
    const repoALoadKey = harness.getLatest().load.agentStudioStateLoadKey;
    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-1"]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("task-1");

    await harness.update({
      ...repoAArgs,
      activeWorkspaceId: "repo-b",
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo-b",
        "Session list unavailable",
        "live-stream",
      ),
    });
    expect(workspaceGetRepoConfig).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().load.agentStudioState).toBeNull();
    expect(harness.getLatest().tabs.tabTaskIds).toEqual([]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("");

    await harness.run(async () => {
      repoBRead.resolve({
        ...createRepoConfig(repoBState),
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
      });
      await repoBRead.promise;
    });
    await harness.waitFor((result) => result.tabs.loadedStateWorkspaceId === "repo-b");

    expect(harness.getLatest().load.agentStudioStateLoadKey).not.toBe(repoALoadKey);
    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-2", "task-1"]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("task-2");
    await harness.unmount();
  });

  test("drops the selected session while the next workspace snapshot loads", async () => {
    const repoAState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "build" },
    };
    const repoBRead = createDeferred<RepoConfig>();
    const workspaceGetRepoConfig = mock(async (workspaceId: string) => {
      if (workspaceId === "repo-a") {
        return createRepoConfig(repoAState);
      }
      return repoBRead.promise;
    });
    const selectedSession = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo-a/worktrees/session-1",
      taskId: "task-1",
      role: "build" as const,
    };
    const queryClient = createQueryClient();
    const repoAArgs: LoadHookArgs & { onQueryUpdate: (update: AgentStudioQueryUpdate) => void } = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig },
      onQueryUpdate: () => {},
    };
    const harness = createSharedHookHarness(useWorkspaceRestoreWithSelection, repoAArgs, {
      queryClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.tabs.loadedStateWorkspaceId === "repo-a");
    await harness.run((result) => {
      result.selection.selectAgentStudioSelection(toAgentStudioSessionSelection(selectedSession));
    });
    expect(harness.getLatest().selection.selection.sessionIdentity).not.toBeNull();

    await harness.update({
      ...repoAArgs,
      activeWorkspaceId: "repo-b",
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-b"),
    });

    expect(harness.getLatest().navigation.isWorkspaceRestorePending).toBe(true);
    expect(harness.getLatest().selection.selection.sessionIdentity).toBeNull();

    await harness.unmount();
  });

  test("keeps the saved session through read failure and enables save after recovery", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "build", externalSessionId: "session-saved" },
    };
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(savedState));
    const failedArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo-a",
        "Session list unavailable",
        "live-stream",
      ),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useAgentStudioWorkspaceStateLoad, failedArgs);

    await harness.mount();
    await harness.waitFor((result) => !result.isLoading);
    expect(harness.getLatest().agentStudioState?.activeTask?.externalSessionId).toBe(
      "session-saved",
    );
    expect(harness.getLatest().canSave).toBe(false);

    await harness.update({
      ...failedArgs,
      sessionReadModelLoadState: loadingAgentSessionReadModelLoadState("/repo-a"),
    });
    expect(harness.getLatest().agentStudioState?.activeTask?.externalSessionId).toBe(
      "session-saved",
    );
    expect(harness.getLatest().isLoading).toBe(false);
    expect(harness.getLatest().canSave).toBe(false);

    const savedSession = createAgentSessionSummaryFixture({
      externalSessionId: "session-saved",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    await harness.update({
      ...failedArgs,
      sessions: [savedSession],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
    });
    expect(harness.getLatest().agentStudioState?.activeTask).toEqual({
      taskId: "task-1",
      role: "build",
      externalSessionId: "session-saved",
    });
    expect(harness.getLatest().canSave).toBe(true);
    await harness.unmount();
  });

  test("keeps saved task ids until the task snapshot is current", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-2", role: "build" },
    };
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(savedState));
    const staleArgs: LoadHookArgs & { tasksAreCurrent: boolean } = {
      activeWorkspaceId: "repo-a",
      tasks: tasks.slice(0, 1),
      isLoadingTasks: false,
      tasksAreCurrent: false,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useWorkspaceRestore, staleArgs);

    await harness.mount();
    await harness.waitFor((result) => result.load.loadedAgentStudioState !== null);

    expect(harness.getLatest().load.agentStudioState).toEqual(savedState);
    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-1", "task-2"]);
    expect(harness.getLatest().load.canSave).toBe(false);

    await harness.update({ ...staleArgs, tasksAreCurrent: true });
    expect(harness.getLatest().load.agentStudioState).toEqual({ openTaskIds: ["task-1"] });
    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-1"]);
    expect(harness.getLatest().load.canSave).toBe(true);
    await harness.unmount();
  });
});
