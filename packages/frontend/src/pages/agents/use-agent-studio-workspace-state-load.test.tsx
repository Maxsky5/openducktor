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
import type { AgentStudioQueryUpdate } from "./query-sync/agent-studio-navigation";
import { toAgentStudioSessionSelection } from "./shell/agent-studio-selection-state";
import { useAgentStudioSelectionState } from "./shell/use-agent-studio-selection-state";
import { buildAgentStudioStateLoad } from "./agent-studio-workspace-state-load-model";
import { useAgentStudioWorkspaceStateLoad } from "./use-agent-studio-workspace-state-load";

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
  return { load, navigation };
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
  return { load, navigation, selection };
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

  test("hides the prior workspace selection until the next workspace snapshot loads", async () => {
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
    await harness.waitFor((result) => result.load.agentStudioState !== null);

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

    await harness.run(async () => {
      repoBRead.resolve({
        ...createRepoConfig(repoBState),
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
      });
      await repoBRead.promise;
    });
    await harness.waitFor(
      (result) => result.load.agentStudioState?.activeTask?.taskId === "task-2",
    );

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
    await harness.waitFor((result) => result.load.agentStudioState !== null);
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

  test("keeps the saved selection until the task snapshot is current", async () => {
    const savedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-2", role: "build" },
    };
    const workspaceGetRepoConfig = mock(async () => createRepoConfig(savedState));
    const staleArgs: LoadHookArgs = {
      activeWorkspaceId: "repo-a",
      tasks: tasks.slice(0, 1),
      isLoadingTasks: false,
      tasksAreCurrent: false,
      sessions: [],
      sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo-a"),
      hostClient: { workspaceGetRepoConfig },
    };
    const harness = createSharedHookHarness(useAgentStudioWorkspaceStateLoad, staleArgs);
    await harness.mount();
    await harness.waitFor((result) => result.loadedAgentStudioState !== null);

    expect(harness.getLatest().agentStudioState).toEqual(savedState);
    expect(harness.getLatest().canSave).toBe(false);

    await harness.update({ ...staleArgs, tasksAreCurrent: true });
    expect(harness.getLatest().agentStudioState).toEqual({ openTaskIds: ["task-1"] });
    expect(harness.getLatest().loadedAgentStudioState).toEqual(savedState);
    expect(harness.getLatest().canSave).toBe(true);
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
});
