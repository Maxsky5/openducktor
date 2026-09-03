import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  createHookHarness as createSharedHookHarness,
  createDeferred,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioWorkspaceStatePersistence } from "./use-agent-studio-workspace-state-persistence";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioWorkspaceStatePersistence>[0];

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

const wrapper = ({ children }: PropsWithChildren): ReactElement =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioWorkspaceStatePersistence, initialProps, { wrapper });

describe("useAgentStudioWorkspaceStatePersistence", () => {
  test("does not rewrite the loaded snapshot", async () => {
    const state = { openTaskIds: ["task-1"] };
    const workspaceReplaceAgentStudioState = mock(async () => createRepoConfig(state));
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState: state,
      state,
      enabled: true,
      hostClient: { workspaceReplaceAgentStudioState },
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
    const hostClient = { workspaceReplaceAgentStudioState };
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
    const hostClient = { workspaceReplaceAgentStudioState };
    const harness = createHookHarness({
      workspaceId: "repo-a",
      loadedState,
      state: nextState,
      enabled: true,
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((result) => result.persistenceError?.message === "write failed");
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(1);

    shouldFail = false;
    await harness.run((result) => result.retryPersistence());
    await harness.waitFor((result) => result.persistenceError === null);
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(2);
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
    const hostClient = { workspaceReplaceAgentStudioState };
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
    expect(harness.getLatest().persistenceError).toBeNull();
    await harness.unmount();
  });

  test("ignores a save error from the prior workspace", async () => {
    const workspaceASave = createDeferred<RepoConfig>();
    const workspaceAState = { openTaskIds: ["task-a"] };
    const workspaceANextState = { openTaskIds: ["task-a", "task-a-2"] };
    const workspaceBState = { openTaskIds: ["task-b"] };
    const workspaceReplaceAgentStudioState = mock(async () => workspaceASave.promise);
    const hostClient = { workspaceReplaceAgentStudioState };
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

    expect(harness.getLatest().persistenceError).toBeNull();
    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });
});
