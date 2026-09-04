import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig, WorkspaceAgentStudioState } from "@openducktor/contracts";
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
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";
import { useAgentStudioWorkspaceStateLoad } from "./use-agent-studio-workspace-state-load";

enableReactActEnvironment();

type LoadHookArgs = Parameters<typeof useAgentStudioWorkspaceStateLoad>[0];

const createRepoConfig = (agentStudioState: WorkspaceAgentStudioState): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
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
    selectedTask,
    tasks: args.tasks,
    tasksAreCurrent: args.tasksAreCurrent,
    latestSessionByTaskId: new Map(),
    selectAgentStudioSelection: () => {},
  });
  return { load, navigation, tabs };
};

describe("useAgentStudioWorkspaceStateLoad", () => {
  test("changes the load key when the host reloads the same state", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    const repoConfig = createRepoConfig(savedState);
    const workspaceGetRepoConfig = mock(async () => repoConfig);
    const hookArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks,
      isLoadingTasks: false,
      tasksAreCurrent: true,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useAgentStudioWorkspaceStateLoad, hookArgs);

    await harness.mount();
    await harness.waitFor((result) => result.agentStudioStateLoadKey !== null);
    const firstLoadKey = harness.getLatest().agentStudioStateLoadKey;

    await harness.run((result) => result.retry());
    await harness.waitFor(() => workspaceGetRepoConfig.mock.calls.length === 2);
    await harness.waitFor((result) => result.agentStudioStateLoadKey !== firstLoadKey);

    expect(harness.getLatest().loadedAgentStudioState).toBe(savedState);
    await harness.unmount();
  });

  test("waits for a fresh host read before restoring a cached workspace snapshot", async () => {
    const cachedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "spec", externalSessionId: "session-old" },
    };
    const freshState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-2", "task-1"],
      activeTask: { taskId: "task-2", role: "qa", externalSessionId: "session-new" },
    };
    const freshRead = createDeferred<RepoConfig>();
    const workspaceGetRepoConfig = mock(async () => freshRead.promise);
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
    expect(workspaceGetRepoConfig).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().load.agentStudioState).toBeNull();

    await harness.run(async () => {
      freshRead.resolve(createRepoConfig(freshState));
      await freshRead.promise;
    });
    await harness.waitFor((result) => result.navigation.isWorkspaceStateLoaded);

    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-2", "task-1"]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("task-2");
    expect(harness.getLatest().navigation.taskIdParam).toBe("task-2");
    expect(harness.getLatest().navigation.roleFromQuery).toBe("qa");
    expect(harness.getLatest().navigation.sessionExternalIdParam).toBe("session-new");
    await harness.unmount();
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

    expect(harness.getLatest().tabs.tabTaskIds).toEqual(["task-2", "task-1"]);
    expect(harness.getLatest().tabs.activeTaskTabId).toBe("task-2");
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
    expect(harness.getLatest().agentStudioState).toBeNull();
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
