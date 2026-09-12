import { expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import { useAppLifecycle } from "./use-app-lifecycle";

const runtime: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-09-12T10:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

const lifecycleArgs: Parameters<typeof useAppLifecycle>[0] = {
  activeWorkspace: { workspaceId: "workspace", workspaceName: "Repository", repoPath: "/repo" },
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  refreshBranches: async () => {},
  refreshRepoRuntimeHealth: async () => ({}),
  refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
  loadWorkspaceTasks: async () => {},
  startRepoRuntime: async () => runtime,
  clearBranchData: () => {},
  taskStreamControllerFactory: ({ onSnapshotStarted, getActiveRepoPath }) => ({
    start: async () => onSnapshotStarted(getActiveRepoPath()),
    stop: async () => {},
  }),
};

test("refreshes runtime queries while the initial task snapshot is still loading", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const modelsKey = ["runtime-catalog", "/repo", "opencode"];
  const historyKey = ["agent-session-history", "/repo", "opencode", "/repo/worktree", "session"];
  const todosKey = ["agent-session-todos", "/repo", "opencode", "/repo/worktree", "session"];
  const unrelatedKey = ["runtime-catalog", "/repo", "codex"];
  for (const key of [modelsKey, historyKey, unrelatedKey]) client.setQueryData(key, ["cached"]);
  await client
    .fetchQuery({
      queryKey: todosKey,
      queryFn: async () => {
        throw new Error("runtime was stopped");
      },
    })
    .catch(() => {});
  const readModels = mock(async () => ["ready"]);
  const observer = new QueryObserver(client, { queryKey: modelsKey, queryFn: readModels });
  const unsubscribe = observer.subscribe(() => {});
  const startup = Promise.withResolvers<RuntimeInstanceSummary>();
  const loadWorkspaceTasks = mock(async () => {});
  const args = { ...lifecycleArgs, loadWorkspaceTasks, startRepoRuntime: () => startup.promise };
  const harness = createHookHarness(() => useAppLifecycle(args), undefined, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    await harness.mount();
    expect(loadWorkspaceTasks).not.toHaveBeenCalled();
    expect(readModels).not.toHaveBeenCalled();
    startup.resolve(runtime);
    await waitFor(() => expect(client.getQueryData<string[]>(modelsKey)).toEqual(["ready"]));
    expect(readModels).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(historyKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(todosKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    expect(loadWorkspaceTasks).not.toHaveBeenCalled();
  } finally {
    startup.resolve(runtime);
    await harness.unmount();
    unsubscribe();
    client.clear();
  }
});

test("ignores a runtime startup completion after the user switches repositories", async () => {
  const client = new QueryClient();
  const oldKey = ["runtime-catalog", "/repo", "opencode"];
  const newKey = ["runtime-catalog", "/other", "opencode"];
  client.setQueryData(oldKey, ["old"]);
  client.setQueryData(newKey, ["other"]);
  const startup = Promise.withResolvers<RuntimeInstanceSummary>();
  const args = {
    ...lifecycleArgs,
    startRepoRuntime: (repoPath: string) =>
      repoPath === "/repo" ? startup.promise : Promise.resolve({ ...runtime, repoPath }),
  };
  const harness = createHookHarness(
    (input: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(input),
    args,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  try {
    await harness.mount();
    await harness.update({
      ...args,
      activeWorkspace: { workspaceId: "other", workspaceName: "Other", repoPath: "/other" },
    });
    await waitFor(() => expect(client.getQueryState(newKey)?.isInvalidated).toBe(true));
    startup.resolve(runtime);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryState(oldKey)?.isInvalidated).toBe(false);
  } finally {
    startup.resolve(runtime);
    await harness.unmount();
    client.clear();
  }
});
