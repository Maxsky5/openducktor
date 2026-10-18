import { expect, jest, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RepoConfig } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  runtimeCatalogQueryKeys,
  runtimeCatalogQueryOptions,
} from "@openducktor/frontend-core/queries/runtime-catalog";
import { useRuntimeCatalogQuery } from "@openducktor/frontend-core/queries/use-runtime-catalog-query";
import { repoConfigQueryOptions, workspaceQueryKeys } from "@openducktor/frontend-core/queries/workspace";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createHostRuntimeStatusContextValue,
  createRuntimeCatalogFixture,
} from "@/test-utils/shared-test-fixtures";
import { createDeferred } from "../operations/workspace/workspace-hook-test-fixtures";
import { useRuntimeCatalogBootstrap } from "./use-runtime-catalog-bootstrap";

test.each(["catalog", "config"] as const)(
  "keeps an unobserved workspace %s after an hour",
  async (kind) => {
    jest.useFakeTimers();
    const { queryClient: client } = createTestClientConnection({
      client: { workspaceGetRepoConfig: async () => makeRepoConfig("a") },
    });
    const catalog = createRuntimeCatalogFixture();
    const catalogOptions = runtimeCatalogQueryOptions(
      { repoPath: "/a", runtimeKind: "opencode", workingDirectory: "/a" },
      async () => catalog,
    );
    const configOptions = repoConfigQueryOptions("a");
    try {
      await (kind === "catalog"
        ? client.fetchQuery(catalogOptions)
        : client.fetchQuery(configOptions));
      jest.advanceTimersByTime(61 * 60_000);
      expect(
        client.getQueryData<unknown>(
          kind === "catalog" ? catalogOptions.queryKey : configOptions.queryKey,
        ),
      ).toEqual(kind === "catalog" ? catalog : makeRepoConfig("a"));
    } finally {
      client.clear();
      jest.useRealTimers();
    }
  },
);

test("loads only visited workspaces and shows cached data during a stale return read", async () => {
  const client = createClientQueryClient();
  const runtimeStatus = createHostRuntimeStatusContextValue();
  const availableRuntimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR];
  const catalog = createRuntimeCatalogFixture({
    models: { models: [], defaultModelsByProvider: {} },
    slashCommands: { commands: [] },
    skills: { skills: [] },
  });
  const catalogRead = createDeferred<AgentRuntimeCatalog>();
  const configRead = createDeferred<RepoConfig>();
  const loadRepoRuntimeCatalog = mock(async (_ref: RuntimeWorkingDirectoryRef) => catalog);
  const workspaceGetRepoConfig = mock(async (workspaceId: string) => makeRepoConfig(workspaceId));
  const connection = createTestClientConnection({
    queryClient: client,
    client: { workspaceGetRepoConfig },
  });
  const harness = createHookHarness(
    ({ workspaceId }: { workspaceId: string }) => {
      const repoPath = `/${workspaceId}`;
      useRuntimeCatalogBootstrap({
        activeWorkspace: { workspaceId, workspaceName: workspaceId, repoPath },
        runtimeStatus,
        availableRuntimeDefinitions,
        loadRepoRuntimeCatalog,
      });
      return {
        catalog: useRuntimeCatalogQuery({
          runtimeRef: { repoPath, runtimeKind: "opencode", workingDirectory: repoPath },
          loadRuntimeCatalog: loadRepoRuntimeCatalog,
        }),
        config: useQuery(repoConfigQueryOptions(workspaceId)),
      };
    },
    { workspaceId: "a" },
    {
      wrapper: ({ children }) => (
        <QueryProvider connection={connection}>
          <HostRuntimeStatusContext value={runtimeStatus}>{children}</HostRuntimeStatusContext>
        </QueryProvider>
      ),
    },
  );
  const catalogKey = runtimeCatalogQueryKeys.catalog({
    repoPath: "/a",
    runtimeKind: "opencode",
    workingDirectory: "/a",
  });
  const configKey = workspaceQueryKeys.repoConfig("a");

  try {
    await harness.mount();
    await harness.waitFor((state) => state.catalog.isSuccess && state.config.isSuccess);
    expect(loadRepoRuntimeCatalog.mock.calls.map(([ref]) => ref.repoPath)).toEqual(["/a"]);
    expect(workspaceGetRepoConfig.mock.calls.map(([id]) => id)).toEqual(["a"]);

    await harness.update({ workspaceId: "b" });
    await harness.waitFor((state) => state.catalog.isSuccess && state.config.isSuccess);
    expect(client.getQueryData<AgentRuntimeCatalog>(catalogKey)).toEqual(catalog);
    expect(client.getQueryData<RepoConfig>(configKey)).toEqual(makeRepoConfig("a"));

    const updatedAt = Date.now() - 61 * 60_000;
    client.setQueryData(catalogKey, catalog, { updatedAt });
    client.setQueryData(configKey, makeRepoConfig("a"), { updatedAt });
    loadRepoRuntimeCatalog.mockImplementationOnce(() => catalogRead.promise);
    workspaceGetRepoConfig.mockImplementationOnce(() => configRead.promise);
    await harness.update({ workspaceId: "a" });
    const state = harness.getLatest();
    expect(state.catalog.data).toEqual(catalog);
    expect(state.config.data).toEqual(makeRepoConfig("a"));
    expect(state.catalog.isLoading).toBe(false);
    expect(state.config.isLoading).toBe(false);
    expect(state.catalog.isFetching).toBe(true);
    expect(state.config.isFetching).toBe(true);
    expect(loadRepoRuntimeCatalog.mock.calls.map(([ref]) => ref.repoPath)).toEqual([
      "/a",
      "/b",
      "/a",
    ]);
    expect(workspaceGetRepoConfig.mock.calls.map(([id]) => id)).toEqual(["a", "b", "a"]);

    catalogRead.resolve(catalog);
    configRead.resolve({ ...makeRepoConfig("a"), branchPrefix: "updated" });
    await harness.waitFor(
      (next) => !next.catalog.isFetching && next.config.data?.branchPrefix === "updated",
    );
  } finally {
    jest.useRealTimers();
    catalogRead.resolve(catalog);
    configRead.resolve(makeRepoConfig("a"));
    await harness.unmount();
    client.clear();
  }
});

function makeRepoConfig(workspaceId: string): RepoConfig {
  return {
    workspaceId,
    workspaceName: workspaceId,
    repoPath: `/${workspaceId}`,
    branchPrefix: "odt",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    git: {},
    hooks: { postComplete: [] },
    actions: { items: [], defaultActionId: null },
    worktreeCopyPaths: [],
    promptOverrides: {},
    agentDefaults: {},
    agentStudioState: { openTaskIds: [] },
  };
}
