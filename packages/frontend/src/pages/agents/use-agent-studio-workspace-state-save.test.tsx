import { describe, expect, mock, test } from "bun:test";
import type {
  RepoConfig,
  WorkspaceAgentStudioState,
  WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createQueryClient } from "@/lib/query-client";
import { useSessionNavigationRecovery } from "@/features/session-navigation/use-session-navigation-recovery";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import {
  createHookHarness as createSharedHookHarness,
  createDeferred,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioWorkspaceStateSave } from "./use-agent-studio-workspace-state-save";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioWorkspaceStateSave>[0];

const createRepoConfig = (agentStudioState: WorkspaceAgentStudioState): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState,
});

const asApplyHost = (
  replace: (workspaceId: string, state: WorkspaceAgentStudioState) => Promise<RepoConfig>,
) => ({
  workspaceApplyAgentStudioStateAction: (
    workspaceId: string,
    action: WorkspaceAgentStudioStateAction,
  ): Promise<RepoConfig> => {
    if (action.type !== "sync_snapshot") {
      throw new Error(`Unexpected action: ${action.type}`);
    }
    const state: WorkspaceAgentStudioState = { openTaskIds: action.openTaskIds };
    if (action.activeTask) {
      state.activeTask = action.activeTask;
    }
    return replace(workspaceId, state);
  },
});

const wrapper = ({ children }: PropsWithChildren): ReactElement =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioWorkspaceStateSave, initialProps, { wrapper });

const useTaskNavigationPersistence = (props: HookArgs) => {
  const persistence = useAgentStudioWorkspaceStateSave(props);
  return useSessionNavigationRecovery({
    scopeKey: props.workspaceId ?? "",
    readError: null,
    writeError: persistence.saveError,
    retryRead: () => {},
    retryWrite: persistence.retrySave,
  });
};

describe("useAgentStudioWorkspaceStateSave", () => {
  test("does not rewrite the loaded snapshot", async () => {
    const state = { openTaskIds: ["task-1"] };
    const workspaceReplaceAgentStudioState = mock(async () => createRepoConfig(state));
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState: state,
      state,
      enabled: true,
      hostClient: asApplyHost(workspaceReplaceAgentStudioState),
    });

    await harness.mount();
    await Promise.resolve();
    expect(workspaceReplaceAgentStudioState).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("replaces the full snapshot when local state changes", async () => {
    const loadedState = { openTaskIds: ["task-1"] };
    const nextState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1", "task-2"],
      activeTask: { taskId: "task-2", role: "planner", externalSessionId: "session-2" },
    };
    const workspaceReplaceAgentStudioState = mock(
      async (_workspaceId: string, state: WorkspaceAgentStudioState) => createRepoConfig(state),
    );
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState,
      state: loadedState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.update({
      workspaceId: "repo-a",
      loadedState,
      state: nextState,
      enabled: true,
      hostClient,
    });
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 1);

    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledWith("repo-a", nextState);
    await harness.unmount();
  });

  test("saves a change back to the loaded snapshot after an older save", async () => {
    const loadedState = { openTaskIds: ["task-1"] };
    const pendingState = { openTaskIds: ["task-1", "task-2"] };
    const pendingSave = createDeferred<RepoConfig>();
    const workspaceReplaceAgentStudioState = mock(
      async (_workspaceId: string, state: WorkspaceAgentStudioState) => {
        if (state.openTaskIds.at(-1) === "task-2") {
          return pendingSave.promise;
        }
        return createRepoConfig(state);
      },
    );
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState,
      state: pendingState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 1);
    await harness.update({
      workspaceId: "repo-a",
      loadedState,
      state: loadedState,
      enabled: true,
      hostClient,
    });
    await harness.run(async () => {
      pendingSave.resolve(createRepoConfig(pendingState));
      await pendingSave.promise;
    });
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 2);

    expect(workspaceReplaceAgentStudioState.mock.calls[1]).toEqual(["repo-a", loadedState]);
    await harness.unmount();
  });

  test("publishes an ordered save while a newer snapshot waits", async () => {
    const loadedState = { openTaskIds: ["task-1"] };
    const pendingState = { openTaskIds: ["task-1", "task-2"] };
    const nextState = { openTaskIds: ["task-1", "task-3"] };
    const pendingSave = createDeferred<RepoConfig>();
    const nextSave = createDeferred<RepoConfig>();
    const workspaceReplaceAgentStudioState = mock(
      async (_workspaceId: string, state: WorkspaceAgentStudioState) =>
        state.openTaskIds.at(-1) === "task-2" ? pendingSave.promise : nextSave.promise,
    );
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const queryClient = createQueryClient();
    const queryKey = workspaceQueryKeys.repoConfig("repo-a");
    queryClient.setQueryData(queryKey, createRepoConfig(loadedState));
    const harness = createSharedHookHarness(
      useAgentStudioWorkspaceStateSave,
      {
        workspaceId: "repo-a",
        loadedState,
        state: pendingState,
        enabled: true,
        hostClient,
      },
      { queryClient },
    );

    await harness.mount();
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 1);
    await harness.update({
      workspaceId: "repo-a",
      loadedState,
      state: nextState,
      enabled: true,
      hostClient,
    });
    await harness.run(async () => {
      pendingSave.resolve(createRepoConfig(pendingState));
      await pendingSave.promise;
    });
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 2);

    expect(queryClient.getQueryData<RepoConfig>(queryKey)?.agentStudioState).toEqual(pendingState);

    await harness.run(async () => {
      nextSave.resolve(createRepoConfig(nextState));
      await nextSave.promise;
    });
    await harness.waitFor(
      () =>
        queryClient.getQueryData<RepoConfig>(queryKey)?.agentStudioState.openTaskIds.at(-1) ===
        "task-3",
    );
    await harness.unmount();
  });

  test("surfaces a write error and retries only on request", async () => {
    const loadedState = { openTaskIds: ["task-1"] };
    const nextState = { openTaskIds: ["task-1", "task-2"] };
    let shouldFail = true;
    const workspaceReplaceAgentStudioState = mock(async () => {
      if (shouldFail) {
        throw new Error("write failed");
      }
      return createRepoConfig(nextState);
    });
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState,
      state: nextState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.saveError?.message === "write failed");
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(1);

    shouldFail = false;
    await harness.run((result) => result.retrySave());
    await harness.waitFor((result) => result.saveError === null);
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test("hides an obsolete write error when the desired snapshot changes", async () => {
    const loadedState = { openTaskIds: ["task-1"] };
    const failedState = { openTaskIds: ["task-1", "task-2"] };
    const nextState = { openTaskIds: ["task-1", "task-3"] };
    const nextSave = createDeferred<RepoConfig>();
    let requestCount = 0;
    const workspaceReplaceAgentStudioState = mock(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        throw new Error("obsolete write failed");
      }
      return nextSave.promise;
    });
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState,
      state: failedState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.saveError?.message === "obsolete write failed");
    await harness.update({
      workspaceId: "repo-a",
      loadedState,
      state: nextState,
      enabled: true,
      hostClient,
    });

    expect(harness.getLatest().saveError).toBeNull();
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 2);
    await harness.run(async () => {
      nextSave.resolve(createRepoConfig(nextState));
      await nextSave.promise;
    });
    await harness.unmount();
  });

  test("ignores a save result from the prior workspace", async () => {
    const workspaceASave = createDeferred<RepoConfig>();
    const workspaceAState = { openTaskIds: ["task-a"] };
    const workspaceANextState = { openTaskIds: ["task-a", "task-a-2"] };
    const workspaceBState = { openTaskIds: ["task-b"] };
    const workspaceReplaceAgentStudioState = mock(
      async (workspaceId: string, state: WorkspaceAgentStudioState) => {
        if (workspaceId === "repo-a") {
          return workspaceASave.promise;
        }
        return createRepoConfig(state);
      },
    );
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState: workspaceAState,
      state: workspaceANextState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 1);
    await harness.update({
      workspaceId: "repo-b",
      loadedState: workspaceBState,
      state: workspaceBState,
      enabled: true,
      hostClient,
    });
    await harness.run(async () => {
      workspaceASave.resolve(createRepoConfig(workspaceANextState));
      await workspaceASave.promise;
    });
    await harness.update({
      workspaceId: "repo-b",
      loadedState: workspaceBState,
      state: workspaceBState,
      enabled: true,
      hostClient,
    });

    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().saveError).toBeNull();
    await harness.unmount();
  });

  test("keeps a prior workspace failure available after visiting an unchanged workspace", async () => {
    const workspaceASave = createDeferred<RepoConfig>();
    const workspaceAState = { openTaskIds: ["task-a"] };
    const workspaceANextState = { openTaskIds: ["task-a", "task-a-2"] };
    const workspaceBState = { openTaskIds: ["task-b"] };
    let writeCount = 0;
    const workspaceReplaceAgentStudioState = mock(async () => {
      writeCount += 1;
      return writeCount === 1 ? workspaceASave.promise : createRepoConfig(workspaceANextState);
    });
    const hostClient = asApplyHost(workspaceReplaceAgentStudioState);
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState: workspaceAState,
      state: workspaceANextState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor(() => workspaceReplaceAgentStudioState.mock.calls.length === 1);
    await harness.update({
      workspaceId: "repo-b",
      loadedState: workspaceBState,
      state: workspaceBState,
      enabled: true,
      hostClient,
    });
    await harness.run(async () => {
      workspaceASave.reject(new Error("workspace A failed"));
      await Promise.resolve();
    });

    expect(harness.getLatest().saveError).toBeNull();
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(1);
    await harness.update({
      workspaceId: "repo-a",
      loadedState: workspaceAState,
      state: workspaceANextState,
      enabled: true,
      hostClient,
    });

    expect(harness.getLatest().saveError?.message).toBe("workspace A failed");
    await harness.run((result) => result.retrySave());
    await harness.waitFor((result) => result.saveError === null);
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test.each(["before switching", "after returning"] as const)(
    "ignores an older save failure that arrives %s when the same snapshot is saved again",
    async (failureTime) => {
      const firstASave = createDeferred<RepoConfig>();
      const nextASave = createDeferred<RepoConfig>();
      const workspaceAState = { openTaskIds: ["task-a"] };
      const workspaceANextState = { openTaskIds: ["task-a", "task-a-2"] };
      const workspaceBState = { openTaskIds: ["task-b"] };
      const workspaceBNextState = { openTaskIds: ["task-b", "task-b-2"] };
      let writesA = 0;
      let writesB = 0;
      const write = mock(async (workspaceId: string, state: WorkspaceAgentStudioState) => {
        if (workspaceId === "repo-a") {
          writesA += 1;
          return writesA === 1 ? firstASave.promise : nextASave.promise;
        }
        writesB += 1;
        return { ...createRepoConfig(state), workspaceId: "repo-b" };
      });
      const hostClient = asApplyHost(write);
      const harness = createHookHarness({
        workspaceId: "repo-a",
        loadedState: workspaceAState,
        state: workspaceANextState,
        enabled: true,
        hostClient,
      });
      const failFirstSave = () =>
        harness.run(async () => {
          firstASave.reject(new Error("older A write failed"));
          await firstASave.promise.catch(() => {});
        });

      try {
        await harness.mount();
        await harness.waitFor(() => writesA === 1);
        if (failureTime === "before switching") {
          await failFirstSave();
          await harness.waitFor((result) => result.saveError?.message === "older A write failed");
        }
        await harness.update({
          workspaceId: "repo-b",
          loadedState: workspaceBState,
          state: workspaceBNextState,
          enabled: true,
          hostClient,
        });
        await harness.waitFor(() => writesB === 1);
        await harness.update({
          workspaceId: "repo-a",
          loadedState: workspaceAState,
          state: workspaceANextState,
          enabled: true,
          hostClient,
        });
        if (failureTime === "after returning") {
          await failFirstSave();
        }
        await harness.waitFor(() => writesA === 2);
        expect(harness.getLatest().saveError).toBeNull();

        await harness.run(async () => {
          nextASave.resolve(createRepoConfig(workspaceANextState));
          await nextASave.promise;
        });
        expect(harness.getLatest().saveError).toBeNull();
        expect(writesA).toBe(2);
      } finally {
        firstASave.resolve(createRepoConfig(workspaceANextState));
        nextASave.resolve(createRepoConfig(workspaceANextState));
        await harness.unmount();
      }
    },
  );

  test.each(["initial write", "explicit retry"] as const)(
    "retains the active workspace failure after a prior workspace %s rejects",
    async (priorWrite) => {
      const pendingASave = createDeferred<RepoConfig>();
      const workspaceAState = { openTaskIds: ["task-a"] };
      const workspaceANextState = { openTaskIds: ["task-a", "task-a-2"] };
      const workspaceBState = { openTaskIds: ["task-b"] };
      const workspaceBNextState: WorkspaceAgentStudioState = {
        openTaskIds: ["task-b", "task-b-2"],
        activeTask: { taskId: "task-b-2", role: "planner", externalSessionId: "session-b-2" },
      };
      let writesA = 0;
      let writesB = 0;
      const write = mock(async (workspaceId: string, state: WorkspaceAgentStudioState) => {
        if (workspaceId === "repo-a") {
          writesA += 1;
          if (priorWrite === "explicit retry" && writesA === 1) {
            throw new Error("A write denied");
          }
          return pendingASave.promise;
        }
        writesB += 1;
        if (writesB === 1) {
          throw new Error("B write denied");
        }
        return { ...createRepoConfig(state), workspaceId: "repo-b" };
      });
      const hostClient = asApplyHost(write);
      const queryClient = createQueryClient();
      const harness = createSharedHookHarness(
        useTaskNavigationPersistence,
        {
          workspaceId: "repo-a",
          loadedState: workspaceAState,
          state: workspaceANextState,
          enabled: true,
          hostClient,
        },
        { queryClient },
      );

      try {
        await harness.mount();
        await harness.waitFor(() => writesA === 1);
        if (priorWrite === "explicit retry") {
          await harness.waitFor(
            (result) => result.navigationPersistenceError?.message === "A write denied",
          );
          await harness.run((result) => result.retryNavigationPersistence());
          await harness.waitFor(() => writesA === 2);
          expect(harness.getLatest().isRetryingNavigationPersistence).toBe(true);
        }

        await harness.update({
          workspaceId: "repo-b",
          loadedState: workspaceBState,
          state: workspaceBNextState,
          enabled: true,
          hostClient,
        });
        await harness.waitFor(
          (result) => result.navigationPersistenceError?.message === "B write denied",
        );
        await harness.run(async () => {
          pendingASave.reject(new Error("A late write denied"));
          await pendingASave.promise.catch(() => {});
        });

        expect(harness.getLatest().navigationPersistenceError?.message).toBe("B write denied");
        expect(harness.getLatest().isRetryingNavigationPersistence).toBe(false);
        await harness.run((result) => result.retryNavigationPersistence());
        await harness.waitFor(
          (result) =>
            result.navigationPersistenceError === null && !result.isRetryingNavigationPersistence,
        );
        expect(write.mock.calls.slice(-2)).toEqual([
          ["repo-b", workspaceBNextState],
          ["repo-b", workspaceBNextState],
        ]);
        expect(
          queryClient.getQueryData<RepoConfig>(workspaceQueryKeys.repoConfig("repo-b"))
            ?.agentStudioState,
        ).toEqual(workspaceBNextState);
      } finally {
        await harness.unmount();
      }
    },
  );
});
